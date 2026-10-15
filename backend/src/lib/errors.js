export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function text(value, name, max = 500, optional = false) {
  if (optional && (value === undefined || value === null || value === ""))
    return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `${name} phải có 1–${max} ký tự.`);
  return value.trim();
}
export function choice(value, allowed, name) {
  if (!allowed.includes(value))
    throw new HttpError(400, `${name} không hợp lệ.`);
  return value;
}
export function safeImageUrl(value) {
  if (typeof value !== "string" || value.length > 6000)
    throw new HttpError(400, "URL ảnh không hợp lệ.");
  if (/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol === "https:" && !u.username && !u.password) return u.href;
  } catch {}
  throw new HttpError(400, "Ảnh cần dùng URL HTTPS.");
}
export const audit = (db, actor, action, entityId, detail = "") =>
  db.auditLog.create({ data: { actor, action, entityId, detail } });
