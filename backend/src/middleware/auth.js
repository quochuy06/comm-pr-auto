import prisma from "../prisma.js";
import { tokenHash, equalSecret } from "../lib/security.js";
import { HttpError } from "../lib/errors.js";
export function cookieToken(req) {
  return (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("comm_session="))
    ?.slice(13);
}
export async function authenticate(req, res, next) {
  const token = cookieToken(req);
  const session =
    token &&
    (await prisma.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    }));
  if (!session || session.expiresAt <= new Date())
    throw new HttpError(401, "Vui lòng đăng nhập.");
  req.user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
  next();
}
export const roles =
  (...allowed) =>
  (req, res, next) => {
    if (!allowed.includes(req.user.role))
      throw new HttpError(
        403,
        "Tài khoản không có quyền thực hiện thao tác này.",
      );
    next();
  };
export function internalOnly(req, res, next) {
  if (!equalSecret(req.get("x-comm-token"), process.env.N8N_CALLBACK_SECRET))
    throw new HttpError(401, "Callback không được xác thực.");
  next();
}
