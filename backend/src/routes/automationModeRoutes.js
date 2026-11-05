import { Router } from "express";
import { roles } from "../middleware/auth.js";
import { previewAutomationMode } from "../services/automationMode.js";

const router = Router();
// Dry-run only. Client-supplied checks must never authorize a real send.
router.post("/mode-preview", roles("ADMIN"), (req, res) => {
  res.json({ success: true, data: previewAutomationMode(req.body) });
});
export default router;
