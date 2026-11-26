import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError, audit, text } from "../lib/errors.js";
import {
  extractText, detectUploadType, chunkText, uploadDir,
} from "./documents.js";
import { retrieveAnswer } from "./retrieval.js";

// HOANG-WF03/04/05: step services called by the n8n knowledge workflows over
// the internal API. Parsing and persistence stay in the backend; the workflow
// orchestrates metadata checks, chunk normalization and AI review steps.
const id = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);

function checkedDocumentId(value) {
  if (!id(value)) throw new HttpError(400, "documentId không hợp lệ.");
  return value;
}

async function scopedDocument(db, documentId, pageId) {
  const document = await db.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: { sourceFile: true },
  });
  if (!document || (pageId !== undefined && document.pageId !== pageId))
    throw new HttpError(404, "Không tìm thấy tài liệu.");
  return document;
}

// WF03 step 1: document + stored-file metadata for the workflow's own checks.
export async function documentMeta(db, { documentId, pageId }) {
  const document = await scopedDocument(db, checkedDocumentId(documentId), pageId);
  return {
    document: {
      documentId: document.id,
      pageId: document.pageId,
      title: document.title,
      archived: Boolean(document.archivedAt),
    },
    sourceFile: document.sourceFile
      ? {
          filename: document.sourceFile.filename,
          mimeType: document.sourceFile.mimeType,
          sizeBytes: document.sourceFile.sizeBytes,
          sha256: document.sourceFile.sha256,
          extractionStatus: document.sourceFile.extractionStatus,
          extractionError: document.sourceFile.extractionError,
        }
      : null,
  };
}

// WF03 step 2: run the backend parser on the stored file. Extraction failure
// (corrupt file, image-only PDF) is REPORTED, never faked as success.
export async function extractDocumentText(db, { documentId, pageId }) {
  const document = await scopedDocument(db, checkedDocumentId(documentId), pageId);
  const sourceFile = document.sourceFile;
  if (!sourceFile) throw new HttpError(404, "Tài liệu chưa có tệp nguồn.");
  const name = path.basename(sourceFile.filePath);
  if (!/^[0-9a-f-]+\.[a-z0-9]+$/i.test(name)) throw new HttpError(400, "Đường dẫn tệp không hợp lệ.");
  let bytes;
  try {
    bytes = await readFile(path.join(uploadDir, name));
  } catch {
    throw new HttpError(404, "Không tìm thấy tệp nguồn trên máy chủ.");
  }
  const type = detectUploadType(bytes, sourceFile.filename);
  if (!type) return { documentId: document.id, extractionStatus: "FAILED", reason: "Tệp không đúng định dạng PDF, DOCX hoặc TXT." };
  try {
    const raw = await extractText(bytes, type);
    const clean = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!clean)
      return {
        documentId: document.id,
        extractionStatus: "FAILED",
        reason: type === "pdf"
          ? "PDF không có lớp văn bản trích xuất được (có thể là PDF ảnh). Hiện chưa hỗ trợ OCR."
          : "Tệp không có nội dung văn bản trích xuất được.",
      };
    return { documentId: document.id, extractionStatus: "OK", text: clean };
  } catch (e) {
    return { documentId: document.id, extractionStatus: "FAILED",
      reason: `Trích xuất thất bại: ${String(e.message || e).slice(0, 300)}` };
  }
}

// WF03 step 3: save normalized chunks as a NEW DRAFT version. Never touches
// the active version — activation always requires human review.
export async function saveIngestDraft(db, { documentId, pageId, chunks, createdBy = "workflow" }) {
  const document = await scopedDocument(db, checkedDocumentId(documentId), pageId);
  if (document.archivedAt) throw new HttpError(409, "Tài liệu đã lưu trữ; không tạo bản nháp mới.");
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 500)
    throw new HttpError(400, "Danh sách đoạn văn không hợp lệ.");
  const clean = chunks.map((c, i) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new HttpError(400, "Đoạn văn không hợp lệ.");
    const value = text(c.text, `Đoạn ${i + 1}`, 5000);
    const locator = typeof c.locator === "string" ? c.locator.trim().slice(0, 300) : "";
    const ordinal = Number.isSafeInteger(c.ordinal) ? c.ordinal : i + 1;
    if (ordinal < 1 || ordinal > 100000) throw new HttpError(400, "Thứ tự đoạn văn không hợp lệ.");
    return { ordinal, text: value, locator: locator || `workflow:${document.id}#${i + 1}` };
  });
  if (new Set(clean.map((c) => c.ordinal)).size !== clean.length)
    throw new HttpError(400, "Thứ tự đoạn văn bị trùng.");
  return db.$transaction(async (tx) => {
    const latest = await tx.knowledgeVersion.findFirst({
      where: { documentId: document.id }, orderBy: { version: "desc" },
    });
    const version = await tx.knowledgeVersion.create({
      data: {
        documentId: document.id,
        version: (latest?.version ?? 0) + 1,
        status: "DRAFT",
        extractionStatus: "OK",
        body: { source: "workflow-ingest", chunkCount: clean.length },
        createdBy,
        chunks: { create: clean },
      },
    });
    await audit(tx, createdBy, "KNOWLEDGE_INGEST_DRAFT", document.id,
      JSON.stringify({ versionId: version.id, version: version.version, chunkCount: clean.length }));
    return { versionId: version.id, version: version.version, chunkCount: clean.length };
  });
}

// WF04: draft content plus a bounded set of active APPROVED excerpts the
// workflow compares against (duplicate/conflict detection).
export async function checkContext(db, { documentId, versionId, pageId }) {
  const document = await scopedDocument(db, checkedDocumentId(documentId), pageId);
  const version = await db.knowledgeVersion.findUnique({
    where: { id: versionId }, include: { chunks: { orderBy: { ordinal: "asc" } } },
  });
  if (!version || version.documentId !== document.id)
    throw new HttpError(404, "Không tìm thấy bản nháp cần kiểm tra.");
  const actives = await db.knowledgeDocument.findMany({
    where: { pageId: document.pageId, archivedAt: null, activeVersionId: { not: null } },
    include: { activeVersion: { include: { chunks: { orderBy: { ordinal: "asc" }, take: 3 } } } },
    take: 20,
  });
  const references = [];
  for (const doc of actives) {
    if (doc.activeVersionId === version.id) continue;
    for (const chunk of doc.activeVersion.chunks)
      references.push({
        id: doc.activeVersion.id,
        version: doc.activeVersion.version,
        title: doc.title,
        excerpt: chunk.text.slice(0, 300),
      });
    if (references.length >= 20) break;
  }
  return {
    draft: {
      documentId: document.id,
      versionId: version.id,
      version: version.version,
      title: document.title,
      body: version.body,
      chunks: version.chunks.map((c) => ({ ordinal: c.ordinal, text: c.text.slice(0, 2000), locator: c.locator })),
    },
    references: references.slice(0, 20),
  };
}

// WF05: approved-source retrieval for answer drafting. Returns the citation
// set (version ids) the workflow must stay within; no sending happens here.
export async function answerContext(db, { question, pageId, documentId }) {
  const result = await retrieveAnswer(db, {
    question: text(question, "Câu hỏi", 1000),
    pageId, documentId,
  });
  return {
    status: result.status,
    answer: result.answer,
    sources: result.sources.map((s) => ({
      id: s.versionId,
      version: s.version,
      documentId: s.documentId,
      title: s.title,
      locator: s.locator,
      excerpt: s.excerpt,
    })),
    conflicts: result.conflicts,
    brandVoice: result.brandVoice,
  };
}
