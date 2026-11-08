import { HttpError, audit, text } from "../lib/errors.js";
import { previewFaqDraft } from "./knowledgeDraft.js";
import { facebookConfig } from "./facebook.js";

// Resolve the scope from server configuration, never from a client-provided Page.
export function knowledgePage(query = {}) {
  let pageId;
  try { pageId = facebookConfig().pageId; }
  catch { throw new HttpError(503, "Chưa cấu hình Page cho kho tri thức."); }
  if (query.pageId !== undefined && query.pageId !== pageId)
    throw new HttpError(404, "Không tìm thấy kho tri thức.");
  return pageId;
}

export async function createFaq(db, pageId, input, actor) {
  const { draft, chunks } = previewFaqDraft(input);
  return db.$transaction(async tx => {
    const document = await tx.knowledgeDocument.create({ data: {
      pageId, title: draft.title,
      versions: { create: { version: 1, body: draft, createdBy: actor,
        chunks: { create: chunks } } },
    }, include: { versions: { include: { chunks: true } } } });
    await audit(tx, actor, "KNOWLEDGE_DRAFT_CREATED", document.id);
    return document;
  });
}

export async function listDocuments(db, pageId, query) {
  const raw = query.limit ?? "20";
  if (typeof raw !== "string" || !/^[1-9]\d?$|^100$/.test(raw))
    throw new HttpError(400, "Giới hạn phải từ 1 đến 100.");
  const limit = Number(raw);
  let cursor;
  if (query.cursor !== undefined) {
    const id = text(query.cursor, "Con trỏ", 100);
    cursor = await db.knowledgeDocument.findFirst({ where: { id, pageId } });
    if (!cursor) throw new HttpError(400, "Con trỏ không hợp lệ.");
  }
  const items = await db.knowledgeDocument.findMany({
    where: { pageId, ...(cursor ? { OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  const more = items.length > limit;
  if (more) items.pop();
  return { items, nextCursor: more ? items.at(-1).id : null };
}

export async function getDocument(db, pageId, id) {
  const document = await db.knowledgeDocument.findFirst({ where: { id, pageId },
    include: { versions: { orderBy: { version: "desc" }, include: { chunks: true } } } });
  if (!document) throw new HttpError(404, "Không tìm thấy tài liệu.");
  return document;
}

// Exact text search for this increment. Only active, reviewed sources qualify.
export async function searchKnowledge(db, pageId, query) {
  const q = text(query.q, "Từ khóa", 500);
  const raw = query.limit ?? "20";
  if (typeof raw !== "string" || !/^[1-9]\d?$|^100$/.test(raw))
    throw new HttpError(400, "Giới hạn phải từ 1 đến 100.");
  const candidates = await db.knowledgeChunk.findMany({ where: {
    text: { contains: q, mode: "insensitive" },
    version: { status: "APPROVED", reviewedBy: { not: null }, reviewedAt: { not: null },
      activeFor: { pageId, archivedAt: null } },
  }, orderBy: { id: "asc" }, take: Number(raw),
    select: { id: true, versionId: true, text: true, locator: true,
      version: { select: { version: true, documentId: true } } } });
  return { items: candidates };
}

// Serialize transitions per document; edits never replace the active source.
export async function transitionKnowledge(db, pageId, id, action, input, actor) {
  const allowed = action === "edit" ? ["expectedVersion", "title", "question", "answer"] : action === "review" ? ["expectedVersion", "decision", "reason"] : ["expectedVersion", "reason"];
  if (!input || Object.keys(input).some(k => !allowed.includes(k)) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw new HttpError(400, "Dữ liệu hoặc phiên bản không hợp lệ.");
  if (action === "review" && !["APPROVE", "REJECT"].includes(input.decision)) throw new HttpError(400, "Quyết định không hợp lệ.");
  const reason = input.reason === undefined ? null : text(input.reason, "Lý do", 1000);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "KnowledgeDocument" WHERE id = ${id} AND "pageId" = ${pageId} FOR UPDATE`;
    const doc = await getDocument(tx, pageId, id);
    const latest = doc.versions[0];
    if (doc.archivedAt || !latest || latest.version !== input.expectedVersion) throw new HttpError(409, "Tài liệu đã thay đổi hoặc lưu trữ. Hãy tải lại; nội dung form được giữ nguyên.");
    if (action === "edit") {
      const { expectedVersion, ...body } = input;
      const { draft, chunks } = previewFaqDraft(body);
      await tx.knowledgeVersion.create({ data: { documentId: id, version: latest.version + 1, body: draft, createdBy: actor, chunks: { create: chunks } } });
    } else if (action === "submit") {
      if (latest.status !== "DRAFT") throw new HttpError(409, "Chỉ gửi duyệt bản nháp.");
      await tx.knowledgeVersion.update({ where: { id: latest.id }, data: { status: "PENDING_APPROVAL" } });
    } else if (action === "review") {
      if (latest.status !== "PENDING_APPROVAL") throw new HttpError(409, "Phiên bản không còn chờ duyệt.");
      await tx.knowledgeVersion.update({ where: { id: latest.id }, data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedBy: actor, reviewedAt: new Date() } });
      if (input.decision === "APPROVE") await tx.knowledgeDocument.update({ where: { id }, data: { activeVersionId: latest.id, title: latest.body.title } });
    } else if (action === "archive") {
      await tx.knowledgeDocument.update({ where: { id }, data: { archivedAt: new Date(), activeVersionId: null } });
    } else throw new HttpError(400, "Thao tác không hợp lệ.");
    await audit(tx, actor, `KNOWLEDGE_${action.toUpperCase()}`, id, JSON.stringify({ version: latest.version, decision: input.decision, reason }));
    return getDocument(tx, pageId, id);
  });
}
