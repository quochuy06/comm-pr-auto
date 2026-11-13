import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/prisma.js";
import {
  detectUploadType,
  validateUpload,
  ingestUpload,
  getUpload,
  chunkText,
  uploadDir,
} from "../src/services/documents.js";

const skip = process.env.RUN_DB_TESTS !== "true";
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name) => readFile(path.join(fixtures, name));

test("detectUploadType/validateUpload: đúng loại, giới hạn, chặn sai định dạng", async () => {
  assert.equal(detectUploadType(await load("sample.pdf"), "a.pdf"), "pdf");
  assert.equal(detectUploadType(await load("sample.docx"), "a.docx"), "docx");
  assert.equal(detectUploadType(await load("sample.txt"), "a.txt"), "txt");
  assert.equal(detectUploadType(Buffer.from("MZ executable"), "a.exe"), null);
  // Đuôi .txt nhưng là ZIP → không phải txt
  assert.equal(detectUploadType(await load("sample.docx"), "fake.txt"), null);
  for (const bad of [
    [Buffer.from("x"), ""],
    [Buffer.from("x"), "../hack.txt"],
    [Buffer.from("x".repeat(6)), "a.txt", 5], // nhỏ thì OK — oversized test riêng
  ]) {
    if (bad.length === 2) assert.throws(() => validateUpload(bad[0], bad[1]), (e) => e.status === 400);
  }
  assert.throws(() => validateUpload(Buffer.alloc(5 * 1024 * 1024 + 1, 97), "big.txt"), (e) => e.status === 400);
  assert.throws(() => validateUpload(Buffer.from("MZ...."), "virus.exe"), (e) => e.status === 400);
});

test("chunkText: tách đoạn có thứ tự và locator", () => {
  const chunks = chunkText("một hai ba bốn năm ".repeat(200), "x.txt");
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].ordinal, 1);
  assert.equal(chunks[0].locator, "upload:x.txt#1");
  assert.ok(chunks.every((c) => c.text.length > 0));
});

test("Upload TXT/DOCX/PDF: trích xuất OK, bản nháp DRAFT chưa kích hoạt", { skip }, async () => {
  const ids = [];
  const files = [];
  try {
    for (const [name, expect] of [
      ["sample.txt", "Hello TXT from fixture"],
      ["sample.docx", "Hello DOCX from fixture"],
      ["sample.pdf", "Hello PDF from fixture"],
    ]) {
      const result = await ingestUpload(db, await load(name), { filename: name, createdBy: "test" });
      ids.push(result.documentId);
      files.push(path.basename(result.sourceFile.filePath));
      assert.equal(result.sourceFile.extractionStatus, "OK", name);
      assert.equal(result.versions.length, 1, name);
      assert.equal(result.versions[0].status, "DRAFT", name); // chưa duyệt
      assert.ok(result.versions[0].chunkCount >= 1, name);
      // Chưa duyệt → không có phiên bản kích hoạt cho truy vấn trả lời
      const doc = await db.knowledgeDocument.findUnique({ where: { id: result.documentId } });
      assert.equal(doc.activeVersionId, null, name);
      const chunk = await db.knowledgeChunk.findFirst({
        where: { versionId: result.versions[0].id },
        orderBy: { ordinal: "asc" },
      });
      assert.ok(chunk.text.includes(expect), name);
    }
  } finally {
    await db.knowledgeDocument.deleteMany({ where: { id: { in: ids } } });
    for (const f of files) await rm(path.join(uploadDir, f), { force: true });
    await db.$disconnect();
  }
});

test("Upload lỗi: PDF ảnh báo thiếu OCR, file hỏng ghi FAILED rõ ràng", { skip }, async () => {
  const ids = [];
  const files = [];
  try {
    const scanned = await ingestUpload(db, await load("sample-no-text.pdf"), { filename: "scan.pdf", createdBy: "test" });
    ids.push(scanned.documentId);
    files.push(path.basename(scanned.sourceFile.filePath));
    assert.equal(scanned.sourceFile.extractionStatus, "FAILED");
    assert.match(scanned.sourceFile.extractionError, /OCR/);
    assert.equal(scanned.versions.length, 0); // không giả trích xuất thành công

    const broken = await ingestUpload(db, Buffer.from("%PDF-1.4\nnot really a pdf"), { filename: "broken.pdf", createdBy: "test" });
    ids.push(broken.documentId);
    files.push(path.basename(broken.sourceFile.filePath));
    assert.equal(broken.sourceFile.extractionStatus, "FAILED");
    assert.match(broken.sourceFile.extractionError, /Trích xuất thất bại/);
    assert.equal(broken.versions.length, 0);

    // getUpload vẫn xem được bản ghi lỗi để hiển thị
    const view = await getUpload(db, scanned.documentId);
    assert.equal(view.sourceFile.extractionStatus, "FAILED");
  } finally {
    await db.knowledgeDocument.deleteMany({ where: { id: { in: ids } } });
    for (const f of files) await rm(path.join(uploadDir, f), { force: true });
    await db.$disconnect();
  }
});
