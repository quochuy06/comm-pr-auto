import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import {
  createReplyDecision,
  reviewReplyDecision,
  editReplyDecision,
  listReplyDecisions,
} from "../services/replyDecisions.js";

// PHUC-API03: hàng duyệt phản hồi hai kênh (quyền: soạn ADMIN/EDITOR,
// duyệt/sửa ADMIN/REVIEWER; gửi thật thuộc PHUC-WF06, không có ở đây).
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID quyết định không hợp lệ.");
  return req.params.id;
};

router.get("/reply-decisions", async (req, res) => {
  res.json({
    success: true,
    data: await listReplyDecisions(prisma, {
      pageId: req.query.pageId ? String(req.query.pageId) : undefined,
      channel: req.query.channel ? String(req.query.channel) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    }),
  });
});

router.post("/reply-decisions", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.status(201).json({
    success: true,
    data: await createReplyDecision(prisma, req.body, { createdBy: req.user.id }),
  });
});

router.post("/reply-decisions/:id/approve", roles("ADMIN", "REVIEWER"), async (req, res) => {
  res.json({
    success: true,
    data: await reviewReplyDecision(prisma, idOf(req), { approve: true, reviewer: req.user.id }),
  });
});

router.post("/reply-decisions/:id/reject", roles("ADMIN", "REVIEWER"), async (req, res) => {
  res.json({
    success: true,
    data: await reviewReplyDecision(prisma, idOf(req), {
      approve: false,
      reviewer: req.user.id,
      reason: req.body.reason,
    }),
  });
});

router.patch("/reply-decisions/:id", roles("ADMIN", "REVIEWER"), async (req, res) => {
  res.json({
    success: true,
    data: await editReplyDecision(prisma, idOf(req), { replyText: req.body.replyText, editor: req.user.id }),
  });
});

export default router;
