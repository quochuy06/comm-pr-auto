import { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { HttpError, text, safeImageUrl, audit } from "../lib/errors.js";
import { failJob } from "../services/workflows.js";
import { normalizeImageReview } from "../services/imageReview.js";
import {
  canAutoApprovePost,
  canAutoReply,
  severePattern,
} from "../services/policy.js";
import { communityMetadata, crisisMetadata, applyTriage } from "../services/triage.js";
import { evaluateCrisis } from "../services/crisis.js";
function validReview(r) {
  return (
    r &&
    typeof r.safe === "boolean" &&
    typeof r.grounded === "boolean" &&
    ["LOW", "MEDIUM", "HIGH"].includes(r.risk) &&
    typeof r.reason === "string" &&
    r.reason.length <= 5000
  );
}
function checkedResult(kind, r) {
  if (!r || !validReview(r.review))
    throw new HttpError(400, "Kết quả AI thiếu đánh giá hợp lệ.");
  if (kind === "content")
    return {
      ...r,
      headline: text(r.headline, "Tiêu đề", 500),
      content: text(r.content, "Nội dung", 12000),
      imagePrompt: text(r.imagePrompt, "Mô tả ảnh", 2000),
      risk: ["LOW", "MEDIUM", "HIGH"].includes(r.risk) ? r.risk : "HIGH",
      bannerUrl: safeImageUrl(r.bannerUrl),
    };
  if (kind === "community") {
    if (
      !["POSITIVE", "NEUTRAL", "NEGATIVE", "CRISIS"].includes(r.sentiment) ||
      !["LOW", "MEDIUM", "HIGH"].includes(r.risk) ||
      typeof r.sensitive !== "boolean"
    )
      throw new HttpError(400, "Phân tích bình luận không hợp lệ.");
    return {
      ...r,
      reply: text(r.reply, "Phản hồi", 5000),
      reason: text(r.reason, "Lý do", 5000),
    };
  }
  if (!Array.isArray(r.actions) || r.actions.length > 20)
    throw new HttpError(400, "Danh sách hành động không hợp lệ.");
  return {
    ...r,
    summary: text(r.summary, "Tóm tắt", 5000),
    statement: text(r.statement, "Thông cáo", 12000),
    actions: r.actions.map((a) => text(a, "Hành động", 1000)),
  };
}
export const handleN8nCallback = async (req, res) => {
  const { kind } = req.params;
  const { jobId, entityId, ok } = req.body;
  if (
    !["content", "community", "crisis"].includes(kind) ||
    typeof jobId !== "string" ||
    typeof entityId !== "string" ||
    typeof ok !== "boolean"
  )
    throw new HttpError(400, "Callback không hợp lệ.");
  const job = await prisma.workflowJob.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== kind || job.entityId !== entityId)
    throw new HttpError(404, "Không tìm thấy yêu cầu tương ứng.");
  if (!["QUEUED", "RUNNING"].includes(job.status))
    return res.json({ success: true, ignored: true });
  if (!ok) {
    await failJob(
      jobId,
      typeof req.body.error === "string"
        ? req.body.error.slice(0, 1000)
        : "AI xử lý thất bại.",
    );
    return res.json({ success: true });
  }
  let r, analysisMeta;
  try {
    r = checkedResult(kind, req.body.result);
    if (job.mode === "V2" && kind === "community") {
      analysisMeta = communityMetadata(r); r = applyTriage(r, analysisMeta);
    }
    if (job.mode === "V2" && kind === "crisis") {
      const alert = await prisma.alert.findUniqueOrThrow({ where: { id: entityId } });
      analysisMeta = crisisMetadata(r, alert.evidence);
    }
  } catch (e) {
    await failJob(jobId, e.message);
    throw e;
  }
  const image =
    kind === "content"
      ? {
          imageStatus: job.imageAsset?.imageStatus || "FAILED",
          bannerUrl: job.imageAsset?.bannerUrl || null,
          imageError:
            job.imageAsset?.imageError ||
            (!job.imageAsset ? "Chưa tải và kiểm tra ảnh thực tế." : null),
        }
      : null;
  const visual =
    kind === "content"
      ? normalizeImageReview(r.imageReview, job.imageAsset, r)
      : null;
  const applied = await prisma.$transaction(async (db) => {
    const model =
      kind === "content" ? "post" : kind === "community" ? "comment" : "alert";
    const current = await db[model].findUnique({ where: { id: entityId } });
    if (!current || current.latestJobId !== jobId) return false;
    if (
      kind === "content" &&
      current.status !== (job.mode === "CONTENT" ? "DRAFT" : "PENDING_APPROVAL")
    )
      return false;
    if (
      kind === "content" &&
      job.mode !== "CONTENT" &&
      (r.headline !== current.headline ||
        r.content !== current.content ||
        r.imagePrompt !== current.imagePrompt)
    )
      return false;
    const claimed = await db.workflowJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: kind === "content" && (image.imageStatus !== "VERIFIED" || visual.status === "ERROR")
          ? "PARTIAL" : "SUCCEEDED",
        error: kind === "content" && (image.imageStatus !== "VERIFIED" || visual.status === "ERROR")
          ? image.imageError || visual.reason : null,
      },
    });
    if (!claimed.count) return false;
    const settings = await db.settings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
    if (kind === "content") {
      const auto = canAutoApprovePost(settings, r, image.imageStatus, visual);
      const changed = await db.post.updateMany({
        where: {
          id: entityId,
          latestJobId: jobId,
          status: job.mode === "CONTENT" ? "DRAFT" : "PENDING_APPROVAL",
        },
        data: {
          headline: r.headline,
          content: r.content,
          imagePrompt: r.imagePrompt,
          ...image,
          imageReviewStatus: visual.status,
          imageReview: visual,
          contentReview: r.review,
          risk: r.risk,
          reviewReason: r.review.reason,
          status: auto ? "APPROVED" : "PENDING_APPROVAL",
          approvedBy: auto ? "AI_POLICY" : null,
        },
      });
      if (!changed.count) throw new HttpError(409, "Bài đã được thay đổi.");
      await audit(
        db,
        "AI",
        auto ? "POST_AUTO_APPROVED" : "POST_REVIEW_REQUIRED",
        entityId,
        r.review.reason + " · Ảnh: " + visual.reason,
      );
    } else if (kind === "community") {
      const severe = severePattern.test(current.text);
      if (severe) {
        r.risk = "HIGH";
        r.sentiment = "CRISIS";
        r.sensitive = true;
      }
      const auto = canAutoReply(settings, r, current.text);
      const changed = await db.comment.updateMany({
        where: {
          id: entityId,
          latestJobId: jobId,
          replyStatus: { notIn: ["APPROVED", "REJECTED"] },
        },
        data: {
          ...(analysisMeta ? { analysisMeta } : {}),
          sentiment: r.sentiment,
          risk: r.risk,
          sensitive: r.sensitive,
          analysisStatus: "DONE",
          reason: r.reason + " · Kiểm tra: " + r.review.reason,
          suggestedReply: r.reply,
          replyText: auto ? r.reply : null,
          replyStatus: auto ? "APPROVED" : "PENDING",
        },
      });
      if (!changed.count)
        throw new HttpError(409, "Bình luận đã được thay đổi.");
      await audit(
        db,
        "AI",
        auto ? "COMMENT_AUTO_REPLIED" : "COMMENT_REVIEW_REQUIRED",
        entityId,
        r.reason,
      );
    } else {
      const changed = await db.alert.updateMany({
        where: { id: entityId, latestJobId: jobId, status: "OPEN" },
        data: {
          ...(analysisMeta ? { analysisMeta } : {}),
          summary: r.summary,
          statement: r.statement,
          actions: r.actions,
          reviewReason: r.review.reason,
          status: "PENDING_APPROVAL",
        },
      });
      if (!changed.count)
        throw new HttpError(409, "Cảnh báo đã được thay đổi.");
      await audit(
        db,
        "AI",
        "CRISIS_DRAFT_CREATED",
        entityId,
        "Luôn chờ người duyệt.",
      );
    }
    return true;
  });
  if (!applied)
    await prisma.workflowJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", error: "Kết quả cũ không còn áp dụng." },
    });
  if (applied && kind === "community") await evaluateCrisis(entityId);
  res.json({ success: true, ignored: !applied });
};
export const approvePost = async (req, res) => {
  const data = await prisma.$transaction(async (db) => {
    const p = await db.post.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, "Không tìm thấy bài.");
    if (p.status !== "PENDING_APPROVAL")
      throw new HttpError(409, "Chỉ duyệt bài đang chờ duyệt.");
    if (p.latestJobId) {
      const job = await db.workflowJob.findUnique({
        where: { id: p.latestJobId },
      });
      if (job && ["QUEUED", "RUNNING"].includes(job.status))
        throw new HttpError(
          409,
          "Ảnh đang được xử lý. Hãy chờ kết quả trước khi duyệt.",
        );
    }
    const headline = text(req.body.headline ?? p.headline, "Tiêu đề", 500);
    const content = text(req.body.content ?? p.content, "Nội dung", 12000);
    const bannerUrl = safeImageUrl(req.body.bannerUrl ?? p.bannerUrl);
    const result = await db.post.updateMany({
      where: { id: p.id, status: "PENDING_APPROVAL", updatedAt: p.updatedAt },
      data: {
        headline,
        content,
        bannerUrl,
        status: "APPROVED",
        approvedBy: req.user.email,
        imageReviewStatus: "MANUAL",
        ...(headline !== p.headline || content !== p.content
          ? { contentReview: Prisma.DbNull }
          : {}),
        imageStatus: bannerUrl === p.bannerUrl ? p.imageStatus : "MANUAL",
      },
    });
    if (!result.count) throw new HttpError(409, "Bài vừa được xử lý.");
    await audit(db, req.user.email, "POST_APPROVED", p.id);
    return db.post.findUnique({ where: { id: p.id } });
  });
  res.json({ success: true, data });
};
export const rejectPost = async (req, res) => {
  await prisma.$transaction(async (db) => {
    const result = await db.post.updateMany({
      where: {
        id: req.params.id,
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      },
      data: { status: "REJECTED" },
    });
    if (!result.count)
      throw new HttpError(409, "Bài không còn ở trạng thái cho phép từ chối.");
    await db.workflowJob.updateMany({
      where: {
        entityId: req.params.id,
        kind: "content",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: { status: "CANCELLED" },
    });
    await audit(db, req.user.email, "POST_REJECTED", req.params.id);
  });
  res.json({ success: true });
};
