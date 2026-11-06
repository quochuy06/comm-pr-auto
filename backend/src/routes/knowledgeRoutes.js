import { Router } from "express";
import { roles } from "../middleware/auth.js";
import { previewFaqDraft } from "../services/knowledgeDraft.js";

import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { knowledgePage, createFaq, listDocuments, getDocument, searchKnowledge } from "../services/knowledge.js";

const router = Router();
router.post("/documents", roles("ADMIN", "EDITOR"), async (req, res) => {
  const { kind, ...input } = req.body || {};
  if (kind !== "FAQ") throw new HttpError(400, "Chỉ hỗ trợ tài liệu FAQ.");
  const pageId = knowledgePage(req.query);
  res.status(201).json({ success: true, data: await createFaq(prisma, pageId, input, req.user.email) });
});
router.get("/documents", async (req, res) => {
  res.json({ success: true, data: await listDocuments(prisma, knowledgePage(req.query), req.query) });
});
router.get("/documents/:id", async (req, res) => {
  res.json({ success: true, data: await getDocument(prisma, knowledgePage(req.query), req.params.id) });
});
router.get("/search", async (req, res) => {
  res.json({ success: true, data: await searchKnowledge(prisma, knowledgePage(req.query), req.query) });
});
router.post("/faq/preview", roles("ADMIN", "EDITOR"), (req, res) => {
  res.json({ success: true, data: previewFaqDraft(req.body) });
});
export default router;
