import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import {
  getPrConfig,
  updatePrConfig,
  createPrContent,
  approvePrContent,
  createPrOutbox,
} from "../services/pr.js";

// HUY-API02: cấu hình PR, nội dung PR có duyệt, outbox khóa theo publication.
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID không hợp lệ.");
  return req.params.id;
};

router.get("/pr/config", async (req, res) => {
  res.json({ success: true, data: await getPrConfig(prisma) });
});

router.put("/pr/config", roles("ADMIN"), async (req, res) => {
  res.json({
    success: true,
    data: await updatePrConfig(prisma, {
      mode: req.body.mode,
      version: Number(req.body.version),
    }),
  });
});

router.get("/pr/content", async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  res.json({
    success: true,
    data: await prisma.prContent.findMany({ where, orderBy: { createdAt: "desc" } }),
  });
});

router.post("/pr/content", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.status(201).json({
    success: true,
    data: await createPrContent(prisma, { text: req.body.text, createdBy: req.user.id }),
  });
});

router.post("/pr/content/:id/approve", roles("ADMIN", "REVIEWER"), async (req, res) => {
  res.json({ success: true, data: await approvePrContent(prisma, idOf(req), req.user.id) });
});

router.get("/pr/outbox", async (req, res) => {
  res.json({
    success: true,
    data: await prisma.prOutbox.findMany({ orderBy: { createdAt: "desc" } }),
  });
});

router.post("/pr/outbox", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.status(201).json({
    success: true,
    data: await createPrOutbox(prisma, {
      publicationKey: req.body.publicationKey,
      postId: req.body.postId,
      scheduleId: req.body.scheduleId,
      contentId: req.body.contentId,
    }),
  });
});

export default router;
