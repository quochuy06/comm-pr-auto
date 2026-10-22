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
  const config = { pageId: value("FACEBOOK_PAGE_ID"), token: value("FACEBOOK_PAGE_ACCESS_TOKEN"), userToken: value("FACEBOOK_USER_ACCESS_TOKEN"), version: value("FACEBOOK_GRAPH_API_VERSION"), appSecret: value("FACEBOOK_APP_SECRET"), verifyToken: value("FACEBOOK_WEBHOOK_VERIFY_TOKEN"), exchangedAt: value("FACEBOOK_TOKEN_EXCHANGED_AT"), userTokenExpiresAt: value("FACEBOOK_USER_TOKEN_EXPIRES_AT") };
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
  async function request(path, body, token = config.token) {
    let response, data;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${config.version}/${path}`, {
        method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` },
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
    async messagingAccess() {
      if (!config.userToken) return false;
      const data = await request("me/permissions", null, config.userToken);
      return data.data?.some(p => p.permission === "pages_messaging" && p.status === "granted") === true;
    },
    async inbox() {
      const messages = []; let after;
      for (let i = 0; i < 5; i++) {
        const data = await request(`${config.pageId}/conversations?platform=messenger&fields=id,updated_time,messages.limit(20){id,message,from,to,created_time}&limit=20${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        if (!Array.isArray(data.data)) throw new FacebookError("Chưa đọc được hộp thư Messenger.");
        for (const conversation of data.data) messages.push(...(conversation.messages?.data || []));
        if (!data.paging?.next) return { messages, complete: true };
        after = data.paging?.cursors?.after; if (!after) break;
      }
      return { messages, complete: false };
    },
    async incomingMessage(id) {
      if (typeof id !== "string" || !id || id.length > 500) throw new FacebookError("ID tin nhắn không hợp lệ.");
      return request(`${encodeURIComponent(id)}?fields=id,message,from,to,created_time`);
    },
    async sendMessage(senderId, message) {
      if (!/^\d+$/.test(senderId) || senderId === config.pageId) throw new FacebookError("Người nhận Messenger không hợp lệ.");
      const data = await request(`${config.pageId}/messages`, new URLSearchParams({ messaging_type: "RESPONSE", recipient: JSON.stringify({ id: senderId }), message: JSON.stringify({ text: message }) }));
      if (typeof data.message_id !== "string" || !data.message_id || data.recipient_id !== senderId) throw new FacebookError("Chưa xác định kết quả gửi Messenger.", true);
      return data.message_id;
    },
    async comments(postId) {
      facebookLink(postId, config.pageId);
      const comments = []; let after;
      for (let i = 0; i < 20; i++) {
        const data = await request(`${postId}/comments?fields=id,message,from,created_time,parent&filter=toplevel&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        if (!Array.isArray(data.data)) throw new FacebookError("Facebook chưa trả danh sách bình luận hợp lệ.");
        comments.push(...data.data);
        if (!data.paging?.next) return { comments, complete: true };
        after = data.paging?.cursors?.after;
        if (!after) break;
      }
      return { comments, complete: false };
    },
    async comment(id) {
      if (!/^\d+_\d+$/.test(id)) throw new FacebookError("ID bình luận không hợp lệ.");
      return request(`${id}?fields=id,message,from,created_time,parent`);
    },
    async reply(id, message) {
      if (!/^\d+_\d+$/.test(id)) throw new FacebookError("ID bình luận không hợp lệ.");
      const data = await request(`${id}/comments`, new URLSearchParams({ message }));
      if (!/^\d+_\d+$/.test(data.id)) throw new FacebookError("Chưa xác định ID phản hồi Facebook.", true);
      return data.id;
    },
    async verifyReply(id, reply) {
      const data = await this.comment(id);
      if (data.from?.id !== config.pageId || data.parent?.id !== reply.comment.externalId || data.message !== reply.text || !Number.isFinite(Date.parse(data.created_time)) || Date.parse(data.created_time) < new Date(reply.attemptedAt).getTime() - 60000)
        throw new FacebookError("Phản hồi không khớp Page, bình luận, nội dung hoặc thời điểm gửi.");
      return data.id;
    },
    async metrics(postId) {
      facebookLink(postId, config.pageId);
      const data = await request(`${postId}?fields=id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares`);
      const count = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
      let views = null, insightsError = null;
      try {
        const insights = await request(`${postId}/insights?metric=post_media_view&period=lifetime`);
        const metric = insights.data?.find(m => m.name === "post_media_view");
        views = count(metric?.total_value?.value ?? metric?.values?.at(-1)?.value);
      } catch (e) { insightsError = e instanceof FacebookError ? e.message : "Chưa đọc được Insights."; }
      return { reactions: count(data.reactions?.summary?.total_count), comments: count(data.comments?.summary?.total_count), shares: count(data.shares?.count), views, reach: null, impressions: null, insightsError,
        note: "Số liệu tích lũy đọc từ Facebook; Views dùng post_media_view khi API cung cấp. Chỉ số thiếu để trống; chưa có reach/impressions." };
    },
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
