import "dotenv/config";
import express from "express";
import cors from "cors";
import prisma from "./prisma.js";
import authRoutes from "./routes/authRoutes.js";
import coreRoutes from "./routes/coreRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import approvalRoutes from "./routes/approvalRoutes.js";
import communityRoutes from "./routes/communityRoutes.js";
import { authenticate, internalOnly } from "./middleware/auth.js";
import { prepareImage } from "./controllers/imageController.js";
import { handleN8nCallback } from "./controllers/approvalController.js";
import { mediaDir } from "./services/images.js";
export const app = express();
app.disable("x-powered-by");
const origins = (
  process.env.FRONTEND_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000"
).split(",");
app.use(cors({ origin: origins, credentials: true }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") &&
    !origins.includes(req.get("origin"))
  )
    return res
      .status(403)
      .json({ success: false, message: "Nguồn yêu cầu không được cho phép." });
  next();
});
app.use(express.json({ limit: "128kb" }));
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "OK", database: "OK" });
  } catch {
    res.status(503).json({ status: "DEGRADED", database: "UNAVAILABLE" });
  }
});
app.use("/media", express.static(mediaDir, { dotfiles: "deny" }));
app.use("/api/auth", authRoutes);
app.post("/api/webhooks/prepare-image", internalOnly, prepareImage);
app.post("/api/webhooks/:kind", internalOnly, handleN8nCallback);
app.use("/api", authenticate);
app.use("/api", coreRoutes, approvalRoutes, communityRoutes);
app.use("/api/posts", postRoutes);
app.use((req, res) =>
  res.status(404).json({ success: false, message: "Không tìm thấy API." }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err.status || { P2025: 404, P2003: 400, P2002: 409 }[err.code] || 500;
  const message = err.status
    ? err.message
    : err.code === "P2025"
      ? "Không tìm thấy dữ liệu."
      : err.code === "P2003"
        ? "Dữ liệu liên kết không tồn tại."
        : err.code === "P2002"
          ? "Dữ liệu đã tồn tại."
          : "Không thể xử lý yêu cầu. Hãy thử lại.";
  if (status === 500) console.error("API error:", err.code || err.name);
  res.status(status).json({ success: false, message });
});
