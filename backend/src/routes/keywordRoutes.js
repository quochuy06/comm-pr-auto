import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import { validateRuleInput, dryRunRules } from "../services/keywordRules.js";

// PHUC-API02: CRUD luật từ khóa + dry-run không gửi thật.
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID luật không hợp lệ.");
  return req.params.id;
};

router.get("/", async (req, res) => {
  const where = {};
  if (req.query.pageId) where.pageId = String(req.query.pageId);
  if (req.query.channel) where.channel = String(req.query.channel);
  res.json({
    success: true,
    data: await prisma.keywordRule.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
  });
});

router.post("/", roles("ADMIN"), async (req, res) => {
  const data = validateRuleInput(req.body);
  if (!data.replyText && !data.sourceDocId)
    throw new HttpError(400, "Luật phải có câu trả lời hoặc nguồn FAQ tham chiếu.");
  const rule = await prisma.keywordRule.create({
    data: { id: randomUUID(), pageId: String(req.body.pageId || "default"), ...data, createdBy: req.user.id },
  });
  res.status(201).json({ success: true, data: rule });
});

router.patch("/:id", roles("ADMIN"), async (req, res) => {
  const data = validateRuleInput(req.body, { partial: true });
  if (Object.keys(data).length === 0)
    throw new HttpError(400, "Không có trường nào để cập nhật.");
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  const rule = await prisma.keywordRule.update({ where: { id: idOf(req) }, data });
  res.json({ success: true, data: rule });
});

router.delete("/:id", roles("ADMIN"), async (req, res) => {
  await prisma.keywordRule.delete({ where: { id: idOf(req) } });
  res.json({ success: true });
});

// Dry-run: không gửi, không ghi outbox — chỉ trả kết quả định tuyến.
router.post("/dry-run", async (req, res) => {
  res.json({
    success: true,
    data: await dryRunRules(prisma, {
      channel: req.body.channel,
      text: req.body.text,
      pageId: String(req.body.pageId || "default"),
    }),
  });
});

export default router;
