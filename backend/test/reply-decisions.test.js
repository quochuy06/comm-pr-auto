import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import db from "../src/prisma.js";
import { tokenHash } from "../src/lib/security.js";
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
      {
        pageId: "p1", channel: "COMMENT", mode: "AUTO", inboundText: "x",
        sourceSnapshot: { pageId: "p2", sources: [{ id: "src-1", version: 1, pageId: "p2" }] },
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

test("review/edit: chặn bản cũ và chỉ ghi một quyết định khi xử lý đồng thời", { skip }, async () => {
  const ids = [];
  try {
    const pending = await createReplyDecision(db, {
      channel: "COMMENT", mode: "SEMI_AUTO", inboundText: "Còn hàng không?",
      replyText: "Bản soạn đầu tiên",
    });
    ids.push(pending.id);
    const original = await db.replyDecision.update({
      where: { id: pending.id },
      data: { updatedAt: new Date("2026-11-01T00:00:00.000Z") },
    });
    const originalVersion = original.updatedAt.toISOString();
    const edited = await editReplyDecision(db, pending.id, {
      replyText: "Bản người duyệt đã sửa",
      editor: "rev-1",
      expectedUpdatedAt: originalVersion,
    });
    await assert.rejects(
      reviewReplyDecision(db, pending.id, { approve: true, reviewer: "rev-2", expectedUpdatedAt: originalVersion }),
      (err) => err.status === 409,
    );
    await assert.rejects(
      editReplyDecision(db, pending.id, { replyText: "Nội dung bị ghi đè", expectedUpdatedAt: originalVersion }),
      (err) => err.status === 409,
    );
    const version = edited.updatedAt.toISOString();
    const outcomes = await Promise.allSettled([
      reviewReplyDecision(db, pending.id, { approve: true, reviewer: "rev-1", expectedUpdatedAt: version }),
      reviewReplyDecision(db, pending.id, { approve: false, reviewer: "rev-2", reason: "Cần xác minh", expectedUpdatedAt: version }),
    ]);
    const [winner] = outcomes.filter((result) => result.status === "fulfilled");
    const [loser] = outcomes.filter((result) => result.status === "rejected");
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(loser.reason.status, 409);
    assert.equal(winner.value.replyText, edited.replyText);
    const audit = await db.auditLog.findMany({
      where: { entityId: pending.id, action: { in: ["reply_decision.approve", "reply_decision.reject"] } },
    });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor, winner.value.reviewedBy);

    const empty = await createReplyDecision(db, {
      channel: "MESSENGER", mode: "OFF", inboundText: "Chào", decision: "SKIPPED",
    });
    ids.push(empty.id);
    await assert.rejects(reviewReplyDecision(db, empty.id, { approve: true, reviewer: "rev-1" }), (err) => err.status === 409);
  } finally {
    await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
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

test("reply decision API: reviewer chỉ duyệt được phiên bản đã xem", { skip }, async () => {
  const token = randomUUID();
  const user = await db.user.create({
    data: {
      email: `${token}@qa.invalid`, name: "QA reviewer", role: "REVIEWER", passwordHash: "unused",
      sessions: { create: { tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60000) } },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  let pending;
  try {
    await once(server, "listening");
    pending = await createReplyDecision(db, {
      channel: "MESSENGER", mode: "SEMI_AUTO", inboundText: "Cho mình xin thông tin",
      replyText: "Bản soạn đầu tiên",
    });
    const path = `http://127.0.0.1:${server.address().port}/api/reply-decisions/${pending.id}`;
    const call = (suffix, method, body) => fetch(path + suffix, {
      method,
      headers: { "Content-Type": "application/json", Cookie: `comm_session=${token}` },
      body: JSON.stringify(body),
    });
    const expectedUpdatedAt = pending.updatedAt.toISOString();
    const edit = await call("", "PATCH", { replyText: "Bản phản hồi sau khi sửa", expectedUpdatedAt });
    assert.equal(edit.status, 200);
    const edited = (await edit.json()).data;
    const stale = await call("/approve", "POST", { expectedUpdatedAt });
    assert.equal(stale.status, 409);
    const approval = await call("/approve", "POST", { expectedUpdatedAt: edited.updatedAt });
    assert.equal(approval.status, 200);
    const approved = (await approval.json()).data;
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.replyText, edited.replyText);
    assert.equal(approved.reviewedBy, user.id);
    const conflict = await call("/reject", "POST", { reason: "Đã duyệt từ tab khác", expectedUpdatedAt });
    assert.equal(conflict.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (pending) {
      await db.auditLog.deleteMany({ where: { entityId: pending.id } });
      await db.replyDecision.delete({ where: { id: pending.id } });
    }
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
