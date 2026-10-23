import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createFacebookClient, facebookConfig, FacebookError } from "./facebook.js";
import { HttpError, audit, text } from "../lib/errors.js";
import { createJob, dispatch } from "./workflows.js";
import { evaluateCrisis } from "./crisis.js";
import { queueAutomaticComments, ingestInboxMessage, pollFacebookInbox, sendInboxReply, recoverInboxReplies } from "./facebookAutomation.js";

export const commentHash = value => createHash("sha256").update(value).digest("hex");
const safeError = e => e instanceof FacebookError || e instanceof HttpError ? e.message : "Không hoàn tất đồng bộ Facebook.";
const lock = (db, id) => db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
// Import existing Page publications for monitoring only; never schedule or republish them.
export async function discoverFacebookPosts(db, client = createFacebookClient()) {
  await client.identity();
  const result = await client.publishedPosts();
  for (const remote of result.posts) {
    if (!new RegExp(`^${client.pageId}_\\d+$`).test(remote.id) || remote.from?.id !== client.pageId || !Number.isFinite(Date.parse(remote.created_time))) continue;
    await db.$transaction(async tx => {
      await lock(tx, `facebook-post:${remote.id}`);
      if (await tx.postSchedule.findUnique({ where: { externalPostId: remote.id } })) return;
      const content = typeof remote.message === "string" ? remote.message : "";
      const publishedAt = new Date(remote.created_time);
      const post = await tx.post.create({ data: { topic: "Bài Facebook đồng bộ từ Page", headline: content.split("\n")[0].slice(0, 200) || "Bài trên Page Hiên Cà Phê", content, status: "PUBLISHED", publishedAt } });
      await tx.postSchedule.create({ data: { postId: post.id, target: "FACEBOOK", pageId: client.pageId, externalPostId: remote.id, permalink: `https://www.facebook.com/${remote.id}`, status: "PUBLISHED", publishedAt, scheduledAt: publishedAt, contentHash: commentHash(content) } });
    });
  }
  return { fetched: result.posts.length, complete: result.complete };
}

export async function syncFacebookComments(db, scheduleId, { client = createFacebookClient(), dispatchJob = dispatch, crisis = evaluateCrisis } = {}) {
  const startedAt = new Date();
  const s = await db.postSchedule.findUnique({ where: { id: scheduleId } });
  if (!s || s.target !== "FACEBOOK" || s.status !== "PUBLISHED" || !s.externalPostId || s.pageId !== client.pageId)
    throw new HttpError(409, "Chỉ đồng bộ bài đã đăng trên Page đang kết nối.");
  try {
    const result = await client.comments(s.externalPostId);
    let imported = 0;
    for (const remote of result.comments) {
      if (!/^\d+_\d+$/.test(remote.id) || typeof remote.message !== "string" || !remote.message.trim() || remote.message.length > 3000 || remote.from?.id === s.pageId || (remote.parent?.id && remote.parent.id !== s.externalPostId)) continue;
      const job = await db.$transaction(async tx => {
        await lock(tx, remote.id);
        const old = await tx.comment.findUnique({ where: { externalId: remote.id }, include: { facebookReply: true } });
        if (old && (old.postId !== s.postId || old.remoteDeleted || old.syncedAt > startedAt)) return null;
        const sourceHash = commentHash(remote.message);
        if (old?.sourceHash === sourceHash) {
          await tx.comment.update({ where: { id: old.id }, data: { syncedAt: startedAt } }); return null;
        }
        const immutable = old?.facebookReply && ["SENDING", "UNCERTAIN", "SENT"].includes(old.facebookReply.status);
        if (old?.facebookReply && !immutable) await tx.facebookReply.delete({ where: { commentId: old.id } });
        const fields = { text: remote.message, sourceHash, syncedAt: startedAt, author: String(remote.from?.name || "Người dùng Facebook").slice(0, 500) };
        const c = old ? await tx.comment.update({ where: { id: old.id }, data: { ...fields, analysisStatus: "PENDING", autoReplyEligible: false, risk: "UNKNOWN", sensitive: false, sentiment: "NEUTRAL", reason: null,
          ...(!immutable ? { replyStatus: "NONE", replyText: null, suggestedReply: null } : {}) } })
          : await tx.comment.create({ data: { ...fields, source: "FACEBOOK", externalId: remote.id, pageId: s.pageId, postId: s.postId,
            ...(Number.isFinite(Date.parse(remote.created_time)) ? { createdAt: new Date(remote.created_time) } : {}) } });
        imported++;
        return createJob(tx, "community", c.id);
      });
      if (job) { dispatchJob(job); await crisis(job.entityId); }
    }
    await db.postSchedule.update({ where: { id: s.id }, data: { commentsSyncedAt: new Date(), commentSyncError: result.complete ? null : "Đã đạt giới hạn 2.000 bình luận/lượt; kết quả chưa đầy đủ." } });
    return { imported, fetched: result.comments.length, complete: result.complete };
  } catch (e) {
    await db.postSchedule.update({ where: { id: s.id }, data: { commentsSyncedAt: new Date(), commentSyncError: safeError(e) } });
    throw e;
  }
}

