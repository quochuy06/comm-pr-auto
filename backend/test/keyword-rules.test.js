import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../src/prisma.js";
import {
  normalizeKeyword,
  validateRuleInput,
  matchesRule,
  dryRunRules,
} from "../src/services/keywordRules.js";

const skip = process.env.RUN_DB_TESTS !== "true";

test("normalizeKeyword: bỏ dấu, hạ chữ thường, gộp khoảng trắng", () => {
  assert.equal(normalizeKeyword("  Cà  Phê Sữa "), "ca phe sua");
  assert.equal(normalizeKeyword("ĐẶC BIỆT"), "dac biet");
  assert.equal(normalizeKeyword("đường"), "duong");
});

test("validateRuleInput: ràng buộc kênh/keyword/priority", () => {
  assert.throws(() => validateRuleInput({ channel: "ZALO", keyword: "x" }), (e) => e.status === 400);
  assert.throws(() => validateRuleInput({ channel: "COMMENT", keyword: "" }), (e) => e.status === 400);
  assert.throws(() => validateRuleInput({ channel: "COMMENT", keyword: "x", priority: 0 }), (e) => e.status === 400);
  assert.throws(() => validateRuleInput({ channel: "COMMENT", keyword: "x", matchType: "REGEX" }), (e) => e.status === 400);
  const ok = validateRuleInput({ channel: "COMMENT", keyword: " Cà Phê ", priority: 2 });
  assert.equal(ok.keyword, "ca phe");
  assert.equal(ok.keywordRaw, "Cà Phê");
});

test("matchesRule: WORD khớp ranh giới từ, PHRASE khớp chuỗi con", () => {
  const phrase = { keyword: "ca phe", matchType: "PHRASE" };
  const word = { keyword: "ca phe", matchType: "WORD" };
  assert.equal(matchesRule(phrase, "toi thich ca phe sua"), true);
  assert.equal(matchesRule(phrase, "caphekhongdau"), false);
  assert.equal(matchesRule(word, "toi thich ca phe sua"), true);
  assert.equal(matchesRule(word, "caphe"), false); // không có ranh giới từ
  assert.equal(matchesRule(word, "mon ca phe nay ngon"), true);
});

test("Keyword rules: dry-run MATCH/CONFLICT/NO_MATCH, không gửi, CRUD", { skip }, async () => {
  const pageId = "kw-" + randomUUID();
  const ids = [];
  try {
    // Hai luật cùng ưu tiên, nội dung khác nhau -> CONFLICT
    for (const replyText of ["Chúng tôi có cà phê sữa nhé!", "Xin mời bạn ghé quán."]) {
      const rule = await db.keywordRule.create({
        data: {
          id: randomUUID(), pageId, channel: "COMMENT",
          keyword: "ca phe", keywordRaw: "cà phê", matchType: "WORD",
          priority: 1, replyText,
        },
      });
      ids.push(rule.id);
    }
    let result = await dryRunRules(db, { channel: "COMMENT", text: "Cho mình hỏi có Cà Phê không?", pageId });
    assert.equal(result.decision, "CONFLICT");
    assert.equal(result.matches.length, 2);

    // Ưu tiên phân định: luật priority 1 thắng -> MATCH
    const winner = await db.keywordRule.create({
      data: {
        id: randomUUID(), pageId, channel: "COMMENT",
        keyword: "ca phe", keywordRaw: "cà phê", matchType: "WORD",
        priority: 1, replyText: "Luật cao nhất",
      },
    });
    ids.push(winner.id);
    await db.keywordRule.updateMany({
      where: { id: { in: ids.slice(0, 2) } }, data: { priority: 2 },
    });
    result = await dryRunRules(db, { channel: "COMMENT", text: "Cho mình hỏi có Cà Phê không?", pageId });
    assert.equal(result.decision, "MATCH");
    assert.equal(result.matches[0].replyText, "Luật cao nhất");

    // KHÔNG dấu vẫn khớp (chuẩn hóa)
    result = await dryRunRules(db, { channel: "COMMENT", text: "ca phe sua bao nhieu", pageId });
    assert.equal(result.decision, "MATCH");

    // NO_MATCH + phân tách kênh
    assert.equal((await dryRunRules(db, { channel: "COMMENT", text: "trà đá", pageId })).decision, "NO_MATCH");
    assert.equal((await dryRunRules(db, { channel: "MESSENGER", text: "ca phe", pageId })).decision, "NO_MATCH");

    // Luật inactive bị bỏ qua
    await db.keywordRule.update({ where: { id: winner.id }, data: { active: false } });
    result = await dryRunRules(db, { channel: "COMMENT", text: "ca phe", pageId });
    assert.equal(result.decision, "CONFLICT"); // chỉ còn 2 luật priority 2
  } finally {
    await db.keywordRule.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
