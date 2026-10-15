import { Router } from "express";
import prisma from "../prisma.js";
import { authenticate, cookieToken } from "../middleware/auth.js";
import { newToken, tokenHash, verifyPassword } from "../lib/security.js";
import { HttpError, text } from "../lib/errors.js";
const router = Router();
const attempts = new Map();
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
};
router.post("/login", async (req, res) => {
  const email = text(req.body.email, "Email", 200).toLowerCase();
  const password = text(req.body.password, "Mật khẩu", 200);
  const key = req.ip;
  const now = Date.now();
  for (const [k, v] of attempts) if (now - v.at > 900000) attempts.delete(k);
  const attempt = attempts.get(key) || { count: 0, at: now };
  if (attempt.count >= 20)
    throw new HttpError(429, "Đăng nhập sai quá nhiều lần. Hãy chờ 15 phút.");
  attempt.count++;
  attempts.set(key, attempt);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash)))
    throw new HttpError(401, "Email hoặc mật khẩu chưa đúng.");
  attempts.delete(key);
  const token = newToken();
  await prisma.session.create({
    data: {
      tokenHash: tokenHash(token),
      userId: user.id,
      expiresAt: new Date(now + 86400000),
    },
  });
  res.cookie("comm_session", token, { ...cookieOptions, maxAge: 86400000 });
  res.json({
    success: true,
    data: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});
router.post("/logout", async (req, res) => {
  const token = cookieToken(req);
  if (token)
    await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  res.clearCookie("comm_session", cookieOptions).json({ success: true });
});
router.get("/me", authenticate, (req, res) =>
  res.json({ success: true, data: req.user }),
);
export default router;
