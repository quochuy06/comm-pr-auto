import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { HttpError, text, choice, audit } from "../lib/errors.js";
import { createJob, dispatch, failJob } from "../services/workflows.js";
import { artifactKinds, createArtifact, checkedPlan, checkedReview, publicationHash, dateInput } from "../services/expansion.js";
import { checkedVariants, checkedReport, createWeeklyReports, sourceRevision } from "../services/insights.js";
import { facebookConfig, createFacebookClient, FacebookError } from "../services/facebook.js";
import { publishDueSchedule, recoverFacebookSends, reconcileFacebookPost } from "../services/facebookPublishing.js";
const router = Router();
export const expansionInternal = Router();
const readers = roles("ADMIN", "REVIEWER");
const editors = roles("ADMIN", "EDITOR");
router.get("/artifacts", async (req, res) => {
  const where = req.query.kind ? { kind: choice(req.query.kind, artifactKinds, "Loại workflow") } : {};
  const data = await prisma.workflowArtifact.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { campaign: true } });
  const ids = data.map(x => x.latestJobId).filter(Boolean);
  const jobs = await prisma.workflowJob.findMany({ where: { id: { in: ids } } });
  res.json({ success: true, data: data.map(x => ({ ...x, job: jobs.find(j => j.id === x.latestJobId) })) });
});
router.post("/campaigns/:id/plan", editors, async (req, res) => {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: req.params.id } });
  const brief = text(req.body.brief, "Mục tiêu, đối tượng và thời gian", 5000);
  const count = Number(req.body.count ?? 5);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new HttpError(400, "Số ý tưởng phải từ 1 đến 20.");
  const { artifact, job } = await prisma.$transaction(db => createArtifact(db, "planning", { campaign: { name: campaign.name, description: campaign.description }, brief, count }, { campaignId: campaign.id }));
  dispatch(job); res.status(201).json({ success: true, data: artifact });
});
router.patch("/artifacts/:id/:action", readers, async (req, res) => {
  const action = choice(req.params.action, ["approve", "reject"], "Thao tác");
  const data = await prisma.$transaction(async db => {
    const changed = await db.workflowArtifact.updateMany({ where: { id: req.params.id, status: "PENDING_APPROVAL" }, data: { status: action === "approve" ? "APPROVED" : "REJECTED" } });
    if (!changed.count) throw new HttpError(409, "Kết quả không còn chờ duyệt.");
    await audit(db, req.user.email, `ARTIFACT_${action.toUpperCase()}`, req.params.id);
    return db.workflowArtifact.findUnique({ where: { id: req.params.id } });
  });
  res.json({ success: true, data });
});
router.post("/artifacts/:id/retry", editors, async (req, res) => {
  const job = await prisma.$transaction(async db => {
    const changed = await db.workflowArtifact.updateMany({ where: { id: req.params.id, status: "FAILED" }, data: { status: "PROCESSING" } });
    if (!changed.count) throw new HttpError(409, "Chỉ thử lại tác vụ đã thất bại.");
    const a = await db.workflowArtifact.findUniqueOrThrow({ where: { id: req.params.id } });
    return createJob(db, a.kind, a.id);
  });
  dispatch(job); res.json({ success: true, data: job });
});
router.post("/artifacts/:id/items/:index", editors, async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index > 19) throw new HttpError(400, "Ý tưởng không hợp lệ.");
  const result = await prisma.$transaction(async db => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.params.id}))::text`;
    const a = await db.workflowArtifact.findUniqueOrThrow({ where: { id: req.params.id } });
    if (a.kind !== "planning" || a.status !== "APPROVED") throw new HttpError(409, "Kế hoạch cần được duyệt trước.");
    if (a.createdPosts?.[index]) return { post: await db.post.findUniqueOrThrow({ where: { id: a.createdPosts[index] } }) };
    const idea = a.result?.items?.[index];
    if (!idea) throw new HttpError(404, "Không có ý tưởng.");
    const { topic, targetAudience, tone, platform } = idea;
    const post = await db.post.create({ data: { topic, targetAudience, tone, platform, campaignId: a.campaignId } });
    const job = await createJob(db, "content", post.id);
    await db.workflowArtifact.update({ where: { id: a.id }, data: { createdPosts: { ...(a.createdPosts || {}), [index]: post.id } } });
    await audit(db, req.user.email, "PLAN_ITEM_GENERATED", post.id, a.id);
    return { post, job };
  });
  if (result.job) dispatch(result.job);
  res.json({ success: true, data: result.post });
});
router.get("/schedules", async (req, res) => res.json({ success: true, data: await prisma.postSchedule.findMany({ orderBy: { scheduledAt: "desc" }, take: 100, include: { post: true } }) }));
router.get("/facebook/connection", async (req, res) => {
  try { res.json({ success: true, data: { connected: true, ...await createFacebookClient().identity() } }); }
  catch (e) { res.json({ success: true, data: { connected: false, error: e instanceof FacebookError ? e.message : "Không kiểm tra được kết nối Facebook." } }); }
});
router.post("/schedules/:id/reconcile", roles("ADMIN"), async (req, res) => {
  const externalPostId = text(req.body.externalPostId, "ID bài Facebook", 100);
  try { res.json({ success: true, data: await reconcileFacebookPost(prisma, req.params.id, externalPostId, req.user.email) }); }
  catch (e) { if (e instanceof FacebookError) throw new HttpError(409, e.message); throw e; }
});
router.post("/posts/:id/schedule", roles("ADMIN", "EDITOR", "REVIEWER"), async (req, res) => {
  const scheduledAt = dateInput(req.body.scheduledAt, "Giờ đăng");
  const target = choice(req.body.target ?? "SIMULATOR", ["SIMULATOR", "FACEBOOK"], "Kênh xuất bản");
  let pageId = null;
  if (target === "FACEBOOK") {
    if (req.body.confirmFacebook !== true) throw new HttpError(400, "Cần xác nhận bài sẽ được đăng công khai lên Facebook.");
    try { pageId = facebookConfig().pageId; }
    catch (e) { throw new HttpError(400, e instanceof FacebookError ? e.message : "Chưa cấu hình Facebook."); }
  }
  if (scheduledAt < new Date(Date.now() - 60000)) throw new HttpError(400, "Chọn giờ hiện tại hoặc tương lai.");
  const data = await prisma.$transaction(async db => {
    const p = await db.post.findUniqueOrThrow({ where: { id: req.params.id } });
    if (p.status !== "APPROVED" || !p.approvedBy || !p.bannerUrl || !p.content || !p.headline) throw new HttpError(409, "Chỉ lên lịch bài đủ nội dung, ảnh và đã duyệt.");
    const existing = await db.postSchedule.findUnique({ where: { postId: p.id } });
    if (existing) await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.id}))::text`;
    if (existing) {
      const locked = await db.postSchedule.findUniqueOrThrow({ where: { id: existing.id } });
      if (["SENDING", "UNCERTAIN", "PUBLISHED"].includes(locked.status) || locked.externalPostId) throw new HttpError(409, "Lịch đã gửi hoặc đang đối soát; không thể đặt lại để tránh đăng trùng.");
    }
    if (target === "FACEBOOK" && (p.platform !== "Facebook" || !/^\/media\/[a-f0-9-]+\.(png|jpg)$/.test(p.bannerUrl))) throw new HttpError(400, "Đăng Facebook cần bài cho Facebook và ảnh PNG/JPEG đã lưu nội bộ.");
    // Lock the article too: changes to approval/image must not race scheduling.
    const unchanged = await db.post.updateMany({ where: { id: p.id, status: "APPROVED", updatedAt: p.updatedAt }, data: { status: "APPROVED" } });
    if (!unchanged.count) throw new HttpError(409, "Bài vừa thay đổi.");
    const data = await db.postSchedule.upsert({ where: { postId: p.id }, create: { postId: p.id, scheduledAt, contentHash: publicationHash(p), target, pageId }, update: { scheduledAt, contentHash: publicationHash(p), target, pageId, status: "PENDING", error: null, publishedAt: null, attemptedAt: null } });
    await audit(db, req.user.email, "POST_SCHEDULED", p.id, `${scheduledAt.toISOString()} · ${target}${pageId ? ` · Page ${pageId}` : ""}`);
    return data;
  }); res.json({ success: true, data });
});
router.delete("/schedules/:id", roles("ADMIN", "EDITOR", "REVIEWER"), async (req, res) => {
  await prisma.$transaction(async db => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.params.id}))::text`;
    const changed = await db.postSchedule.updateMany({ where: { id: req.params.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED" } });
    if (!changed.count) throw new HttpError(409, "Lịch đã được xử lý.");
    await audit(db, req.user.email, "SCHEDULE_CANCELLED", req.params.id);
  }); res.json({ success: true });
});
expansionInternal.post("/weekly-reports", async (req, res) => {
  const jobs = await createWeeklyReports();
  jobs.forEach(dispatch);
  res.json({ success: true, queued: jobs.length });
});
expansionInternal.get("/due", async (req, res) => {
  await recoverFacebookSends(prisma);
  res.json({ schedules: await prisma.postSchedule.findMany({ where: { status: "PENDING", scheduledAt: { lte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 50, select: { id: true, updatedAt: true, scheduledAt: true } }) });
});
expansionInternal.post("/publish", async (req, res) => {
  const id = text(req.body.id, "Lịch", 100);
  const expected = dateInput(req.body.expectedUpdatedAt, "Phiên bản lịch").toISOString();
  const result = await publishDueSchedule(prisma, id, expected);
  // Preserve the installed n8n summary contract; DB/UI retain UNCERTAIN and
  // require reconciliation. FAILED here is a tick outcome, not a retry request.
  res.json({ ...result, publicationStatus: result.status, status: result.status === "UNCERTAIN" ? "FAILED" : result.status });
});
expansionInternal.post("/publisher-log", async (req, res) => {
  const counts = {};
  for (const k of ["published", "failed", "ignored"]) {
    const n = req.body[k]; if (!Number.isInteger(n) || n < 0 || n > 50) throw new HttpError(400, "Thống kê không hợp lệ."); counts[k] = n;
  }
  if (counts.published + counts.failed + counts.ignored) await audit(prisma, "SYSTEM", "PUBLISHER_TICK", "scheduler", JSON.stringify(counts));
  res.json({ success: true });
});
expansionInternal.post("/callback/:kind", async (req, res) => {
  const kind = choice(req.params.kind, artifactKinds, "Workflow");
  const { jobId, entityId, ok } = req.body;
  if (typeof jobId !== "string" || typeof entityId !== "string" || typeof ok !== "boolean") throw new HttpError(400, "Callback không hợp lệ.");
  const job = await prisma.workflowJob.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== kind || job.entityId !== entityId) throw new HttpError(404, "Không tìm thấy job.");
  if (!["RUNNING", "QUEUED"].includes(job.status)) return res.json({ success: true, ignored: true });
  if (!ok) { await failJob(job.id, typeof req.body.error === "string" ? req.body.error.slice(0, 1000) : "Workflow thất bại."); return res.json({ success: true }); }
  let result;
  try {
    const validate = { planning: checkedPlan, repurpose: checkedVariants, report: checkedReport }[kind];
    result = { ...validate(req.body.result), review: checkedReview(req.body.result.review) };
  } catch (e) { await failJob(job.id, e.message); throw e; }
  const applied = await prisma.$transaction(async db => {
    if (kind === "repurpose") {
      const a = await db.workflowArtifact.findUnique({ where: { id: entityId }, include: { sourcePost: true } });
      if (!a?.sourcePost || sourceRevision(a.sourcePost) !== a.input.sourceRevision || !["APPROVED", "PUBLISHED"].includes(a.sourcePost.status)) {
        await db.workflowJob.updateMany({ where: { id: jobId, status: { in: ["RUNNING", "QUEUED"] } }, data: { status: "FAILED", error: "Bài gốc đã thay đổi; hãy tạo yêu cầu chuyển thể mới." } });
        await db.workflowArtifact.updateMany({ where: { id: entityId, latestJobId: jobId, status: "PROCESSING" }, data: { status: "FAILED" } });
        return false;
      }
    }
    const claimed = await db.workflowJob.updateMany({ where: { id: jobId, status: { in: ["RUNNING", "QUEUED"] } }, data: { status: "SUCCEEDED" } });
    if (!claimed.count) return false;
    const changed = await db.workflowArtifact.updateMany({ where: { id: entityId, latestJobId: jobId, status: "PROCESSING" }, data: { result, status: "PENDING_APPROVAL" } });
    if (!changed.count) { await db.workflowJob.update({ where: { id: jobId }, data: { status: "CANCELLED" } }); return false; }
    await audit(db, "AI", "ARTIFACT_READY", entityId, kind);
    return true;
  });
  res.json({ success: true, ignored: !applied });
});
export default router;
