import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors.js";

// PHUC-API03: hàng duyệt phản hồi hai kênh. AI chỉ SOẠN — mọi quyết định gửi
// phải qua người duyệt. Mỗi quyết định giữ nguyên trạng nguồn (sourceSnapshot)
// và luật (ruleId) tại thời điểm soạn; đổi nội dung thì snapshot ghi rõ.
const CHANNELS = ["COMMENT", "MESSENGER"];
const MODES = ["OFF", "SEMI_AUTO", "AUTO"];
const DECISIONS = ["PENDING_APPROVAL", "READY_TO_SEND", "SKIPPED", "NEEDS_HUMAN"];

function validateSourceSnapshot(snapshot) {
  if (snapshot === undefined || snapshot === null) return null;
  if (typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new HttpError(400, "Source snapshot không hợp lệ.");
  const sources = snapshot.sources ?? [];
  if (!Array.isArray(sources))
    throw new HttpError(400, "Source snapshot không hợp lệ.");
  for (const s of sources) {
    if (!s || typeof s.id !== "string" || !Number.isInteger(s.version) || s.version < 1)
      throw new HttpError(400, "Nguồn trong snapshot phải có id và version.");
    if (s.pageId !== undefined && s.pageId !== snapshot.pageId)
      throw new HttpError(400, "Nguồn trong snapshot phải thuộc cùng Page.");
  }
  return snapshot;
}

export async function createReplyDecision(db, input, { createdBy = "system" } = {}) {
  const channel = input.channel;
  const mode = input.mode;
  const decision = input.decision || "PENDING_APPROVAL";
  if (!CHANNELS.includes(channel)) throw new HttpError(400, "Kênh phải là COMMENT hoặc MESSENGER.");
  if (!MODES.includes(mode)) throw new HttpError(400, "Chế độ phải là OFF, SEMI_AUTO hoặc AUTO.");
  if (!DECISIONS.includes(decision)) throw new HttpError(400, "Loại quyết định không hợp lệ.");
  const inboundText = typeof input.inboundText === "string" ? input.inboundText.trim() : "";
  if (!inboundText || inboundText.length > 5000)
    throw new HttpError(400, "Nội dung đầu vào phải từ 1 đến 5000 ký tự.");
  const replyText = typeof input.replyText === "string" ? input.replyText.trim() : "";
  if (replyText.length > 2000) throw new HttpError(400, "Câu trả lời tối đa 2000 ký tự.");
  if (decision === "READY_TO_SEND" && mode !== "AUTO")
    throw new HttpError(400, "Chỉ chế độ AUTO mới được READY_TO_SEND; SEMI_AUTO phải chờ duyệt.");
  const record = await db.replyDecision.create({
    data: {
      id: randomUUID(),
      pageId: String(input.pageId || "default"),
      channel,
      inboundId: input.inboundId || null,
      inboundText,
      mode,
      decision,
      ruleId: input.ruleId || null,
      replyText: replyText || null,
      sourceSnapshot: validateSourceSnapshot(input.sourceSnapshot),
      reason: input.reason ? String(input.reason).slice(0, 1000) : null,
      status: "PENDING", // mọi quyết định đều chờ người duyệt trước khi gửi
    },
  });
  await db.auditLog.create({
    data: { actor: createdBy, action: "reply_decision.create", entityId: record.id, detail: `${channel}/${mode}/${decision}` },
  });
  return record;
}

export async function reviewReplyDecision(db, id, { approve, reviewer, reason } = {}) {
  const record = await db.replyDecision.findUnique({ where: { id } });
  if (!record) throw new HttpError(404, "Không tìm thấy quyết định phản hồi.");
  if (record.status !== "PENDING")
    return record; // idempotent: đã xử lý rồi thì giữ nguyên kết quả
  if (record.decision === "NEEDS_HUMAN" && approve)
    throw new HttpError(409, "Ca này được đánh dấu cần người xử lý; xem lý do trước khi duyệt.");
  const updated = await db.replyDecision.update({
    where: { id },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      reviewedBy: reviewer || null,
      reviewedAt: new Date(),
      reason: reason ? String(reason).slice(0, 1000) : record.reason,
    },
  });
  await db.auditLog.create({
    data: {
      actor: reviewer || "system",
      action: approve ? "reply_decision.approve" : "reply_decision.reject",
      entityId: id,
      detail: reason ? String(reason).slice(0, 200) : null,
    },
  });
  return updated;
}

// Sửa nội dung soạn sẵn — chỉ khi chưa duyệt; audit ghi rõ đã sửa.
export async function editReplyDecision(db, id, { replyText, editor }) {
  const record = await db.replyDecision.findUnique({ where: { id } });
  if (!record) throw new HttpError(404, "Không tìm thấy quyết định phản hồi.");
  if (record.status !== "PENDING")
    throw new HttpError(409, "Quyết định đã được xử lý; không sửa được nữa.");
  const text = typeof replyText === "string" ? replyText.trim() : "";
  if (!text || text.length > 2000)
    throw new HttpError(400, "Câu trả lời phải từ 1 đến 2000 ký tự.");
  const updated = await db.replyDecision.update({
    where: { id },
    data: { replyText: text, decision: "PENDING_APPROVAL" },
  });
  await db.auditLog.create({
    data: { actor: editor || "system", action: "reply_decision.edit", entityId: id, detail: "Đã sửa nội dung soạn sẵn" },
  });
  return updated;
}

export async function listReplyDecisions(db, { pageId, channel, status } = {}) {
  return db.replyDecision.findMany({
    where: {
      ...(pageId ? { pageId } : {}),
      ...(channel ? { channel } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
