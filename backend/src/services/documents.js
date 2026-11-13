import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../lib/errors.js";
import { mediaDir } from "./images.js";
import { createRequire } from "node:module";
// pdf-parse/mammoth là CommonJS — nạp qua require để tương thích ESM.
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse"); // v2: class API
const mammoth = require("mammoth");

// HOANG-API02: upload + parser PDF/DOCX/TXT. File lỗi được ghi nhận LỖI rõ
// (FAILED) — không bao giờ giả trích xuất thành công. Văn bản tách được chỉ tạo
// KnowledgeVersion DRAFT; tài liệu chưa được review kích hoạt thì KHÔNG được
// dùng cho trả lời (activeVersionId vẫn null).
export const uploadDir = path.join(mediaDir, "..", "uploads");
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = {
  pdf: { ext: "pdf", mimeType: "application/pdf" },
  docx: { ext: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  txt: { ext: "txt", mimeType: "text/plain" },
};
const CHUNK_SIZE = 1200;

export function detectUploadType(bytes, filename = "") {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return null;
  const name = String(filename).toLowerCase();
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    if (name.endsWith(".docx")) return "docx";
    return null;
  }
  if (name.endsWith(".txt") && !bytes.includes(0)) return "txt";
  return null;
}

export function validateUpload(bytes, filename) {
  const name = typeof filename === "string" ? filename.trim() : "";
  if (!name || name.length > 200 || name.includes("/") || name.includes("\\"))
    throw new HttpError(400, "Tên tệp không hợp lệ.");
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new HttpError(400, "Tệp tải lên rỗng.");
  if (bytes.length > MAX_BYTES)
    throw new HttpError(400, "Tệp vượt quá giới hạn 5 MB.");
  const type = detectUploadType(bytes, name);
  if (!type)
    throw new HttpError(400, "Chỉ chấp nhận PDF, DOCX hoặc TXT (đúng phần mở rộng và định dạng tệp).");
  return { type, ...TYPES[type], filename: name };
}

async function extractText(bytes, type) {
  if (type === "txt") return bytes.toString("utf8");
  if (type === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return value;
  }
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const { text } = await parser.getText();
    // Bỏ marker phân trang "-- n of m --" mà pdf-parse v2 thêm vào.
    return String(text)
      .split("\n")
      .filter((line) => !/^-- \d+ of \d+ --$/.test(line.trim()))
      .join("\n");
  } finally {
    await parser.destroy();
  }
}

export function chunkText(text, filename) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  const chunks = [];
  let rest = clean;
  while (rest.length && chunks.length < 500) {
    let cut = rest.length <= CHUNK_SIZE ? rest.length : rest.lastIndexOf(" ", CHUNK_SIZE);
    if (cut < 200) cut = CHUNK_SIZE;
    chunks.push({ ordinal: chunks.length + 1, text: rest.slice(0, cut).trim(), locator: `upload:${filename}#${chunks.length + 1}` });
    rest = rest.slice(cut).trim();
  }
  return chunks.filter((c) => c.text.length > 0);
}

// Upload + parse + ingest bản nháp. Trả về bản ghi để UI hiển thị; lỗi trích
// xuất ghi vào SourceFile.extractionError với trạng thái FAILED.
export async function ingestUpload(db, bytes, { filename, pageId = "default", createdBy = "system" } = {}) {
  const meta = validateUpload(bytes, filename);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(uploadDir, { recursive: true });
  const storedName = `${randomUUID()}.${meta.ext}`;
  await writeFile(path.join(uploadDir, storedName), bytes);

  const document = await db.knowledgeDocument.create({
    data: { pageId, kind: "UPLOAD", title: meta.filename },
  });
  const base = {
    documentId: document.id,
    filename: meta.filename,
    mimeType: meta.mimeType,
    sizeBytes: bytes.length,
    sha256,
    filePath: `/uploads/${storedName}`,
  };

  let chunks;
  try {
    chunks = chunkText(await extractText(bytes, meta.type), meta.filename);
    if (!chunks.length) {
      const error = meta.type === "pdf"
        ? "PDF không có lớp văn bản trích xuất được (có thể là PDF ảnh). Hiện chưa hỗ trợ OCR."
        : "Tệp không có nội dung văn bản trích xuất được.";
      await db.sourceFile.create({ data: { ...base, extractionStatus: "FAILED", extractionError: error } });
      return getUpload(db, document.id);
    }
  } catch (e) {
    const error = `Trích xuất thất bại: ${String(e.message || e).slice(0, 300)}`;
    await db.sourceFile.create({ data: { ...base, extractionStatus: "FAILED", extractionError: error } });
    return getUpload(db, document.id);
  }

  await db.$transaction(async (tx) => {
    const sourceFile = await tx.sourceFile.create({ data: { ...base, extractionStatus: "OK" } });
    const version = await tx.knowledgeVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        status: "DRAFT",
        extractionStatus: "OK",
        body: { source: "upload", filename: meta.filename, text: chunks[0].text.slice(0, 500) },
        createdBy,
      },
    });
    await tx.knowledgeChunk.createMany({
      data: chunks.map((c) => ({ versionId: version.id, ordinal: c.ordinal, text: c.text, locator: c.locator })),
    });
    return sourceFile;
  });
  return getUpload(db, document.id);
}

export async function getUpload(db, documentId) {
  const document = await db.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: { sourceFile: true, versions: { include: { _count: { select: { chunks: true } } } } },
  });
  if (!document) throw new HttpError(404, "Không tìm thấy tài liệu.");
  return {
    documentId: document.id,
    pageId: document.pageId,
    title: document.title,
    archived: Boolean(document.archivedAt),
    sourceFile: document.sourceFile,
    versions: document.versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      extractionStatus: v.extractionStatus,
      chunkCount: v._count.chunks,
      createdAt: v.createdAt,
    })),
  };
}

export async function listUploads(db, { pageId, includeArchived = false } = {}) {
  const documents = await db.knowledgeDocument.findMany({
    where: { kind: "UPLOAD", ...(pageId ? { pageId } : {}), ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "desc" },
    include: { sourceFile: true, versions: { include: { _count: { select: { chunks: true } } } } },
  });
  return Promise.all(documents.map((d) => getUpload(db, d.id)));
}
