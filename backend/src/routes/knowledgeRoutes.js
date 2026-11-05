import { Router } from "express";
import { roles } from "../middleware/auth.js";
import { previewFaqDraft } from "../services/knowledgeDraft.js";

const router = Router();
router.post("/faq/preview", roles("ADMIN", "EDITOR"), (req, res) => {
  res.json({ success: true, data: previewFaqDraft(req.body) });
});
export default router;
