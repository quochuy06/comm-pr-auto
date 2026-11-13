import { Router } from "express";
import express from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import { ingestUpload, getUpload, listUploads } from "../services/documents.js";

// HOANG-API02: upload PDF/DOCX/TXT (raw body + filename trong query), xem danh
// sách/chi tiết tài liệu đã nạp. Không có endpoint "duyệt" ở đây — vòng đời
// review dùng chung API tri thức hiện có.
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post(
  "/upload",
  roles("ADMIN", "EDITOR"),
  express.raw({ type: "*/*", limit: "6mb" }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body))
      throw new HttpError(400, "Thiếu nội dung tệp (gửi application/octet-stream).");
    res.status(201).json({
      success: true,
      data: await ingestUpload(prisma, req.body, {
        filename: req.query.filename,
        createdBy: req.user.id,
      }),
    });
  },
);

router.get("/", async (req, res) => {
  res.json({
    success: true,
    data: await listUploads(prisma, {
      pageId: req.query.pageId ? String(req.query.pageId) : undefined,
      includeArchived: req.query.includeArchived === "true",
    }),
  });
});

router.get("/:id", async (req, res) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID tài liệu không hợp lệ.");
  res.json({ success: true, data: await getUpload(prisma, req.params.id) });
});

export default router;
