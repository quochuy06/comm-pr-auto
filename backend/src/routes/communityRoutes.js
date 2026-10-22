import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { text, HttpError, audit } from "../lib/errors.js";
import { createJob, dispatch } from "../services/workflows.js";
import { visibleStatuses } from "../services/policy.js";
import { evaluateCrisis } from "../services/crisis.js";
import { approveFacebookReply } from "../services/facebookCommunity.js";
const router = Router();
router.post("/posts/:id/comments", async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } });
  if (!post || !visibleStatuses.includes(post.status))
    throw new HttpError(409, "Chỉ bình luận trên bài đã xuất bản.");
  const { comment, job } = await prisma.$transaction(async (db) => {
    const comment = await db.comment.create({
      data: {
        postId: post.id,
        author: req.user.name,
        text: text(req.body.text, "Bình luận", 3000),
      },
    });
    const job = await createJob(db, "community", comment.id);
    await audit(db, req.user.email, "COMMENT_CREATED", comment.id);
    return { comment, job };
  });
  dispatch(job);
  await evaluateCrisis(comment.id);
  res.status(201).json({ success: true, data: comment });
});
router.get("/comments", async (req, res) =>
  res.json({
    success: true,
    data: await prisma.comment.findMany({
      include: { post: { select: { id: true, topic: true } }, facebookReply: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  }),
);
router.post(
  "/comments/:id/retry",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    const job = await prisma.$transaction(async (db) => {
      const c = await db.comment.findUnique({ where: { id: req.params.id } });
      if (!c) throw new HttpError(404, "Không tìm thấy bình luận.");
      if (c.remoteDeleted) throw new HttpError(409, "Bình luận đã bị xóa trên Facebook.");
      if (["APPROVED", "REJECTED"].includes(c.replyStatus))
        throw new HttpError(409, "Phản hồi đã được xử lý.");
      const changed = await db.comment.updateMany({
        where: {
          id: c.id,
          latestJobId: c.latestJobId,
          replyStatus: { notIn: ["APPROVED", "REJECTED"] },
        },
        data: { analysisStatus: "PENDING", replyStatus: "NONE" },
      });
      if (!changed.count) throw new HttpError(409, "Phản hồi vừa được xử lý.");
      return createJob(db, "community", c.id);
    });
    dispatch(job);
    res.json({ success: true, data: job });
  },
);
router.patch(
  "/comments/:id/reply",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    await prisma.$transaction(async (db) => {
      const initial = await db.comment.findUnique({ where: { id: req.params.id } });
      if (initial?.source === "FACEBOOK") {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.externalId}))::text`;
        const current = await db.comment.findUniqueOrThrow({ where: { id: initial.id } });
        return approveFacebookReply(db, current, req.body, req.user.email);
      }
      const result = await db.comment.updateMany({
        where: {
          id: req.params.id,
          analysisStatus: "DONE",
          replyStatus: "PENDING",
        },
        data: {
          replyText: text(req.body.replyText, "Phản hồi", 5000),
          replyStatus: "APPROVED",
        },
      });
      if (!result.count)
        throw new HttpError(409, "Phản hồi không ở trạng thái chờ duyệt.");
      await audit(db, req.user.email, "REPLY_APPROVED", req.params.id);
    });
    res.json({ success: true });
  },
);
router.patch(
  "/comments/:id/reject",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    const c = await prisma.comment.updateMany({
      where: { id: req.params.id, replyStatus: "PENDING" },
      data: { replyStatus: "REJECTED", replyText: null },
    });
    if (!c.count)
      throw new HttpError(409, "Phản hồi không ở trạng thái chờ duyệt.");
    await audit(prisma, req.user.email, "REPLY_REJECTED", req.params.id);
    res.json({ success: true });
  },
);
router.patch(
  "/comments/:id/moderate",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    if (typeof req.body.moderated !== "boolean")
      throw new HttpError(400, "Trạng thái ẩn không hợp lệ.");
    await prisma.comment.update({
      where: { id: req.params.id },
      data: { moderated: req.body.moderated },
    });
    await audit(
      prisma,
      req.user.email,
      "COMMENT_MODERATED",
      req.params.id,
      String(req.body.moderated),
    );
    res.json({ success: true });
  },
);
router.get("/alerts", async (req, res) =>
  res.json({
    success: true,
    data: await prisma.alert.findMany({
      include: { post: { select: { id: true, topic: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  }),
);
router.post(
  "/alerts/:id/retry",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    const job = await prisma.$transaction(async (db) => {
      const a = await db.alert.findUnique({ where: { id: req.params.id } });
      if (!a || !["OPEN", "PENDING_APPROVAL", "REJECTED"].includes(a.status))
        throw new HttpError(409, "Không thể tạo lại thông cáo này.");
      const changed = await db.alert.updateMany({
        where: {
          id: a.id,
          updatedAt: a.updatedAt,
          status: { in: ["OPEN", "PENDING_APPROVAL", "REJECTED"] },
        },
        data: { status: "OPEN" },
      });
      if (!changed.count) throw new HttpError(409, "Cảnh báo vừa được xử lý.");
      return createJob(db, "crisis", a.id);
    });
    dispatch(job);
    res.json({ success: true, data: job });
  },
);
router.patch(
  "/alerts/:id/:action",
  roles("ADMIN", "REVIEWER"),
  async (req, res) => {
    const { action, id } = req.params;
    if (!["approve", "reject", "resolve"].includes(action))
      throw new HttpError(404, "Không có thao tác này.");
    await prisma.$transaction(async (db) => {
      const where = {
        id,
        status:
          action === "resolve"
            ? { in: ["OPEN", "PENDING_APPROVAL", "APPROVED", "REJECTED"] }
            : "PENDING_APPROVAL",
      };
      const data =
        action === "approve"
          ? {
              status: "APPROVED",
              statement: text(req.body.statement, "Thông cáo", 12000),
              publishedAt: new Date(),
            }
          : { status: action === "reject" ? "REJECTED" : "RESOLVED" };
      const changed = await db.alert.updateMany({ where, data });
      if (!changed.count)
        throw new HttpError(409, "Cảnh báo không còn ở trạng thái phù hợp.");
      if (action !== "approve")
        await db.workflowJob.updateMany({
          where: {
            kind: "crisis",
            entityId: id,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: { status: "CANCELLED" },
        });
      await audit(db, req.user.email, `CRISIS_${action.toUpperCase()}`, id);
    });
    res.json({ success: true });
  },
);
export default router;
