import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import { retrieveAnswer, getBrandVoice, updateBrandVoice } from "../src/services/retrieval.js";

const skip = process.env.RUN_DB_TESTS !== "true";

// Tạo tài liệu tri thức có phiên bản kích hoạt + chunks (helper).
async function seedDocument(pageId, title, chunks, { activate = true, archive = false } = {}) {
  const doc = await db.knowledgeDocument.create({
    data: {
      pageId,
      kind: "UPLOAD",
      title,
      archivedAt: archive ? new Date() : null,
    },
  });
  const version = await db.knowledgeVersion.create({
    data: {
      documentId: doc.id,
      version: 1,
      status: activate ? "APPROVED" : "DRAFT",
      extractionStatus: "OK",
      body: { text: chunks[0] },
      createdBy: "test",
    },
  });
  await db.knowledgeChunk.createMany({
    data: chunks.map((text, i) => ({ versionId: version.id, ordinal: i + 1, text, locator: `upload:${title}#${i + 1}` })),
  });
  if (activate)
    await db.knowledgeDocument.update({ where: { id: doc.id }, data: { activeVersionId: version.id } });
  return doc;
}

test("retrieval: SUFFICIENT có nguồn id/version, chỉ dùng bản đã kích hoạt", { skip }, async () => {
  const pageId = "ret-" + randomUUID();
  const doc = await seedDocument(pageId, "gio-mo-cua.txt", [
    "Quán mở cửa từ 8 giờ sáng đến 22 giờ tối mỗi ngày.",
    "Chủ nhật mở cửa từ 9 giờ sáng.",
  ]);
  try {
    const r = await retrieveAnswer(db, { question: "quán mở cửa mấy giờ?", pageId });
    assert.equal(r.status, "SUFFICIENT");
    assert.ok(r.answer && r.answer.length > 0);
    assert.ok(r.sources.length >= 1);
    assert.equal(r.sources[0].documentId, doc.id);
    assert.equal(r.sources[0].version, 1);
    assert.ok(r.sources[0].versionId);
    assert.ok(r.sources[0].excerpt.length <= 300);
    assert.ok(r.brandVoice && typeof r.brandVoice.tone === "string");
  } finally {
    await db.knowledgeDocument.deleteMany({ where: { pageId } });
    await db.$disconnect();
  }
});

test("retrieval: INSUFFICIENT khi thiếu nguồn — answer null, không bịa", { skip }, async () => {
  const pageId = "ret-" + randomUUID();
  // Chỉ có bản nháp (chưa kích hoạt) — không được dùng cho trả lời
  await seedDocument(pageId, "draft.txt", ["Thông tin nội bộ về giá vốn sản phẩm."], { activate: false });
  await seedDocument(pageId, "archived.txt", ["Giá cà phê dao động mỗi mùa."], { archive: true });
  try {
    const r = await retrieveAnswer(db, { question: "chính sách đổi trả thế nào?", pageId });
    assert.equal(r.status, "INSUFFICIENT");
    assert.equal(r.answer, null);
    assert.equal(r.sources.length, 0);
    // Bản nháp + lưu trữ không lọt vào nguồn
    const r2 = await retrieveAnswer(db, { question: "giá vốn sản phẩm bao nhiêu?", pageId });
    assert.equal(r2.status, "INSUFFICIENT");
  } finally {
    await db.knowledgeDocument.deleteMany({ where: { pageId } });
    await db.$disconnect();
  }
});

test("retrieval: CONFLICT khi hai nguồn cùng độ khớp khác tài liệu — không tự chọn", { skip }, async () => {
  const pageId = "ret-" + randomUUID();
  await seedDocument(pageId, "thong-tin-a.txt", ["Quán mở cửa lúc 7 giờ sáng."]);
  await seedDocument(pageId, "thong-tin-b.txt", ["Quán mở cửa lúc 10 giờ sáng."]);
  try {
    const r = await retrieveAnswer(db, { question: "quán mở cửa lúc mấy giờ sáng?", pageId });
    assert.equal(r.status, "CONFLICT");
    assert.equal(r.answer, null); // không tự chọn nguồn
    assert.ok(r.conflicts.length >= 1);
    assert.notEqual(r.conflicts[0].a.documentId, r.conflicts[0].b.documentId);
  } finally {
    await db.knowledgeDocument.deleteMany({ where: { pageId } });
    await db.$disconnect();
  }
});

test("brand voice: đọc/ghi CAS, validate, trả kèm hợp đồng truy xuất", { skip }, async () => {
  const pageId = "ret-" + randomUUID();
  await seedDocument(pageId, "ca-phe.txt", ["Cà phê rang xay nguyên chất từ Đà Lạt."]);
  try {
    const before = await getBrandVoice(db, pageId);
    const saved = await updateBrandVoice(db, {
      tone: "trẻ trung, năng động",
      style: "Ngắn gọn, dùng emoji vừa phải",
      forbidden: "Không hứa hẹn giảm giá",
      version: before.version,
    });
    assert.equal(saved.tone, "trẻ trung, năng động");
    const bumped = await updateBrandVoice(db, { tone: "khác", version: saved.version });
    assert.equal(bumped.version, saved.version + 1); // cập nhật tăng version
    await assert.rejects(
      updateBrandVoice(db, { tone: "cũ", version: saved.version }),
      (e) => e.status === 409, // CAS: version đã stale
    );
    const r = await retrieveAnswer(db, { question: "cà phê có nguồn gốc từ đâu?", pageId });
    assert.equal(r.brandVoice.tone, "khác"); // giọng mới nhất được trả kèm hợp đồng
    assert.match(r.brandVoice.forbidden, /không hứa hẹn/i);
  } finally {
    await db.brandVoice.deleteMany({ where: { id: "default" } });
    await db.knowledgeDocument.deleteMany({ where: { pageId } });
    await db.$disconnect();
  }
});
