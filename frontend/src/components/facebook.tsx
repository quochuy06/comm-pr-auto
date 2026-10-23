"use client";
import { useState } from "react";
import { useAuth } from "@/components/shell";
import { useResource, send, errorMessage } from "@/lib/api";
import { Notice, dateTime } from "@/components/ui";
import type { Post, ReviewComment } from "@/lib/types";

export function FacebookPostControls({ post, refresh }: { post: Post; refresh: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const user = useAuth();
  const s = post.schedule;
  if (s?.target !== "FACEBOOK") return <p className="hint">Bài trên feed mô phỏng</p>;
  const snapshot = s.metricSnapshots?.[0];
  async function sync(kind: string) {
    setBusy(true); setError("");
    try { await send(`/facebook/schedules/${s!.id}/${kind}`); refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="notice info mt">
    <strong>Facebook Page</strong>{s.permalink && <> · <a href={s.permalink} target="_blank" rel="noreferrer">Xem bài trên Facebook</a></>}
    <p className="hint">Bình luận trực tiếp được đồng bộ định kỳ khoảng 15 giây/lượt (có thể lâu hơn khi nhiều bài). Lần cuối: {s.commentsSyncedAt ? dateTime(s.commentsSyncedAt) : "Chưa đồng bộ"}.</p>
    <Notice error={error || s.commentSyncError || ""} />
    {snapshot && <div className="mt">
      <p>Reactions: <strong>{snapshot.metrics.reactions ?? "Chưa có dữ liệu"}</strong> · Bình luận: <strong>{snapshot.metrics.comments ?? "Chưa có dữ liệu"}</strong> · Chia sẻ: <strong>{snapshot.metrics.shares ?? "Chưa có dữ liệu"}</strong> · Views: <strong>{snapshot.metrics.views ?? "Chưa có dữ liệu"}</strong></p>
      <p className="hint">Thu thập: {dateTime(snapshot.capturedAt)}. {snapshot.metrics.note}</p>
      {snapshot.metrics.insightsError && <p className="hint">Insights: {snapshot.metrics.insightsError}</p>}
    </div>}
    {(user?.role === "ADMIN" || user?.role === "REVIEWER") && <div className="row wrap mt">
      <button className="btn secondary small" disabled={busy} onClick={() => void sync("comments")}>Đồng bộ bình luận</button>
      <button className="btn secondary small" disabled={busy} onClick={() => void sync("metrics")}>Lấy số liệu Facebook</button>
    </div>}
  </section>;
}

export function FacebookReplyDelivery({ comment: c, refresh }: { comment: ReviewComment; refresh: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const user = useAuth(), r = c.facebookReply;
  if (!r) return null;
  const labels: Record<string, string> = { PENDING: "Đã duyệt, chờ gửi Facebook", SENDING: "Đang gửi Facebook", SENT: "Đã gửi Facebook", FAILED: "Gửi Facebook thất bại", UNCERTAIN: "Chưa rõ kết quả gửi — cần đối soát", CANCELLED: "Đã hủy gửi" };
  const changed = r.sourceHash !== c.sourceHash;
  async function act(action: string, body: unknown) {
    setBusy(true); setError("");
    try { await send(`/facebook/replies/${r!.id}/${action}`, "POST", body); refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="notice info mt">
    <strong>{labels[r.status] || r.status}</strong>
    {r.automatic && <p className="hint">Gửi theo mẫu đã được quản trị viên bật.</p>}
    {r.error && <p>{r.error}</p>}
    {changed && <p>Bình luận đã đổi sau khi duyệt; phản hồi này thuộc phiên bản trước.</p>}
    {c.remoteDeleted && <p>Bình luận đã bị xóa trên Facebook.</p>}
    {r.status === "FAILED" && !changed && !c.remoteDeleted && (user?.role === "ADMIN" || user?.role === "REVIEWER") && <form onSubmit={e => { e.preventDefault(); void act("retry", { confirmFacebook: true, sourceHash: c.sourceHash }); }}>
      <label className="mt"><input type="checkbox" required disabled={busy} /> Tôi xác nhận gửi lại phản hồi này lên Facebook.</label>
      <button className="btn secondary small mt" disabled={busy}>Thử gửi lại</button>
    </form>}
    {r.status === "UNCERTAIN" && user?.role === "ADMIN" && <form onSubmit={e => { e.preventDefault(); void act("reconcile", { externalId: new FormData(e.currentTarget).get("externalId") }); }}>
      <label className="mt">ID phản hồi đã tìm thấy trên Facebook<input name="externalId" required pattern="[0-9]+_[0-9]+" placeholder="ID_ID" disabled={busy} /></label>
      <button className="btn secondary small mt" disabled={busy}>Kiểm tra và xác nhận đã gửi</button>
    </form>}
    <Notice error={error} />
  </div>;
}

export function FacebookSettings() {
  const user = useAuth();
  const { data, error, refresh } = useResource<{ pageName: string; pageId: string; exchangedAt: string | null; userTokenExpiresAt: string | null; webhookNote: string }>(user?.role === "ADMIN" ? "/facebook/status" : null);
  if (user?.role !== "ADMIN") return null;
  return <section className="card mt">
    <h2>Kết nối Facebook</h2><Notice error={error} />
    {data && <><p>Đang kết nối <strong>{data.pageName}</strong> · {data.pageId}</p>
      <p className="hint">Đổi token lần cuối: {data.exchangedAt ? dateTime(data.exchangedAt) : "Chưa ghi nhận"}. Hạn User Token: {data.userTokenExpiresAt ? dateTime(data.userTokenExpiresAt) : "Chưa có thông tin"}. Token Page có thể bị thu hồi khi thay đổi quyền/tài khoản.</p>
      <p className="hint">{data.webhookNote}</p></>}
    <p>Phản hồi Facebook có thể dùng mẫu đã bật bên dưới; trường hợp không đủ điều kiện vẫn chờ người duyệt.</p>
    <button className="btn secondary small mt" onClick={refresh}>Kiểm tra kết nối</button>
    <FacebookAutomationSettings />
  </section>;
}

interface AutomationRule {
  pageId: string;
  commentEnabled: boolean;
  messengerEnabled: boolean;
  commentTemplate: string;
  messengerTemplate: string;
  version: string;
  messengerSyncedAt: string | null;
  messengerSyncError: string | null;
}
export function FacebookAutomationSettings() {
  const { data, error, loading, refresh } = useResource<AutomationRule | null>("/facebook/automation");
  const history = useResource<{ id: string; senderName: string; incomingText: string; incomingAt: string; replyText: string; status: string; error: string | null }[]>("/facebook/inbox", 10000);
  const [busy, setBusy] = useState(false), [actionError, setError] = useState(""), [message, setMessage] = useState("");
  const status: Record<string, string> = { PENDING: "Chờ gửi", SENDING: "Đang gửi", SENT: "Đã gửi", FAILED: "Gửi thất bại", UNCERTAIN: "Chưa rõ kết quả — xem hộp thư Page, không tự gửi lại", SKIPPED: "Bỏ qua lời chào lặp", HUMAN: "Cần người phụ trách", CANCELLED: "Đã hủy" };
  return <div className="mt">
    <hr className="divider" /><h3>Trả lời tự động theo mẫu</h3>
    <p className="hint">Comment chỉ được trả lời dưới comment. Messenger chỉ trả lời khi khách chủ động nhắn Page, tối đa một lời chào/người/60 phút. Áp dụng dữ liệu mới sau khi bật; chế độ xử lý chung phải là Tự động có điều kiện.</p>
    <Notice error={actionError || error} message={message} />
    {!loading && <form key={data?.version || "new"} onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(""); setMessage("");
      try {
        await send("/facebook/automation", "PUT", { commentEnabled: f.get("commentEnabled") === "on", messengerEnabled: f.get("messengerEnabled") === "on", commentTemplate: f.get("commentTemplate"), messengerTemplate: f.get("messengerTemplate"), confirmAutomatic: f.get("confirmAutomatic") === "on" });
        setMessage("Đã lưu cấu hình trả lời tự động."); refresh();
      } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}>
        <label className="mt"><input type="checkbox" name="commentEnabled" defaultChecked={data?.commentEnabled || false} /> Tự trả lời bình luận Facebook</label>
        <div className="field mt"><label htmlFor="facebook-comment-template">Mẫu dưới bình luận</label><textarea id="facebook-comment-template" name="commentTemplate" defaultValue={data?.commentTemplate || "Chào {name}! Hiên Cà Phê có thể giúp gì cho bạn?"} required maxLength={800} rows={2} /></div>
        <p className="hint">Gửi mẫu cố định sau khi nhận bình luận, không chờ phân tích hay kiểm tra AI. Phân tích rủi ro chạy riêng.</p>
        <label className="mt"><input type="checkbox" name="messengerEnabled" defaultChecked={data?.messengerEnabled || false} /> Tự chào khi khách nhắn Messenger</label>
        <div className="field mt"><label htmlFor="facebook-messenger-template">Mẫu Messenger</label><textarea id="facebook-messenger-template" name="messengerTemplate" defaultValue={data?.messengerTemplate || "Chào {name}! Hiên Cà Phê có thể giúp gì cho bạn? Bạn cứ gửi câu hỏi tại đây nhé."} required maxLength={800} rows={2} /></div>
        <p className="hint">Biến {"{name}"} được thay bằng tên Facebook khi API cung cấp; nếu thiếu tên sẽ dùng “bạn”. Messenger cần quyền pages_messaging.</p>
        <label className="mt"><input type="checkbox" name="confirmAutomatic" /> Tôi đã xem hai mẫu và cho phép hệ thống tự gửi theo các luồng được bật.</label>
        <button className="btn mt" disabled={busy}>Lưu mẫu và trạng thái</button>
      </fieldset>
    </form>}
    {data && <p className="hint mt">Đồng bộ hộp thư: {data.messengerSyncedAt ? dateTime(data.messengerSyncedAt) : "Chưa chạy"}. {data.messengerSyncError || ""}</p>}
    <div className="row between mt"><h3>Lịch sử lời chào Messenger</h3><button className="btn secondary small" disabled={busy || !data?.messengerEnabled} onClick={async () => {
      setBusy(true); setError(""); try { await send("/facebook/inbox/sync"); refresh(); history.refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
    }}>Đồng bộ hộp thư</button></div>
    <Notice error={history.error} />
    {!history.data?.length && <p className="hint">Chưa có tin nhắn mới thuộc luồng tự động.</p>}
    {history.data?.slice(0, 20).map(m => <div className="comment" key={m.id}>
      <strong>{m.senderName} · {status[m.status] || m.status}</strong><p className="hint">{dateTime(m.incomingAt)}</p>
      <p className="prose-content">{m.incomingText || "Tin nhắn không có văn bản"}</p><p className="reply">{m.replyText}</p>{m.error && <p className="hint">{m.error}</p>}
    </div>)}
  </div>;
}