export async function approveFacebookReply(tx, c, body, actor) {
  if (body.confirmFacebook !== true || body.sourceHash !== c.sourceHash) throw new HttpError(409, "Cần xác nhận gửi Facebook và kiểm tra phiên bản bình luận mới nhất.");
  if (c.remoteDeleted || c.analysisStatus !== "DONE" || c.replyStatus !== "PENDING") throw new HttpError(409, "Bình luận không còn chờ duyệt.");
  const replyText = text(body.replyText, "Phản hồi", 5000);
  await tx.facebookReply.deleteMany({ where: { commentId: c.id, status: "CANCELLED" } });
  await tx.facebookReply.create({ data: { commentId: c.id, pageId: c.pageId, sourceHash: c.sourceHash, text: replyText } });
  await tx.comment.update({ where: { id: c.id }, data: { replyText, replyStatus: "APPROVED" } });
  await audit(tx, actor, "FACEBOOK_REPLY_APPROVED", c.id);
}

export async function sendFacebookReply(db, id, { clientFactory = createFacebookClient } = {}) {
  const r = await db.$transaction(async tx => {
    const candidate = await tx.facebookReply.findUnique({ where: { id }, include: { comment: true } });
    if (!candidate) return null;
    await lock(tx, candidate.comment.externalId);
    const r = await tx.facebookReply.findUnique({ where: { id }, include: { comment: { include: { post: { include: { schedule: true } } } } } });
    if (!r || r.status !== "PENDING") return null;
    if (r.automatic) {
      const rule = await tx.facebookAutomation.findUnique({ where: { id: "default" } });
      const settings = await tx.settings.findUnique({ where: { id: "default" } });
      if (!rule?.commentEnabled || rule.pageId !== r.pageId || +rule.version !== +r.automationVersion || settings?.mode !== "CONDITIONAL") {
        await tx.facebookReply.update({ where: { id }, data: { status: "CANCELLED", error: "Đã tắt/đổi mẫu tự động; có thể chuyển duyệt thủ công." } });
        await tx.comment.updateMany({ where: { id: r.commentId, replyStatus: "APPROVED" }, data: { replyStatus: "PENDING", replyText: null } }); return null;
      }
    }
    if (r.comment.remoteDeleted || r.comment.sourceHash !== r.sourceHash || r.comment.replyStatus !== "APPROVED") {
      await tx.facebookReply.update({ where: { id }, data: { status: "CANCELLED", error: "Bình luận đã đổi hoặc bị xóa; cần duyệt lại." } }); return null;
    }
    await tx.facebookReply.update({ where: { id }, data: { status: "SENDING", attemptedAt: new Date(), error: null } });
    return r;
  });
  if (!r) return { status: "IGNORED" };
  let sending = false, externalId;
  try {
    const client = clientFactory();
    if (client.pageId !== r.pageId) throw new FacebookError("Page đã đổi; chưa gửi phản hồi.");
    await client.identity();
    const remotePostId = r.comment.post.schedule?.externalPostId;
    if (!remotePostId) throw new FacebookError("Bài gốc chưa có ID Facebook hợp lệ.");
    // Top-level comments do not always expose parent. Bind membership through
    // the original post's top-level comments edge, never an arbitrary ID alone.
    const current = await client.comments(remotePostId);
    const remote = current.comments.find(c => c.id === r.comment.externalId);
    if (!remote || commentHash(remote.message || "") !== r.sourceHash || remote.from?.id === r.pageId)
      throw new FacebookError("Bình luận Facebook đã thay đổi. Đồng bộ và duyệt lại trước khi gửi.");
    sending = true;
    externalId = await client.reply(r.comment.externalId, r.text);
  } catch (e) {
    const status = sending && (!(e instanceof FacebookError) || e.uncertain) ? "UNCERTAIN" : "FAILED";
    await db.facebookReply.updateMany({ where: { id, status: { in: ["SENDING", "UNCERTAIN"] } }, data: { status, error: safeError(e) } });
    return { status };
  }
  // Do not turn a failed DB commit after a successful send into a retryable send.
  await db.$transaction(async tx => {
    await tx.facebookReply.update({ where: { id }, data: { status: "SENT", externalId, error: null } });
    await audit(tx, "SYSTEM", "FACEBOOK_REPLY_SENT", r.commentId, externalId);
  });
  return { status: "SENT", externalId };
}

