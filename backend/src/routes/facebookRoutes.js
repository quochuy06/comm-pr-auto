import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { HttpError, audit, text } from "../lib/errors.js";
import { createFacebookClient, facebookConfig, FacebookError } from "../services/facebook.js";
import { syncFacebookComments, collectFacebookMetrics, acceptFacebookWebhook } from "../services/facebookCommunity.js";
import { updateAutomation, pollFacebookInbox } from "../services/facebookAutomation.js";

export async function facebookWebhook(req, res) {
  const config = facebookConfig();
  if (req.method === "GET") {
    if (!config.verifyToken || req.query["hub.mode"] !== "subscribe" || req.query["hub.verify_token"] !== config.verifyToken || typeof req.query["hub.challenge"] !== "string") throw new HttpError(403, "Không xác minh được webhook.");
    return res.type("text/plain").send(req.query["hub.challenge"]);
  }
  await acceptFacebookWebhook(prisma, req.body, req.get("x-hub-signature-256"), config);
  res.json({ success: true });
}
const router = Router();
const safe = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { if (e instanceof FacebookError) throw new HttpError(502, e.message); throw e; }
};
router.get("/facebook/automation", roles("ADMIN"), async (req, res) => {
  res.json({ success: true, data: await prisma.facebookAutomation.findUnique({ where: { id: "default" } }) });
});
router.put("/facebook/automation", roles("ADMIN"), safe(async (req, res) => {
  res.json({ success: true, data: await updateAutomation(prisma, req.body, req.user.email) });
}));
router.get("/facebook/inbox", roles("ADMIN", "REVIEWER"), async (req, res) => {
  res.json({ success: true, data: await prisma.facebookInboxReply.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) });
});
router.post("/facebook/inbox/sync", roles("ADMIN"), safe(async (req, res) => {
  await pollFacebookInbox(prisma); res.json({ success: true });
}));
router.get("/facebook/status", roles("ADMIN"), safe(async (req, res) => {
  const c = facebookConfig();
  const identity = await createFacebookClient(c).identity();
  res.json({ success: true, data: { ...identity, exchangedAt: c.exchangedAt || null, userTokenExpiresAt: c.userTokenExpiresAt || null,
    webhookConfigured: !!c.appSecret && !!c.verifyToken, webhookNote: "Đăng ký feed webhook cần URL HTTPS công khai; đồng bộ định kỳ hoạt động trên localhost." } });
}));
router.post("/facebook/schedules/:id/comments", roles("ADMIN", "REVIEWER"), safe(async (req, res) => {
  const data = await syncFacebookComments(prisma, req.params.id);
  await audit(prisma, req.user.email, "FACEBOOK_COMMENTS_SYNCED", req.params.id);
  res.json({ success: true, data });
}));
router.post("/facebook/schedules/:id/metrics", roles("ADMIN", "REVIEWER"), safe(async (req, res) => {
  res.json({ success: true, data: await collectFacebookMetrics(prisma, req.params.id) });
}));
router.post("/facebook/replies/:id/retry", roles("ADMIN", "REVIEWER"), async (req, res) => {
  await prisma.$transaction(async tx => {
    const r = await tx.facebookReply.findUnique({ where: { id: req.params.id }, include: { comment: true } });
    if (!r) throw new HttpError(404, "Không có phản hồi.");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${r.comment.externalId}))::text`;
    const c = await tx.comment.findUniqueOrThrow({ where: { id: r.commentId } });
    if (req.body.confirmFacebook !== true || req.body.sourceHash !== r.sourceHash || c.sourceHash !== r.sourceHash || c.remoteDeleted)
      throw new HttpError(409, "Bình luận đã thay đổi hoặc chưa xác nhận gửi lại.");
    const updated = await tx.facebookReply.updateMany({ where: { id: r.id, status: "FAILED" }, data: { status: "PENDING", error: null, automatic: false, automationVersion: null } });
    if (!updated.count) throw new HttpError(409, "Chỉ thử lại phản hồi chắc chắn chưa gửi thành công.");
    await audit(tx, req.user.email, "FACEBOOK_REPLY_RETRIED", c.id);
  });
  res.json({ success: true });
});
router.post("/facebook/replies/:id/reconcile", roles("ADMIN"), safe(async (req, res) => {
  const r = await prisma.facebookReply.findUnique({ where: { id: req.params.id }, include: { comment: true } });
  if (!r || r.status !== "UNCERTAIN") throw new HttpError(409, "Chỉ đối soát phản hồi chưa rõ kết quả.");
  const client = createFacebookClient();
  if (client.pageId !== r.pageId) throw new HttpError(409, "Page đã thay đổi.");
  const externalId = await client.verifyReply(text(req.body.externalId, "ID Facebook", 100), r);
  await prisma.$transaction(async tx => {
    const updated = await tx.facebookReply.updateMany({ where: { id: r.id, status: "UNCERTAIN" }, data: { status: "SENT", externalId, error: null } });
    if (!updated.count) throw new HttpError(409, "Phản hồi vừa được xử lý.");
    await audit(tx, req.user.email, "FACEBOOK_REPLY_RECONCILED", r.commentId, externalId);
  });
  res.json({ success: true });
}));
export default router;
