import { Router } from "express";
import prisma from "../prisma.js";
import { roles } from "../middleware/auth.js";
import { text, choice, audit, HttpError } from "../lib/errors.js";
const router = Router();
router.get("/campaigns", async (req, res) =>
  res.json({
    success: true,
    data: await prisma.campaign.findMany({
      include: { _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    }),
  }),
);
router.post("/campaigns", roles("ADMIN", "EDITOR"), async (req, res) => {
  const data = await prisma.campaign.create({
    data: {
      name: text(req.body.name, "Tên chiến dịch", 160),
      description: text(req.body.description, "Mô tả", 3000, true),
    },
  });
  await audit(prisma, req.user.email, "CAMPAIGN_CREATED", data.id);
  res.status(201).json({ success: true, data });
});
router.patch("/campaigns/:id", roles("ADMIN", "EDITOR"), async (req, res) => {
  const data = await prisma.campaign.update({
    where: { id: req.params.id },
    data: {
      name: text(req.body.name, "Tên chiến dịch", 160),
      description: text(req.body.description, "Mô tả", 3000, true),
    },
  });
  await audit(prisma, req.user.email, "CAMPAIGN_UPDATED", data.id);
  res.json({ success: true, data });
});
router.get("/settings", async (req, res) =>
  res.json({
    success: true,
    data: await prisma.settings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
  }),
);
router.patch("/settings", roles("ADMIN"), async (req, res) => {
  const { mode, negativeThreshold, windowMinutes } = req.body;
  choice(mode, ["MANUAL", "CONDITIONAL"], "Chế độ");
  if (
    !Number.isInteger(negativeThreshold) ||
    negativeThreshold < 2 ||
    negativeThreshold > 50 ||
    !Number.isInteger(windowMinutes) ||
    windowMinutes < 1 ||
    windowMinutes > 1440
  )
    throw new HttpError(400, "Ngưỡng: 2–50 bình luận; thời gian: 1–1440 phút.");
  const data = await prisma.$transaction(async (db) => {
    const s = await db.settings.upsert({
      where: { id: "default" },
      create: { id: "default", mode, negativeThreshold, windowMinutes },
      update: { mode, negativeThreshold, windowMinutes },
    });
    await audit(
      db,
      req.user.email,
      "SETTINGS_UPDATED",
      "default",
      JSON.stringify({ mode, negativeThreshold, windowMinutes }),
    );
    return s;
  });
  res.json({ success: true, data });
});
router.get("/dashboard", async (req, res) => {
  const [
    posts,
    campaigns,
    pending,
    comments,
    alerts,
    sentiments,
    jobs,
    audits,
    trend,
  ] = await Promise.all([
    prisma.post.count(),
    prisma.campaign.count(),
    prisma.post.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.comment.count(),
    prisma.alert.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.comment.groupBy({
      by: ["sentiment"],
      where: { analysisStatus: "DONE" },
      _count: { _all: true },
    }),
    prisma.workflowJob.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.comment.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
        analysisStatus: "DONE",
      },
      select: { createdAt: true, sentiment: true },
    }),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString(
      "en-CA",
      { timeZone: "Asia/Ho_Chi_Minh" },
    );
    return { date, total: 0, negative: 0 };
  });
  for (const c of trend) {
    const day = days.find(
      (d) =>
        d.date ===
        c.createdAt.toLocaleDateString("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
        }),
    );
    if (day) {
      day.total++;
      if (["NEGATIVE", "CRISIS"].includes(c.sentiment)) day.negative++;
    }
  }
  res.json({
    success: true,
    data: {
      posts,
      campaigns,
      pending,
      comments,
      alerts,
      sentiments,
      jobs,
      audits,
      trend: days,
    },
  });
});
router.get("/jobs", async (req, res) =>
  res.json({
    success: true,
    data: await prisma.workflowJob.findMany({
      where: req.query.entityId
        ? { entityId: text(req.query.entityId, "entityId", 100) }
        : {},
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  }),
);
export default router;
