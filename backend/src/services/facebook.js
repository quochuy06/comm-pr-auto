import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadLocalImage } from "./images.js";

// Credentials never enter responses, workflow payloads, query strings or logs.
export function facebookConfig() {
  let local = {};
  try { local = dotenv.parse(readFileSync(fileURLToPath(new URL("../../../.local/facebook.env", import.meta.url)))); }
  catch (e) { if (e.code !== "ENOENT") throw new FacebookError("Không đọc được cấu hình Facebook."); }
  const value = key => (process.env[key] ?? local[key] ?? "").trim();
  const config = { pageId: value("FACEBOOK_PAGE_ID"), token: value("FACEBOOK_PAGE_ACCESS_TOKEN"), version: value("FACEBOOK_GRAPH_API_VERSION") };
  if (!/^\d+$/.test(config.pageId) || !config.token || /\s/.test(config.token) || !/^v\d+\.\d+$/.test(config.version))
    throw new FacebookError("Chưa cấu hình đầy đủ Page ID, token Page và phiên bản API Facebook.");
  return config;
}
export class FacebookError extends Error {
  constructor(message, uncertain = false) { super(message); this.uncertain = uncertain; }
}
export const facebookMessage = post => `${post.headline}\n\n${post.content}`;
export function facebookLink(postId, pageId) {
  if (!new RegExp(`^${pageId}_\\d+$`).test(postId)) throw new FacebookError("Facebook chưa trả ID bài hợp lệ; cần đối soát.", true);
  return `https://www.facebook.com/${postId}`;
}
export function createFacebookClient(config = facebookConfig(), fetchImpl = fetch, imageLoader = loadLocalImage) {
  async function request(path, body) {
    let response, data;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${config.version}/${path}`, {
        method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}` },
        ...(body ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(body ? 18000 : 8000),
      });
      data = await response.json();
    } catch { throw new FacebookError("Không nhận được phản hồi đầy đủ từ Facebook.", !!body); }
    if (!response.ok || data.error) {
      const code = Number(data.error?.code);
      const detail = code === 190 ? "Token hết hạn hoặc không hợp lệ; cần kết nối lại." : [10, 200].includes(code) ? "Ứng dụng thiếu quyền với Page." : "Facebook từ chối yêu cầu.";
      // Never echo Meta's message: it can contain credentials or submitted content.
      throw new FacebookError(`${detail} (HTTP ${response.status}${Number.isFinite(code) ? `, mã ${code}` : ""})`, !!body && (response.status >= 500 || response.status === 408 || response.ok || data.error?.is_transient === true || [1, 2].includes(code)));
    }
    return data;
  }
  async function identity() {
    const page = await request("me?fields=id,name");
    if (page.id !== config.pageId) throw new FacebookError("Token không thuộc Page đã cấu hình. Hãy dùng token Page, không dùng token người dùng.");
    return { pageId: page.id, pageName: page.name };
  }
  return {
    pageId: config.pageId, identity,
    async prepare(post, pageId) {
      if (pageId !== config.pageId) throw new FacebookError("Page đã đổi sau khi đặt lịch; cần kiểm tra lại lịch đăng.");
      await identity();
      let image;
      try { image = await imageLoader(post.bannerUrl); }
      catch { throw new FacebookError("Không đọc được ảnh nội bộ hợp lệ (tối đa 6 MB). Hãy kiểm tra ảnh trước khi đặt lịch lại."); }
      if (!["image/png", "image/jpeg"].includes(image.mimeType)) throw new FacebookError("Đăng Facebook hiện hỗ trợ ảnh PNG/JPEG. Hãy dùng ảnh phù hợp.");
      const body = new FormData();
      body.set("source", new Blob([image.bytes], { type: image.mimeType }), `banner.${image.ext}`);
      body.set("caption", facebookMessage(post));
      body.set("published", "true");
      return body;
    },
    async publish(body) {
      const data = await request(`${config.pageId}/photos`, body);
      const permalink = facebookLink(data.post_id, config.pageId);
      return { externalPostId: data.post_id, permalink };
    },
    async verifyPost(postId, schedule) {
      facebookLink(postId, config.pageId);
      if (schedule.pageId !== config.pageId) throw new FacebookError("Cấu hình Page không khớp lịch đăng.");
      const data = await request(`${postId}?fields=id,from,message,created_time`);
      const created = Date.parse(data.created_time);
      if (data.id !== postId || data.from?.id !== config.pageId || data.message !== facebookMessage(schedule.post) || !Number.isFinite(created) || created < new Date(schedule.attemptedAt).getTime() - 60000)
        throw new FacebookError("Bài Facebook không khớp Page, nội dung hoặc thời điểm gửi. Chưa xác nhận xuất bản.");
      return { externalPostId: data.id, permalink: facebookLink(data.id, config.pageId) };
    },
  };
}
