import { HttpError } from "../lib/errors.js";

// PHUC-API02: keyword rules. Matching is pure routing — this service NEVER
// sends a reply; dry-run reports what WOULD happen (rule/reply/source or
// NO_MATCH/CONFLICT) so callers can hand off to the approval gate.
const CHANNELS = ["COMMENT", "MESSENGER"];
const MATCH_TYPES = ["WORD", "PHRASE"];

// Bỏ dấu, hạ chữ thường, gộp khoảng trắng: "Cà Phê Sữa" -> "ca phe sua".
export function normalizeKeyword(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateRuleInput(input = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || input.channel !== undefined) {
    if (!CHANNELS.includes(input.channel))
      throw new HttpError(400, "Kênh phải là COMMENT hoặc MESSENGER.");
    out.channel = input.channel;
  }
  if (!partial || input.keyword !== undefined) {
    const raw = typeof input.keyword === "string" ? input.keyword.trim() : "";
    const keyword = normalizeKeyword(raw);
    if (!keyword || raw.length > 100)
      throw new HttpError(400, "Từ khóa phải từ 1 đến 100 ký tự.");
    out.keyword = keyword;
    out.keywordRaw = raw;
  }
  if (!partial || input.matchType !== undefined) {
    const matchType = input.matchType || "PHRASE";
    if (!MATCH_TYPES.includes(matchType))
      throw new HttpError(400, "Loại khớp phải là WORD hoặc PHRASE.");
    out.matchType = matchType;
  }
  if (!partial || input.priority !== undefined) {
    const priority = input.priority === undefined ? 1 : Number(input.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 100)
      throw new HttpError(400, "Độ ưu tiên phải là số nguyên 1–100 (1 = cao nhất).");
    out.priority = priority;
  }
  if (!partial || input.replyText !== undefined) {
    const replyText = typeof input.replyText === "string" ? input.replyText.trim() : "";
    if (replyText.length > 2000)
      throw new HttpError(400, "Câu trả lời tối đa 2000 ký tự.");
    out.replyText = replyText || null;
  }
  if (!partial || input.sourceDocId !== undefined) {
    out.sourceDocId = input.sourceDocId || null;
  }
  return out;
}

export function matchesRule(rule, normalizedText) {
  const needle = rule.keyword;
  if (rule.matchType === "WORD") {
    // Khớp từ/cụm trên ranh giới từ (sau khi đã chuẩn hóa).
    const tokens = normalizedText.split(" ");
    const words = needle.split(" ");
    for (let i = 0; i + words.length <= tokens.length; i++) {
      if (words.every((w, j) => tokens[i + j] === w)) return true;
    }
    return false;
  }
  return normalizedText.includes(needle);
}

// Dry-run: trả về matches theo độ ưu tiên + quyết định. Hai luật cùng ưu tiên
// nhưng nội dung khác nhau -> CONFLICT (chuyển duyệt), không tự chọn.
export async function dryRunRules(db, { channel, text, pageId = "default" }) {
  if (!CHANNELS.includes(channel))
    throw new HttpError(400, "Kênh phải là COMMENT hoặc MESSENGER.");
  const normalizedText = normalizeKeyword(text);
  if (!normalizedText)
    throw new HttpError(400, "Nội dung kiểm thử không được để trống.");
  const rules = await db.keywordRule.findMany({
    where: { pageId, channel, active: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  const hits = rules.filter((r) => matchesRule(r, normalizedText));
  if (!hits.length)
    return { normalizedText, decision: "NO_MATCH", matches: [] };
  const best = hits.filter((r) => r.priority === hits[0].priority);
  const distinct = new Set(best.map((r) => `${r.replyText || ""}|${r.sourceDocId || ""}`));
  return {
    normalizedText,
    decision: distinct.size > 1 ? "CONFLICT" : "MATCH",
    matches: hits.map((r) => ({
      ruleId: r.id,
      keyword: r.keywordRaw,
      matchType: r.matchType,
      priority: r.priority,
      replyText: r.replyText,
      sourceDocId: r.sourceDocId,
    })),
  };
}
