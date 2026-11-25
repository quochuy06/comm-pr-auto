import { randomUUID } from "node:crypto";
import { HttpError } from "../lib/errors.js";

// PHUC-API03: hàng duyệt phản hồi hai kênh. AI chỉ SOẠN — mọi quyết định gửi
// phải qua người duyệt. Snapshot và luật ghi nhận nguồn tại thời điểm soạn;
// audit lưu các lần người duyệt sửa nội dung.
const CHANNELS = ["COMMENT", "MESSENGER"];
const MODES = ["OFF", "SEMI_AUTO", "AUTO"];
const DECISIONS = ["PENDING_APPROVAL", "READY_TO_SEND", "SKIPPED", "NEEDS_HUMAN"];

function validateSourceSnapshot(snapshot, pageId) {
  if (snapshot === undefined || snapshot === null) return null;
  if (typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new HttpError(400, "Source snapshot không hợp lệ.");
  if (snapshot.pageId !== undefined && snapshot.pageId !== pageId)
    throw new HttpError(400, "Snapshot tri thức phải thuộc cùng Page với phản hồi.");
  const sources = snapshot.sources ?? [];
  if (!Array.isArray(sources))
    throw new HttpError(400, "Source snapshot không hợp lệ.");
  for (const s of sources) {
    if (!s || typeof s.id !== "string" || !Number.isInteger(s.version) || s.version < 1)
      throw new HttpError(400, "Nguồn trong snapshot phải có id và version.");
    if (s.pageId !== undefined && s.pageId !== pageId)
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
  const pageId = String(input.pageId || "default");
  const sourceSnapshot = validateSourceSnapshot(input.sourceSnapshot, pageId);
  return db.$transaction(async (tx) => {
    const record = await tx.replyDecision.create({
      data: {
        id: randomUUID(),
        pageId,
        channel,
        inboundId: input.inboundId || null,
        inboundText,
        mode,
        decision,
        ruleId: input.ruleId || null,
        replyText: replyText || null,
        sourceSnapshot,
        reason: input.reason ? String(input.reason).slice(0, 1000) : null,
        status: "PENDING",
      },
    });
    await tx.auditLog.create({
      data: { actor: createdBy, action: "reply_decision.create", entityId: record.id, detail: `${channel}/${mode}/${decision}` },
    });
    return record;
  });
}

const changedMessage = "Quyết định phản hồi đã thay đổi. Tải lại và kiểm tra nội dung mới nhất.";

async function getReplyDecision(tx, id) {
  const record = await tx.replyDecision.findUnique({ where: { id } });
  if (!record) throw new HttpError(404, "Không tìm thấy quyết định phản hồi.");
  return record;
}

function checkReplyVersion(record, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined) return;
  const timestamp = typeof expectedUpdatedAt === "string" ? Date.parse(expectedUpdatedAt) : NaN;
  if (!Number.isFinite(timestamp)) throw new HttpError(400, "Phiên bản phản hồi không hợp lệ.");
  if (record.updatedAt.getTime() !== timestamp) throw new HttpError(409, changedMessage);
}

function pendingReply(record) {
  return {
    id: record.id,
    status: "PENDING",
    updatedAt: record.updatedAt,
    replyText: record.replyText,
    decision: record.decision,
  };
}

export async function reviewReplyDecision(db, id, { approve, reviewer, reason, expectedUpdatedAt } = {}) {
  const status = approve ? "APPROVED" : "REJECTED";
  return db.$transaction(async (tx) => {
    const record = await getReplyDecision(tx, id);
    if (record.status === status) return record;
    if (record.status !== "PENDING") throw new HttpError(409, changedMessage);
    checkReplyVersion(record, expectedUpdatedAt);
    if (approve && record.decision === "NEEDS_HUMAN")
      throw new HttpError(409, "Ca này được đánh dấu cần người xử lý; xem lý do trước khi duyệt.");
    if (approve && (record.decision === "SKIPPED" || !record.replyText?.trim()))
      throw new HttpError(409, "Cần một bản trả lời hợp lệ trước khi duyệt.");
    const { count } = await tx.replyDecision.updateMany({
      where: pendingReply(record),
      data: {
        status,
        reviewedBy: reviewer || null,
        reviewedAt: new Date(),
        reason: reason ? String(reason).slice(0, 1000) : record.reason,
      },
    });
    if (!count) {
      const current = await getReplyDecision(tx, id);
      if (current.status === status) return current;
      throw new HttpError(409, changedMessage);
    }
    await tx.auditLog.create({
      data: {
        actor: reviewer || "system",
        action: approve ? "reply_decision.approve" : "reply_decision.reject",
        entityId: id,
        detail: reason ? String(reason).slice(0, 200) : null,
      },
    });
    return getReplyDecision(tx, id);
  });
}

// Sửa nội dung soạn sẵn — chỉ khi chưa duyệt; audit ghi rõ đã sửa.
export async function editReplyDecision(db, id, { replyText, editor, expectedUpdatedAt }) {
  const text = typeof replyText === "string" ? replyText.trim() : "";
  if (!text || text.length > 2000)
    throw new HttpError(400, "Câu trả lời phải từ 1 đến 2000 ký tự.");
  return db.$transaction(async (tx) => {
    const record = await getReplyDecision(tx, id);
    if (record.status !== "PENDING")
      throw new HttpError(409, "Quyết định đã được xử lý; không sửa được nữa.");
    checkReplyVersion(record, expectedUpdatedAt);
    const updatedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1));
    const { count } = await tx.replyDecision.updateMany({
      where: pendingReply(record),
      data: { replyText: text, decision: "PENDING_APPROVAL", updatedAt },
    });
    if (!count) throw new HttpError(409, changedMessage);
    await tx.auditLog.create({
      data: { actor: editor || "system", action: "reply_decision.edit", entityId: id, detail: "Đã sửa nội dung soạn sẵn" },
    });
    return getReplyDecision(tx, id);
  });
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
