import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { app } from "../src/app.js";
import { hashPassword } from "../src/lib/security.js";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../src/prisma.js";
import {
  detectUploadType,
  validateUpload,
  ingestUpload,
  getUpload,
  deleteUpload,
  listUploads,
  chunkText,
  uploadDir,
} from "../src/services/documents.js";
import { knowledgeScope } from "../src/services/knowledge.js";

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

test("knowledgeScope: upload/hỏi đáp cùng phạm vi kho tri thức", () => {
  const keys = ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_GRAPH_API_VERSION"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    // Ép chưa cấu hình (vượt cả .local/facebook.env) → fallback "default".
    for (const k of keys) process.env[k] = "";
    assert.equal(knowledgeScope(), "default");
    // Đã cấu hình → cùng Page với danh sách kho tri thức; sai Page bị chặn.
    process.env.FACEBOOK_PAGE_ID = "123456789";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "token-test";
    process.env.FACEBOOK_GRAPH_API_VERSION = "v23.0";
    assert.equal(knowledgeScope(), "123456789");
    assert.equal(knowledgeScope({ pageId: "123456789" }), "123456789");
    assert.throws(() => knowledgeScope({ pageId: "khac" }), (e) => e.status === 404);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
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


test("DELETE upload retracts the source, checks Page and role, and audits exactly once", { skip }, async () => {
  const users = [];
  const pageId = knowledgeScope();
  const password = "BAO-UI07-fixture-only";
  const prefix = "delete-fixture-" + randomUUID();
  let server, upload;
  try {
    upload = await ingestUpload(db, Buffer.from(prefix), { filename: "delete.txt", pageId, createdBy: prefix });
    const versionId = upload.versions[0].id;
    await db.knowledgeVersion.update({
      where: { id: versionId },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: prefix },
    });
    await db.knowledgeDocument.update({
      where: { id: upload.documentId }, data: { activeVersionId: versionId },
    });
    await assert.rejects(
      deleteUpload(db, upload.documentId, { pageId: "foreign-page", actor: prefix }),
      { status: 404 },
    );

    const passwordHash = await hashPassword(password);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = "http://127.0.0.1:" + server.address().port;
    const cookies = {};
    for (const role of ["ADMIN", "EDITOR"]) {
      const email = prefix + "-" + role.toLowerCase() + "@test.invalid";
      const user = await db.user.create({ data: { email, name: prefix, role, passwordHash } });
      users.push(user.id);
      const login = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      cookies[role] = login.headers.get("set-cookie").split(";")[0];
    }
    const url = base + "/api/documents/" + upload.documentId;
    const remove = (cookie) => fetch(url, {
      method: "DELETE",
      headers: cookie ? { Cookie: cookie } : {},
    });
    await assert.rejects(getUpload(db, upload.documentId, "foreign-page"), { status: 404 });
    assert.equal((await fetch(url, { headers: { Cookie: cookies.ADMIN } })).status, 200);
    assert.equal((await remove()).status, 401);
    assert.equal((await remove(cookies.EDITOR)).status, 403);
    const attempts = await Promise.all([remove(cookies.ADMIN), remove(cookies.ADMIN)]);
    assert.deepEqual(attempts.map((response) => response.status), [200, 200]);
    assert.equal((await fetch(url, { headers: { Cookie: cookies.ADMIN } })).status, 404);

    const record = await db.knowledgeDocument.findUnique({
      where: { id: upload.documentId }, include: { versions: true, sourceFile: true },
    });
    assert.ok(record.deletedAt);
    assert.equal(record.activeVersionId, null);
    assert.equal(record.versions.length, 1);
    assert.ok(record.sourceFile);
    assert.ok(!(await listUploads(db, { pageId, includeArchived: true }))
      .some((item) => item.documentId === upload.documentId));
    const audits = await db.auditLog.findMany({
      where: { entityId: upload.documentId, action: "KNOWLEDGE_UPLOAD_DELETED" },
    });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor, users[0]);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (upload) {
      await db.auditLog.deleteMany({ where: { entityId: upload.documentId } });
      await db.knowledgeDocument.deleteMany({ where: { id: upload.documentId } });
      await rm(path.join(uploadDir, path.basename(upload.sourceFile.filePath)), { force: true });
    }
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
