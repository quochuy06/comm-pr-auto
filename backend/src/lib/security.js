import {
  scrypt as scryptCallback,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt + ":" + Buffer.from(await scrypt(password, salt, 64)).toString("hex")
  );
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const result = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(hex, "hex");
  return expected.length === result.length && timingSafeEqual(expected, result);
}
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  return timingSafeEqual(Buffer.from(tokenHash(a)), Buffer.from(tokenHash(b)));
}
