import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import {
  createVideoSchedule,
  cancelVideoSchedule,
  getSchedule,
  listVideoSchedules,
} from "../services/videoSchedules.js";

// HUY-API01-A: đặt lịch video (chưa transport Meta — HUY-WF03 sẽ nối sau).
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID lịch không hợp lệ.");
  return req.params.id;
};

router.get("/video/schedules", async (req, res) => {
  res.json({
    success: true,
    data: await listVideoSchedules(prisma, {
      status: req.query.status ? String(req.query.status) : undefined,
    }),
  });
});

router.post("/video/schedules", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.status(201).json({
    success: true,
    data: await createVideoSchedule(prisma, {
      videoJobId: req.body.videoJobId,
      scheduledAt: req.body.scheduledAt,
      target: req.body.target,
      createdBy: req.user.id,
    }),
  });
});

router.get("/video/schedules/:id", async (req, res) => {
  res.json({ success: true, data: await getSchedule(prisma, idOf(req)) });
});

router.post("/video/schedules/:id/cancel", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.json({ success: true, data: await cancelVideoSchedule(prisma, idOf(req), { by: req.user.id }) });
});

export default router;
