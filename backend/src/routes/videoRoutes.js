import { Router } from "express";
import prisma from "../prisma.js";
import { HttpError } from "../lib/errors.js";
import { roles } from "../middleware/auth.js";
import { createVideoJob, syncVideoJob, getVideoState, listVideoJobs } from "../services/videoJobs.js";

// Demo API for AI video generation (HOANG-API04). Generating is a provider
// read/poll afterwards — GET syncs only while the job is PENDING and never
// submits a new generation. Publishing is out of scope here (HUY-WF03).
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (req) => {
  if (!UUID.test(req.params.id || ""))
    throw new HttpError(400, "ID tác vụ video không hợp lệ.");
  return req.params.id;
};

router.get("/jobs", async (req, res) => {
  res.json({ success: true, data: await listVideoJobs(prisma, { limit: req.query.limit }) });
});

router.post("/jobs", roles("ADMIN", "EDITOR"), async (req, res) => {
  res.status(201).json({
    success: true,
    data: await createVideoJob(prisma, req.body, { requestedBy: req.user.id }),
  });
});

router.get("/jobs/:id", async (req, res) => {
  const id = idOf(req);
  let state = await getVideoState(prisma, id);
  if (state.status === "PENDING") state = await syncVideoJob(prisma, id);
  res.json({ success: true, data: state });
});

router.post("/jobs/:id/sync", async (req, res) => {
  res.json({ success: true, data: await syncVideoJob(prisma, idOf(req)) });
});

export default router;
