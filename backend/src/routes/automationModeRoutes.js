import { Router } from "express";
import { roles } from "../middleware/auth.js";
import { previewAutomationMode, channelModes, updateChannelMode } from "../services/automationMode.js";

import prisma from "../prisma.js";
import { knowledgePage } from "../services/knowledge.js";
const router = Router();
router.get("/channels", roles("ADMIN"), async (req, res) => {
  res.json({ success: true, data: await channelModes(prisma, knowledgePage(req.query)) });
});
router.patch("/channels/:channel", roles("ADMIN"), async (req, res) => {
  res.json({ success: true, data: await updateChannelMode(prisma, knowledgePage(req.query), req.params.channel, req.body, req.user.email) });
});
// Dry-run only. Client-supplied checks must never authorize a real send.
router.post("/mode-preview", roles("ADMIN"), (req, res) => {
  res.json({ success: true, data: previewAutomationMode(req.body) });
});
export default router;
