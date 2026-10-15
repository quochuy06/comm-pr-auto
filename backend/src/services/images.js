import axios from "axios";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
export const mediaDir = path.resolve("storage/media");
export function imageType(b) {
  if (b.length < 256) return null;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { ext: "png", mimeType: "image/png" };
  if (b[0] === 255 && b[1] === 216)
    return { ext: "jpg", mimeType: "image/jpeg" };
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return { ext: "webp", mimeType: "image/webp" };
  return null;
}
export async function loadLocalImage(url) {
  if (!/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(url || ""))
    throw new Error("Ảnh chưa được lưu nội bộ; hãy tạo ảnh mới để kiểm tra.");
  const bytes = await readFile(path.join(mediaDir, path.basename(url)));
  if (bytes.length > 6 * 1024 * 1024)
    throw new Error("Ảnh vượt quá giới hạn 6 MB.");
  const type = imageType(bytes);
  if (!type) throw new Error("Tệp không phải ảnh được hỗ trợ.");
  return {
    bytes,
    ...type,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function fetchBanner(url, {
  get = axios.get,
  attempts = 2,
  apiKey = process.env.POLLINATIONS_API_KEY,
  model = process.env.POLLINATIONS_IMAGE_MODEL || "flux",
} = {}) {
  let target;
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      !((u.hostname === "image.pollinations.ai" && u.pathname.startsWith("/prompt/")) ||
        (u.hostname === "gen.pollinations.ai" && u.pathname.startsWith("/image/"))) ||
      u.port ||
      u.username ||
      u.password
    )
      return {
        imageStatus: "FAILED",
        bannerUrl: null,
        imageError: "Nguồn ảnh không được phép tải.",
      };
    // Keep old published n8n workflows compatible. Credentials stay on the backend.
    target = new URL("https://gen.pollinations.ai/image/" + u.pathname.replace(/^\/(prompt|image)\//, ""));
    for (const key of ["width", "height", "seed", "nologo"])
      if (u.searchParams.has(key)) target.searchParams.set(key, u.searchParams.get(key));
    target.searchParams.set("model", model);
  } catch {
    return {
      imageStatus: "FAILED",
      bannerUrl: null,
      imageError: "URL ảnh không hợp lệ.",
    };
  }
  if (!apiKey?.trim()) return {
    imageStatus: "FAILED",
    bannerUrl: null,
    imageError: "Chưa cấu hình dịch vụ tạo ảnh. Nội dung đã được giữ lại; hãy nhờ quản trị viên cấu hình key Pollinations rồi thử lại riêng ảnh.",
  };
  let imageError = "Không tải được ảnh.";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const r = await get(target.toString(), {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 6 * 1024 * 1024,
        maxRedirects: 0,
      });
      const bytes = Buffer.from(r.data);
      const type = imageType(bytes);
      if (!type)
        return {
          imageStatus: "FAILED",
          bannerUrl: null,
          imageError:
            "Dịch vụ trả về dữ liệu không phải ảnh PNG/JPEG/WebP hợp lệ.",
        };
      await mkdir(mediaDir, { recursive: true });
      const filename = `${randomUUID()}.${type.ext}`;
      await writeFile(path.join(mediaDir, filename), bytes);
      return {
        imageStatus: "VERIFIED",
        bannerUrl: `/media/${filename}`,
        imageError: null,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: type.mimeType,
      };
    } catch (e) {
      const status = e.response?.status;
      imageError = status
        ? status === 402
          ? "Dịch vụ ảnh đã hết số dư hoặc hạn mức (HTTP 402). Nội dung được giữ lại; quản trị viên cần kiểm tra tài khoản Pollinations trước khi thử lại riêng ảnh."
          : status === 401 || status === 403
            ? "Key tạo ảnh không hợp lệ hoặc không có quyền (HTTP " + status + "). Hãy nhờ quản trị viên kiểm tra cấu hình Pollinations."
          : status === 429
            ? "Dịch vụ ảnh đang giới hạn lượt gọi (HTTP 429). Nội dung được giữ lại; hãy thử lại riêng ảnh sau."
          : `Dịch vụ ảnh trả HTTP ${status}.`
        : ["ECONNABORTED", "ETIMEDOUT"].includes(e.code)
          ? "Dịch vụ ảnh quá thời gian chờ 30 giây."
          : `Không tải được ảnh (${e.code || "network"}).`;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable) break;
    }
  }
  return { imageStatus: "FAILED", bannerUrl: null, imageError };
}
