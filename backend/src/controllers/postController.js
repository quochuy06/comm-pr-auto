import { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { text, choice, HttpError, audit } from "../lib/errors.js";
import { createJob, dispatch } from "../services/workflows.js";
const statuses = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "CRISIS_ALERT",
];
const include = {
  campaign: true,
  comments: { orderBy: { createdAt: "asc" } },
  alerts: { orderBy: { createdAt: "desc" } },
};
export const getPosts = async (req, res) => {
  const where = {};
  if (req.query.status)
    where.status = choice(req.query.status, statuses, "Trạng thái");
  if (req.query.campaignId)
    where.campaignId = text(req.query.campaignId, "Chiến dịch", 100);
  res.json({
    success: true,
    data: await prisma.post.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  });
};
export const getPostById = async (req, res) => {
  const data = await prisma.post.findUnique({
    where: { id: req.params.id },
    include,
  });
  if (!data) throw new HttpError(404, "Không tìm thấy bài.");
  const job = data.latestJobId
    ? await prisma.workflowJob.findUnique({ where: { id: data.latestJobId } })
    : null;
  res.json({ success: true, data: { ...data, job } });
};
export const generatePost = async (req, res) => {
  const topic = text(req.body.topic, "Chủ đề", 1500);
  const data = {
    topic,
    targetAudience: text(req.body.targetAudience, "Đối tượng", 500, true),
    tone: text(req.body.tone, "Giọng điệu", 200, true),
    platform: choice(
      req.body.platform || "Facebook",
      ["Facebook", "LinkedIn", "X"],
      "Nền tảng",
    ),
    campaignId: text(req.body.campaignId, "Chiến dịch", 100, true),
    imagePrompt: text(req.body.imagePrompt, "Mô tả ảnh", 2000, true),
  };
  const { post, job } = await prisma.$transaction(async (db) => {
    const post = await db.post.create({ data });
    const job = await createJob(db, "content", post.id);
    await audit(db, req.user.email, "POST_GENERATE", post.id);
    return { post, job };
  });
  dispatch(job);
  res
    .status(201)
    .json({ success: true, data: { ...post, latestJobId: job.id, job } });
};
export const regeneratePost = async (req, res) => {
  const { post, job } = await prisma.$transaction(async (db) => {
    const p = await db.post.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, "Không tìm thấy bài.");
    if (["APPROVED", "PUBLISHED", "CRISIS_ALERT"].includes(p.status))
      throw new HttpError(
        409,
        "Bài đã xuất hiện trên feed. Hãy tạo bản nháp mới.",
      );
    const changed = await db.post.updateMany({
      where: {
        id: p.id,
        status: { in: ["DRAFT", "PENDING_APPROVAL", "REJECTED"] },
        updatedAt: p.updatedAt,
      },
      data: {
        status: "DRAFT",
        risk: "UNKNOWN",
        imageStatus: "PENDING",
        imageReviewStatus: "NOT_REVIEWED",
        imageReview: Prisma.DbNull,
        contentReview: Prisma.DbNull,
        imageError: null,
        reviewReason: null,
        ...(req.body.imagePrompt !== undefined
          ? { imagePrompt: text(req.body.imagePrompt, "Mô tả ảnh", 2000, true) }
          : {}),
      },
    });
    if (!changed.count)
      throw new HttpError(
        409,
        "Bài vừa được thay đổi. Hãy tải lại trước khi tạo lại.",
      );
    const post = await db.post.findUniqueOrThrow({ where: { id: p.id } });
    const job = await createJob(db, "content", p.id);
    await audit(db, req.user.email, "POST_REGENERATE", p.id);
    return { post, job };
  });
  dispatch(job);
  res.json({ success: true, data: { ...post, latestJobId: job.id, job } });
};

export const processPostImage = async (req, res) => {
  const mode =
    req.params.action === "review-image" ? "REVIEW_IMAGE" : "IMAGE_ONLY";
  const { post, job } = await prisma.$transaction(async (db) => {
    const current = await db.post.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "Không tìm thấy bài.");
    if (current.status === "CRISIS_ALERT")
      throw new HttpError(
        409,
        "Bài đang có cảnh báo rủi ro; cần xử lý cảnh báo trước khi tạo lại ảnh.",
      );
    if (!current.headline || !current.content || !current.imagePrompt)
      throw new HttpError(
        409,
        "Cần nội dung và mô tả ảnh trước khi xử lý riêng ảnh.",
      );
    if (
      ["APPROVED", "PUBLISHED", "CRISIS_ALERT"].includes(current.status) &&
      req.user.role === "EDITOR"
    )
      throw new HttpError(
        403,
        "Bài đã duyệt cần quản trị viên hoặc người duyệt kiểm tra lại ảnh.",
      );
    const active = current.latestJobId
      ? await db.workflowJob.findUnique({ where: { id: current.latestJobId } })
      : null;
    if (active && ["QUEUED", "RUNNING"].includes(active.status))
      throw new HttpError(
        409,
        "Bài đang xử lý. Hãy chờ hoặc thử lại khi có kết quả.",
      );
    const prompt =
      mode === "IMAGE_ONLY" && req.body.imagePrompt !== undefined
        ? text(req.body.imagePrompt, "Mô tả ảnh", 2000)
        : current.imagePrompt;
    const changed = await db.post.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt },
      data: {
        imagePrompt: prompt,
        imageReviewStatus: "PENDING",
        imageError: null,
        status: "PENDING_APPROVAL",
        approvedBy: null,
      },
    });
    if (!changed.count)
      throw new HttpError(409, "Bài vừa thay đổi. Hãy tải lại.");
    const job = await createJob(db, "content", current.id, mode);
    await audit(
      db,
      req.user.email,
      mode === "REVIEW_IMAGE" ? "IMAGE_REVIEW_REQUESTED" : "IMAGE_REGENERATE",
      current.id,
      "Giữ nguyên tiêu đề và nội dung; chờ kiểm tra ảnh trước khi tự duyệt.",
    );
    return {
      post: await db.post.findUnique({ where: { id: current.id } }),
      job,
    };
  });
  dispatch(job);
  res.json({ success: true, data: { ...post, job } });
};
