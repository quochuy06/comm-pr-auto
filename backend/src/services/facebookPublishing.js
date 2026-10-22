import { HttpError, audit } from "../lib/errors.js";
import { publicationHash, publishSchedule } from "./expansion.js";
import { createFacebookClient, FacebookError } from "./facebook.js";

export async function recoverFacebookSends(db, now = new Date()) {
  // A process crash cannot prove that Meta did not publish. Never auto-retry.
  await db.postSchedule.updateMany({ where: { target: "FACEBOOK", status: "SENDING", attemptedAt: { lt: new Date(now.getTime() - 5 * 60000) } },
    data: { status: "UNCERTAIN", error: "Chưa xác định kết quả gửi. Kiểm tra Page và đối soát ID bài; không tự gửi lại." } });
}

async function finish(db, id, outcome, actor = "SYSTEM") {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
    const s = await tx.postSchedule.findUniqueOrThrow({ where: { id }, include: { post: true } });
    if (!["SENDING", "UNCERTAIN"].includes(s.status)) return { status: "IGNORED", id };
    if (s.post.status !== "PUBLISHING" || publicationHash(s.post) !== s.contentHash) throw new HttpError(409, "Bài đã thay đổi trong khi gửi; cần đối soát.");
    const now = new Date();
    await tx.post.update({ where: { id: s.postId }, data: { status: "PUBLISHED", publishedAt: now } });
    await tx.postSchedule.update({ where: { id }, data: { ...outcome, status: "PUBLISHED", publishedAt: now, error: null } });
    await audit(tx, actor, "POST_PUBLISHED", s.postId, `Facebook ${s.pageId}; ${outcome.externalPostId}; lịch ${id}`);
    return { status: "PUBLISHED", id, postId: s.postId, ...outcome };
  });
}

export async function publishDueSchedule(db, id, expected, { clientFactory = createFacebookClient, now = new Date() } = {}) {
  const claimed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
    const s = await tx.postSchedule.findUnique({ where: { id }, include: { post: true } });
    if (!s) throw new HttpError(404, "Không có lịch đăng.");
    if (s.target === "SIMULATOR") return { result: await publishSchedule(tx, id, expected, now) };
    if (s.status !== "PENDING" || s.updatedAt.toISOString() !== expected) return { result: { status: "IGNORED", id } };
    if (s.scheduledAt > now) return { result: { status: "NOT_DUE", id } };
    if (s.target !== "FACEBOOK" || !s.pageId || s.externalPostId || now - s.scheduledAt > 86400000 || s.post.status !== "APPROVED" || s.post.platform !== "Facebook" || !s.post.approvedBy || !s.post.headline || !s.post.content || !s.post.bannerUrl || publicationHash(s.post) !== s.contentHash) {
      await tx.postSchedule.update({ where: { id }, data: { status: "FAILED", error: "Lịch quá hạn, sai kênh hoặc phiên bản duyệt đã thay đổi. Kiểm tra và đặt lại lịch." } });
      return { result: { status: "FAILED", id } };
    }
    const changed = await tx.post.updateMany({ where: { id: s.postId, status: "APPROVED", updatedAt: s.post.updatedAt }, data: { status: "PUBLISHING" } });
    if (!changed.count) throw new HttpError(409, "Bài vừa thay đổi; hãy kiểm tra lại.");
    await tx.postSchedule.update({ where: { id }, data: { status: "SENDING", attemptedAt: now, error: null } });
    await audit(tx, "SYSTEM", "FACEBOOK_SEND_STARTED", s.postId, id);
    return { schedule: s };
  });
  if (claimed.result) return claimed.result;
  let sending = false, outcome;
  try {
    const client = clientFactory();
    const body = await client.prepare(claimed.schedule.post, claimed.schedule.pageId);
    sending = true;
    outcome = await client.publish(body);
  } catch (e) {
    const uncertain = sending && (!(e instanceof FacebookError) || e.uncertain);
    const status = uncertain ? "UNCERTAIN" : "FAILED";
    const error = e instanceof FacebookError ? e.message : "Không thể hoàn tất gửi Facebook.";
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
      const changed = await tx.postSchedule.updateMany({ where: { id, status: { in: ["SENDING", "UNCERTAIN"] } }, data: { status, error } });
      if (changed.count && !uncertain) await tx.post.updateMany({ where: { id: claimed.schedule.postId, status: "PUBLISHING" }, data: { status: "APPROVED" } });
    });
    return { status, id };
  }
  // A DB failure after Meta success leaves SENDING, subsequently UNCERTAIN.
  // It must never be classified as a definite failure or automatically retried.
  return finish(db, id, outcome);
}

export async function reconcileFacebookPost(db, id, externalPostId, actor, client = createFacebookClient()) {
  const s = await db.postSchedule.findUniqueOrThrow({ where: { id }, include: { post: true } });
  if (s.target !== "FACEBOOK" || s.status !== "UNCERTAIN") throw new HttpError(409, "Chỉ đối soát lịch chưa xác định kết quả.");
  const outcome = await client.verifyPost(externalPostId, s);
  return finish(db, id, outcome, actor);
}
