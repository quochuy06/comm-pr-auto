import { Router } from "express";
import { approvePost, rejectPost } from "../controllers/approvalController.js";
import { roles } from "../middleware/auth.js";
const router = Router();
router.patch("/posts/:id/approve", roles("ADMIN", "REVIEWER"), approvePost);
router.patch("/posts/:id/reject", roles("ADMIN", "REVIEWER"), rejectPost);
export default router;
