import { createHash } from "node:crypto";
import { HttpError, text, choice, audit } from "../lib/errors.js";
import { createJob } from "./workflows.js";
export const artifactKinds = ["planning", "repurpose", "report"];
export const publicationHash = p => createHash("sha256").update(JSON.stringify({ headline: p.headline, content: p.content, bannerUrl: p.bannerUrl, platform: p.platform, approvedBy: p.approvedBy, imagePrompt: p.imagePrompt })).digest("hex");
export function dateInput(value, label) {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) throw new HttpError(400, `${label} không hợp lệ.`);
  return new Date(value);
}
export function checkedPlan(result) {
  const { items, summary, groundedSources, knowledgeStatus } = result ?? {};
  if (!Array.isArray(items) || items.length < 1 || items.length > 20)
    throw new HttpError(400, "Kế hoạch cần 1–20 ý tưởng.");
  const plan = {
    summary: text(summary, "Tóm tắt", 3000),
    items: items.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new HttpError(400, "Ý tưởng không hợp lệ.");
      return {
        topic: text(item.topic, "Chủ đề", 1500),
        targetAudience: text(item.targetAudience, "Đối tượng", 500),
        tone: text(item.tone, "Giọng điệu", 200),
        platform: choice(item.platform, ["Facebook", "LinkedIn", "X"], "Nền tảng"),
        suggestedDate: text(item.suggestedDate, "Ngày đề xuất", 100),
        rationale: text(item.rationale, "Lý do", 1000),
        contentKind: choice(item.contentKind ?? "POST", ["POST", "IMAGE", "VIDEO"], "Loại nội dung"),
      };
    }),
    requiresHuman: true,
  };
  if (groundedSources != null) {
    if (!Array.isArray(groundedSources) || groundedSources.length > 20)
      throw new HttpError(400, "Nguồn tri thức không hợp lệ.");
    plan.groundedSources = groundedSources.map(source => {
      if (!Number.isInteger(source?.version) || source.version < 1)
        throw new HttpError(400, "Phiên bản nguồn tri thức không hợp lệ.");
      return { id: text(source.id, "ID nguồn tri thức", 128), version: source.version };
    });
  }
  if (knowledgeStatus != null)
    plan.knowledgeStatus = choice(knowledgeStatus, ["SUFFICIENT", "INSUFFICIENT", "CONFLICT"], "Trạng thái tri thức");
  return plan;
}
export function checkedReview(review) {
  if (!review || typeof review.safe !== "boolean" || typeof review.grounded !== "boolean") throw new HttpError(400, "Thiếu đánh giá độc lập.");
  return { safe: review.safe, grounded: review.grounded, risk: choice(review.risk, ["LOW", "MEDIUM", "HIGH"], "Rủi ro"), reason: text(review.reason, "Lý do", 5000) };
}
export async function createArtifact(db, kind, input, links = {}) {
  const artifact = await db.workflowArtifact.create({ data: { kind, input, ...links } });
  const job = await createJob(db, kind, artifact.id);
  return { artifact: { ...artifact, latestJobId: job.id }, job };
}
export async function publishSchedule(db, id, expectedUpdatedAt, now = new Date()) {
  // Serializes duplicate ticks and cancellation without a separate in-memory lease.
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
  const s = await db.postSchedule.findUnique({ where: { id }, include: { post: true } });
  if (!s) throw new HttpError(404, "Không có lịch đăng.");
  if (s.target && s.target !== "SIMULATOR") throw new HttpError(409, "Lịch Facebook phải qua bộ xuất bản Facebook.");
  if (s.status !== "PENDING" || s.updatedAt.toISOString() !== expectedUpdatedAt) return { status: "IGNORED", id };
  if (s.scheduledAt > now) return { status: "NOT_DUE", id };
  if (now - s.scheduledAt > 24 * 60 * 60 * 1000) {
    await db.postSchedule.update({ where: { id }, data: { status: "FAILED", error: "Lịch đã trễ quá 24 giờ; cần đặt lịch lại." } });
    return { status: "FAILED", id };
  }
  if (s.post.status !== "APPROVED" || publicationHash(s.post) !== s.contentHash || !s.post.approvedBy || !s.post.headline || !s.post.content || !s.post.bannerUrl) {
    await db.postSchedule.update({ where: { id }, data: { status: "FAILED", error: "Bài hoặc phiên bản duyệt đã thay đổi; cần kiểm tra và đặt lịch lại." } });
    return { status: "FAILED", id };
  }
  const changed = await db.post.updateMany({ where: { id: s.postId, status: "APPROVED", updatedAt: s.post.updatedAt }, data: { status: "PUBLISHED", publishedAt: now } });
  if (!changed.count) throw new HttpError(409, "Bài vừa thay đổi; lịch sẽ được kiểm tra ở lượt sau.");
  await db.postSchedule.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, error: null } });
  await audit(db, "SYSTEM", "POST_PUBLISHED", s.postId, "Feed mô phỏng; lịch " + id);
  return { status: "PUBLISHED", id, postId: s.postId };
}
