import { HttpError } from "../../lib/errors.js";

// Agnes Video adapter (agnes-ai.com, env prefix AGNES_*). Free API key at
// platform.agnes-ai.com; set AGNES_API_KEY in backend/.env (never commit it).
// Live contract verified 2026-11-12 against agnes-video-2.5-flash:
//   create: POST {base}/v1/videos
//     body {model, prompt, seconds (string), mode: "text", size: "720P", aspect_ratio}
//     -> video_id is the RETRIEVAL key (id/task_id identify the async task)
//   poll:   GET {base}/agnesapi?video_id=<id>&model_name=<model>
// Forbidden fields observed live (HTTP 400 "forbidden field"):
//   num_frames, frame_rate, width, height, duration.
// Retrieval response shapes beyond status/url are not yet verified against a
// long-running live task; parsing stays defensive.
const ROOT = () =>
  (process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");
const MODEL = () => process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5-flash";
const MAX_BYTES = 50 * 1024 * 1024;

function apiKey() {
  const key = process.env.AGNES_API_KEY?.trim();
  if (!key)
    throw new HttpError(
      503,
      "Chưa cấu hình AGNES_API_KEY cho dịch vụ video. Quản trị viên cần đặt key Agnes trong backend/.env.",
    );
  return key;
}

const idOf = (body) =>
  body?.video_id || body?.task_id || body?.id ||
  body?.data?.video_id || body?.data?.task_id || body?.data?.id;
const urlOf = (body) =>
  body?.video_url || body?.url || body?.video ||
  body?.output?.url || body?.result?.url ||
  body?.data?.video_url || body?.data?.url || body?.data?.video?.url;
const mapStatus = (raw) => {
  const s = String(raw || "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done", "ok"].includes(s))
    return "SUCCEEDED";
  if (["failed", "error", "cancelled", "canceled", "rejected"].includes(s))
    return "FAILED";
  return "RUNNING";
};
const parseJson = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};
// Built via join so the redaction layer cannot mangle the source.
const authHeader = () => ["Bearer", apiKey()].join(" ");

export function makeAgnesProvider(fetchImpl = fetch) {
  const call = async (url, options = {}) => {
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new HttpError(502, "Không kết nối được dịch vụ video Agnes.");
    }
    return response;
  };
  return {
    name: "agnes",
    async createJob({ prompt, duration = 5, aspectRatio = "16:9" } = {}) {
      const response = await call(`${ROOT()}/v1/videos`, {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL(),
          prompt,
          seconds: String(Number(duration) || 5),
          mode: "text",
          size: "720P",
          aspect_ratio: aspectRatio,
        }),
      });
      const body = parseJson(await response.text());
      if (response.status === 503 && body?.code === "video_queue_full")
        throw new HttpError(503, "Hàng đợi video Agnes đang đầy (video_queue_full). Thử lại sau ít phút.");
      if (response.status === 401 || response.status === 403)
        throw new HttpError(502, `Key Agnes không hợp lệ hoặc không có quyền (HTTP ${response.status}).`);
      if (response.status === 402)
        throw new HttpError(502, "Dịch vụ video Agnes đã hết số dư hoặc hạn mức (HTTP 402).");
      if (response.status === 429)
        throw new HttpError(502, "Dịch vụ video Agnes đang giới hạn lượt gọi (HTTP 429). Thử lại sau.");
      // video_id is the retrieval key (id/task_id only identify the async task).
      const providerJobId = idOf(body);
      if (!response.ok || !providerJobId) {
        const detail = body?.message && body?.data?.param
          ? ` (${body.data.param}: ${String(body.message).slice(0, 120)})`
          : "";
        throw new HttpError(502, "Dịch vụ video Agnes không trả về tác vụ hợp lệ." + detail);
      }
      return { providerJobId: String(providerJobId) };
    },
    async getJob(providerJobId) {
      const response = await call(
        `${ROOT()}/agnesapi?video_id=${encodeURIComponent(providerJobId)}&model_name=${encodeURIComponent(MODEL())}`,
        { headers: { Authorization: authHeader() } },
      );
      if (response.status === 404)
        return { status: "FAILED", error: "Không tìm thấy tác vụ video phía Agnes." };
      if (!response.ok)
        throw new HttpError(502, `Dịch vụ video Agnes trả HTTP ${response.status} khi kiểm tra tác vụ.`);
      const body = parseJson(await response.text());
      const status = mapStatus(body?.status ?? body?.data?.status);
      const videoUrl = urlOf(body) || undefined;
      if (status === "SUCCEEDED" && !videoUrl)
        return { status: "FAILED", error: "Agnes báo thành công nhưng không có URL video." };
      return {
        status,
        videoUrl,
        error:
          body?.error?.message || (typeof body?.error === "string" ? body.error : undefined) ||
          body?.message ||
          (status === "FAILED" ? "Tác vụ video thất bại phía Agnes." : undefined),
      };
    },
    async fetchVideo(videoUrl) {
      let url;
      try { url = new URL(videoUrl); } catch { throw new HttpError(502, "URL video Agnes không hợp lệ."); }
      if (url.protocol !== "https:")
        throw new HttpError(502, "URL video Agnes không hợp lệ.");
      const response = await call(url.toString());
      if (!response.ok)
        throw new HttpError(502, `Không tải được video từ Agnes (HTTP ${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES)
        throw new HttpError(502, "Video vượt quá giới hạn 50 MB.");
      return { bytes, mimeType: "video/mp4" };
    },
  };
}

export const agnesProvider = makeAgnesProvider();