export async function recoverFacebookReplies(db, now = new Date()) {
  await db.facebookReply.updateMany({ where: { status: "SENDING", attemptedAt: { lt: new Date(now - 300000) } }, data: { status: "UNCERTAIN", error: "Chưa rõ kết quả gửi. Kiểm tra Page và đối soát ID; không tự gửi lại." } });
}

export async function collectFacebookMetrics(db, id, client = createFacebookClient()) {
  const s = await db.postSchedule.findUnique({ where: { id } });
  if (!s || s.target !== "FACEBOOK" || s.status !== "PUBLISHED" || s.pageId !== client.pageId || !s.externalPostId) throw new HttpError(409, "Bài chưa xuất bản lên Page đang kết nối.");
  return db.facebookMetricSnapshot.create({ data: { scheduleId: id, metrics: await client.metrics(s.externalPostId) } });
}

export function validFacebookSignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || !secret || !/^sha256=[a-f0-9]{64}$/.test(signature || "")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
export async function acceptFacebookWebhook(db, raw, signature, config = facebookConfig()) {
  if (!validFacebookSignature(raw, signature, config.appSecret)) throw new HttpError(403, "Chữ ký Facebook không hợp lệ.");
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "Webhook không hợp lệ."); }
  if (payload.object !== "page" || !Array.isArray(payload.entry)) return;
  for (const entry of payload.entry.slice(0, 100)) {
    if (entry.id !== config.pageId) continue;
    for (const message of (Array.isArray(entry.messaging) ? entry.messaging : []).slice(0, 100)) {
      if (message.recipient?.id !== config.pageId || message.sender?.id === config.pageId || message.message?.is_echo || typeof message.message?.mid !== "string") continue;
      const event = { type: "MESSENGER", inboundId: message.message.mid };
      const dedupeKey = commentHash(`messenger:${entry.id}:${message.message.mid}`);
      await db.facebookEvent.upsert({ where: { dedupeKey }, update: {}, create: { dedupeKey, pageId: entry.id, payload: event } });
    }
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []).slice(0, 100)) {
      const v = change.value;
      if (change.field !== "feed" || v?.item !== "comment" || !/^\d+_\d+$/.test(v.comment_id || "") || !/^\d+_\d+$/.test(v.post_id || "")) continue;
      const event = { postId: v.post_id, commentId: v.comment_id, verb: v.verb, time: entry.time };
      const dedupeKey = commentHash(JSON.stringify({ ...event, value: v }));
      await db.facebookEvent.upsert({ where: { dedupeKey }, update: {}, create: { dedupeKey, pageId: entry.id, payload: event } });
    }
  }
}

