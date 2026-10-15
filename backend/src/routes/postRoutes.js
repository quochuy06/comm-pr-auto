import { Router } from "express";
import {
  getPosts,
  getPostById,
  generatePost,
  regeneratePost,
  processPostImage,
} from "../controllers/postController.js";
import { roles } from "../middleware/auth.js";
const router = Router();
router.get("/", getPosts);
router.get("/:id", getPostById);
router.post("/generate", roles("ADMIN", "EDITOR"), generatePost);
router.post("/:id/regenerate", roles("ADMIN", "EDITOR"), regeneratePost);
router.post(
  "/:id/:action",
  roles("ADMIN", "EDITOR", "REVIEWER"),
  (req, res, next) => {
    if (!["regenerate-image", "review-image"].includes(req.params.action))
      return res
        .status(404)
        .json({ success: false, message: "Không tìm thấy thao tác." });
    return processPostImage(req, res, next);
  },
);
export default router;
