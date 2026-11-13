import { HttpError } from "../lib/errors.js";
import { normalizeKeyword } from "./keywordRules.js";

// HOANG-API03: hợp đồng truy xuất/trả lời có nguồn. Nguyên tắc bất biến:
// - CHỈ dùng phiên bản đã kích hoạt (activeVersionId — tức đã duyệt) đúng Page;
//   tài liệu lưu trữ/bản nháp KHÔNG bao giờ được truy xuất.
// - Trả lời là TRÍCH DẪN (extractive) từ nguồn — không bịa; thiếu nguồn thì
//   status INSUFFICIENT và answer = null.
// - Nhiều nguồn cùng độ khớp khác tài liệu → status CONFLICT (chuyển người
//   duyệt), hệ thống KHÔNG tự chọn nguồn.
const STOPWORDS = new Set([
  "la", "va", "cua", "cho", "voi", "khi", "gi", "nao", "the", "nay", "do",
  "khong", "ban", "toi", "minh", "chung", "cac", "nhung", "mot", "hai", "ba",
  "o", "trong", "ra", "vao", "den", "tu", "nhu", "de", "bi", "da", "se", "hay",
  "co", "khong", "the", "nao", "gi", "may", "bao", "nhieu", "the", "duoc",
]);
const MAX_SOURCES = 3;
const EXCERPT_LEN = 300;
const MIN_SCORE = 1;

function contentWords(normalizedQuestion) {
  return [...new Set(normalizedQuestion.split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

function scoreChunk(text, words) {
  const normalized = normalizeKeyword(text);
  let score = 0;
  for (const w of words) if (normalized.includes(w)) score++;
  return score;
}

function excerptFor(text, words) {
  const normalized = normalizeKeyword(text);
  let at = -1;
  for (const w of words) {
    at = normalized.indexOf(w);
    if (at >= 0) break;
  }
  const raw = String(text);
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 60, Math.max(0, raw.length - EXCERPT_LEN)));
  return raw.slice(start, start + EXCERPT_LEN).trim();
}

export async function getBrandVoice(db, pageId = "default") {
  const voice = await db.brandVoice.findUnique({ where: { id: "default" } });
  return voice || { id: "default", pageId, tone: "thân thiện, lịch sự", style: null, forbidden: null, version: 1 };
}

export async function updateBrandVoice(db, { tone, style, forbidden, version }, { pageId = "default" } = {}) {
  const next = {
    tone: typeof tone === "string" && tone.trim() ? tone.trim().slice(0, 200) : undefined,
    style: typeof style === "string" ? style.trim().slice(0, 2000) || null : undefined,
    forbidden: typeof forbidden === "string" ? forbidden.trim().slice(0, 2000) || null : undefined,
  };
  return db.$transaction(async (tx) => {
    const current = await tx.brandVoice.findUnique({ where: { id: "default" } });
    if (!current) {
      if (version !== undefined && version !== 1)
        throw new HttpError(409, "Phiên bản giọng thương hiệu đã thay đổi.");
      return tx.brandVoice.create({ data: { id: "default", pageId, ...next, tone: next.tone || "thân thiện, lịch sự" } });
    }
    if (version !== undefined && version !== current.version)
      throw new HttpError(409, "Phiên bản giọng thương hiệu đã thay đổi; đọc lại trước khi lưu.");
    return tx.brandVoice.update({ where: { id: "default" }, data: { ...next, version: current.version + 1 } });
  });
}

// Truy xuất + kiểm tra nguồn cho một câu hỏi. KHÔNG gửi đi đâu cả — luồng soạn
// thảo/gửi thuộc HOANG-WF05/PHUC-WF05/06.
export async function retrieveAnswer(db, { question, pageId = "default" } = {}) {
  const q = normalizeKeyword(question);
  const words = contentWords(q);
  if (!q || !words.length)
    throw new HttpError(400, "Câu hỏi không hợp lệ hoặc chỉ chứa từ dừng.");

  // CHỈ chunk thuộc phiên bản đã kích hoạt của tài liệu chưa lưu trữ, đúng Page.
  const documents = await db.knowledgeDocument.findMany({
    where: { pageId, archivedAt: null, activeVersionId: { not: null } },
    include: {
      activeVersion: { include: { chunks: true } },
    },
  });

  const scored = [];
  for (const doc of documents) {
    for (const chunk of doc.activeVersion.chunks) {
      const score = scoreChunk(chunk.text, words);
      if (score >= Math.max(MIN_SCORE, words.length >= 3 ? 2 : 1))
        scored.push({
          score,
          source: {
            documentId: doc.id,
            versionId: doc.activeVersion.id,
            version: doc.activeVersion.version,
            title: doc.title,
            locator: chunk.locator,
            excerpt: excerptFor(chunk.text, words),
          },
          text: chunk.text,
        });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const brandVoice = await getBrandVoice(db, pageId);

  if (!scored.length)
    return { status: "INSUFFICIENT", answer: null, sources: [], conflicts: [], brandVoice };

  const top = scored.filter((s) => s.score === scored[0].score);
  const topDocIds = [...new Set(top.map((s) => s.source.documentId))];
  if (topDocIds.length > 1) {
    // Cùng độ khớp nhưng khác tài liệu → không tự chọn, chuyển duyệt.
    const conflicts = [];
    for (let i = 0; i < top.length; i++)
      for (let j = i + 1; j < top.length; j++)
        if (top[i].source.documentId !== top[j].source.documentId)
          conflicts.push({ a: top[i].source, b: top[j].source });
    return {
      status: "CONFLICT",
      answer: null,
      sources: scored.slice(0, MAX_SOURCES).map((s) => s.source),
      conflicts: conflicts.slice(0, MAX_SOURCES),
      brandVoice,
    };
  }

  // Trả lời trích dẫn từ nguồn khớp nhất — không diễn đạt thêm để khỏi bịa.
  const best = scored[0];
  return {
    status: "SUFFICIENT",
    answer: best.source.excerpt,
    sources: scored.slice(0, MAX_SOURCES).map((s) => s.source),
    conflicts: [],
    brandVoice,
  };
}
