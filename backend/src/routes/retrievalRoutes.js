import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import { retrieveAnswer, getBrandVoice, updateBrandVoice } from "../services/retrieval.js";

// HOANG-API03: hợp đồng truy xuất/trả lời có nguồn + cấu hình giọng thương hiệu.
// Không gửi, không sinh nội dung bịa — chỉ trả nguồn và trạng thái đủ/thiếu.
const router = Router();

router.post("/retrieval/answer", async (req, res) => {
  res.json({
    success: true,
    data: await retrieveAnswer(prisma, {
      question: req.body.question,
      pageId: req.body.pageId ? String(req.body.pageId) : undefined,
    }),
  });
});

router.get("/retrieval/brand-voice", async (req, res) => {
  res.json({ success: true, data: await getBrandVoice(prisma) });
});

router.put("/retrieval/brand-voice", roles("ADMIN"), async (req, res) => {
  res.json({
    success: true,
    data: await updateBrandVoice(prisma, {
      tone: req.body.tone,
      style: req.body.style,
      forbidden: req.body.forbidden,
      version: req.body.version === undefined ? undefined : Number(req.body.version),
    }),
  });
});

export default router;