export async function processFacebookEvents(db, options = {}) {
  const events = await db.facebookEvent.findMany({ where: { OR: [{ status: "PENDING" }, { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - 300000) } }] }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const e of events) {
    const claimed = await db.facebookEvent.updateMany({ where: { id: e.id, status: e.status, updatedAt: e.updatedAt }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      if (e.payload.type === "MESSENGER") {
        const client = options.client || createFacebookClient();
        if (client.pageId === e.pageId) await ingestInboxMessage(db, await client.incomingMessage(e.payload.inboundId), e.pageId);
        await db.facebookEvent.update({ where: { id: e.id }, data: { status: "DONE", error: null } });
        continue;
      }
      let s = await db.postSchedule.findUnique({ where: { externalPostId: e.payload.postId } });
      if (!s) {
        await discoverFacebookPosts(db, options.client || createFacebookClient());
        s = await db.postSchedule.findUnique({ where: { externalPostId: e.payload.postId } });
      }
      if (s?.pageId === e.pageId && s.status === "PUBLISHED") {
        if (e.payload.verb === "remove") {
          await db.$transaction(async tx => {
            await lock(tx, e.payload.commentId);
            const c = await tx.comment.findUnique({ where: { externalId: e.payload.commentId } });
            if (c && c.postId === s.postId && c.source === "FACEBOOK") {
              await tx.comment.update({ where: { id: c.id }, data: { remoteDeleted: true } });
              await tx.facebookReply.updateMany({ where: { commentId: c.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED", error: "Bình luận đã bị xóa trên Facebook." } });
              await tx.workflowJob.updateMany({ where: { kind: "community", entityId: c.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED" } });
            }
          });
        } else await syncFacebookComments(db, s.id, options);
      }
      await db.facebookEvent.update({ where: { id: e.id }, data: { status: "DONE", error: null } });
    } catch (err) {
      await db.facebookEvent.update({ where: { id: e.id }, data: { status: e.attempts >= 4 ? "FAILED" : "PENDING", error: safeError(err) } });
    }
  }
}

export function startFacebookWorker(db) {
  let stopped = false, running = false, ticks = 0;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await recoverFacebookReplies(db);
      await recoverInboxReplies(db);
      await processFacebookEvents(db);
      await queueAutomaticComments(db);
      const pending = await db.facebookReply.findMany({ where: { status: "PENDING" }, take: 10, orderBy: { createdAt: "asc" } });
      for (const r of pending) { if (stopped) break; await sendFacebookReply(db, r.id); }
      const inbox = await db.facebookInboxReply.findMany({ where: { status: "PENDING" }, take: 10, orderBy: { createdAt: "asc" } });
      for (const r of inbox) { if (stopped) break; await sendInboxReply(db, r.id); }
      if (ticks++ % 4 === 0 && !stopped) {
        try { await pollFacebookInbox(db); } catch { /* Sanitized error is visible in automation settings. */ }
        try {
          const discovery = await discoverFacebookPosts(db);
          if (!discovery.complete) console.error("Facebook: danh sách bài Page chưa đầy đủ; cần đồng bộ tiếp.");
        } catch (e) { console.error("Facebook discovery:", safeError(e)); }
        const schedules = await db.postSchedule.findMany({ where: { target: "FACEBOOK", status: "PUBLISHED", OR: [{ commentsSyncedAt: null }, { commentsSyncedAt: { lt: new Date(Date.now() - 120000) } }] }, include: { metricSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, take: 5, orderBy: { commentsSyncedAt: { sort: "asc", nulls: "first" } } });
        for (const s of schedules) {
          if (stopped) break;
          try { await syncFacebookComments(db, s.id); } catch { /* Sanitized error is stored on the schedule. */ }
          if (!s.metricSnapshots[0] || Date.now() - s.metricSnapshots[0].capturedAt > 900000) {
            try { await collectFacebookMetrics(db, s.id); } catch { /* Keep the previous timestamp visible rather than inventing a new snapshot. */ }
          }
        }
      }
    } catch (e) { console.error("Facebook worker:", e.code || e.name); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000); timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
