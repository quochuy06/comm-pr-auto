import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import {
  createReplyDecision,
  reviewReplyDecision,
  editReplyDecision,
  listReplyDecisions,
} from "../src/services/replyDecisions.js";

const skip = process.env.RUN_DB_TESTS !== "true";

test("createReplyDecision: ràng buộc kênh/chế độ/quyết định/snapshot", { skip }, async () => {
  const ids = [];
  try {
    for (const bad of [
      { channel: "ZALO", mode: "AUTO", inboundText: "x" },
      { channel: "COMMENT", mode: "TỰ ĐỘNG", inboundText: "x" },
      { channel: "COMMENT", mode: "SEMI_AUTO", inboundText: "x", decision: "SENT" },
      { channel: "COMMENT", mode: "SEMI_AUTO", inboundText: "" },
      { channel: "COMMENT", mode: "SEMI_AUTO", inboundText: "x", decision: "READY_TO_SEND" }, // SEMI_AUTO không được READY_TO_SEND
      {
        channel: "COMMENT", mode: "AUTO", inboundText: "x",
        sourceSnapshot: { pageId: "p1", sources: [{ id: "src-1", version: 1, pageId: "p2" }] }, // nguồn khác Page
      },
    ])
      await assert.rejects(createReplyDecision(db, bad), (e) => e.status === 400);

    const ok = await createReplyDecision(db, {
      pageId: "p1", channel: "COMMENT", mode: "SEMI_AUTO", inboundText: "sao cà phê đắt thế",
      replyText: "Cảm ơn bạn đã phản hồi!", ruleId: "rule-1",
      sourceSnapshot: { pageId: "p1", sources: [{ id: "src-1", version: 2, pageId: "p1" }] },
      decision: "PENDING_APPROVAL",
    }, { createdBy: "editor-1" });
    ids.push(ok.id);
    assert.equal(ok.status, "PENDING");
    assert.equal(ok.sourceSnapshot.sources[0].version, 2);
    const audit = await db.auditLog.findFirst({ where: { entityId: ok.id, action: "reply_decision.create" } });
    assert.ok(audit);
  } finally {
    await db.replyDecision.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});

test("review/edit: idempotent duyệt, chặn sửa sau duyệt, NEEDS_HUMAN không tự duyệt, có audit", { skip }, async () => {
  const ids = [];
  try {
    const pending = await createReplyDecision(db, {
      channel: "MESSENGER", mode: "SEMI_AUTO", inboundText: "shop còn mở không",
      replyText: "Dạ shop mở 8–22h ạ.", decision: "PENDING_APPROVAL",
    }, { createdBy: "editor-1" });
    ids.push(pending.id);

    // REVIEWER sửa nội dung trước khi duyệt
    const edited = await editReplyDecision(db, pending.id, { replyText: "Dạ shop mở 8h–22h hàng ngày ạ.", editor: "rev-1" });
    assert.match(edited.replyText, /hàng ngày/);
    assert.equal(edited.decision, "PENDING_APPROVAL");

    // Duyệt idempotent
    const approved = await reviewReplyDecision(db, pending.id, { approve: true, reviewer: "rev-1" });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.reviewedBy, "rev-1");
    const again = await reviewReplyDecision(db, pending.id, { approve: true, reviewer: "rev-2" });
    assert.equal(again.reviewedBy, "rev-1"); // không ghi đè kết quả cũ

    // Không sửa được sau duyệt
    await assert.rejects(editReplyDecision(db, pending.id, { replyText: "đổi ý", editor: "rev-1" }), (e) => e.status === 409);

    // NEEDS_HUMAN: không cho tự duyệt, chỉ reject có lý do
    const human = await createReplyDecision(db, {
      channel: "COMMENT", mode: "AUTO", inboundText: "tôi sẽ kiện các bạn",
      replyText: "", decision: "NEEDS_HUMAN", reason: "Nội dung nhạy cảm",
    }, { createdBy: "editor-1" });
    ids.push(human.id);
    await assert.rejects(reviewReplyDecision(db, human.id, { approve: true, reviewer: "rev-1" }), (e) => e.status === 409);
    const rejected = await reviewReplyDecision(db, human.id, { approve: false, reviewer: "rev-1", reason: "Chuyển quản lý xử lý" });
    assert.equal(rejected.status, "REJECTED");
    assert.match(rejected.reason, /quản lý/);

    // List theo filter
    const list = await listReplyDecisions(db, { channel: "MESSENGER", status: "APPROVED" });
    assert.ok(list.some((d) => d.id === pending.id));
  } finally {
    await db.replyDecision.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
