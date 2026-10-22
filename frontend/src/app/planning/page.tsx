"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource, send, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Badge, Empty, dateTime } from "@/components/ui";
import type { Campaign, Post } from "@/lib/types";
type Idea = { topic: string; targetAudience: string; platform: string; suggestedDate: string; rationale: string };
type Plan = { id: string; status: string; campaign?: Campaign; result?: { summary: string; items: Idea[] }; createdPosts?: Record<string, string>; job?: { error?: string } };
type Schedule = { id: string; status: string; scheduledAt: string; error?: string; target: string; pageId?: string; externalPostId?: string; permalink?: string; post: Post };
export default function PlanningPage() {
  const user = useAuth();
  const editor = user?.role !== "REVIEWER";
  const reviewer = user?.role !== "EDITOR";
  const campaigns = useResource<Campaign[]>("/campaigns");
  const plans = useResource<Plan[]>("/artifacts?kind=planning", 5000);
  const posts = useResource<Post[]>("/posts?status=APPROVED", 5000);
  const schedules = useResource<Schedule[]>("/schedules", 5000);
  const facebook = useResource<{ connected: boolean; pageId?: string; pageName?: string; error?: string }>("/facebook/connection");
  const [target, setTarget] = useState("SIMULATOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function action(path: string, method = "POST", body = {}) {
    setBusy(true); setError(""); setMessage("");
    try { await send(path, method, body); plans.refresh(); schedules.refresh(); posts.refresh(); setMessage("Đã ghi nhận. Kết quả xử lý sẽ tự cập nhật."); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <>
    <PageTitle title="Kế hoạch & lịch đăng" description="Lập ý tưởng, duyệt kế hoạch và đặt giờ xuất bản lên feed mô phỏng hoặc Facebook Page." />
    <Notice error={error || campaigns.error || plans.error || schedules.error || posts.error} message={message} />
    <div className="grid two">
      {editor && <section className="card"><h2>Lập kế hoạch với AI</h2><form onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void action(`/campaigns/${f.get("campaignId")}/plan`, "POST", { brief: f.get("brief"), count: Number(f.get("count")) });
      }}>
        <div className="field"><label htmlFor="plan-campaign">Chiến dịch</label><select id="plan-campaign" name="campaignId" required><option value="">Chọn chiến dịch</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="plan-brief">Mục tiêu, đối tượng, khoảng thời gian và dữ kiện</label><textarea id="plan-brief" name="brief" required maxLength={5000} rows={5} placeholder="Ví dụ: Giới thiệu dịch vụ sửa xe đạp cho sinh viên, trong tuần tới…" /></div>
        <div className="field"><label htmlFor="plan-count">Số ý tưởng</label><input id="plan-count" name="count" type="number" min={1} max={20} defaultValue={5} required /></div>
        <button className="btn" disabled={busy}>Tạo kế hoạch</button>
      </form></section>}
      <section className="card"><h2>Đặt lịch bài đã duyệt</h2><p className="muted">Giờ theo múi giờ thiết bị. Workflow kiểm tra mỗi phút. Lịch trễ quá 24 giờ cần đặt lại.</p><form onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget); const value = String(f.get("scheduledAt"));
        void action(`/posts/${f.get("postId")}/schedule`, "POST", { scheduledAt: new Date(value).toISOString(), target, confirmFacebook: f.get("confirmFacebook") === "on" });
      }}>
        <div className="field"><label htmlFor="schedule-target">Nơi xuất bản</label><select id="schedule-target" value={target} onChange={e => setTarget(e.target.value)}><option value="SIMULATOR">Feed mô phỏng</option><option value="FACEBOOK" disabled={!facebook.data?.connected}>Facebook Page{facebook.data?.pageName ? ` — ${facebook.data.pageName}` : ""}</option></select></div>
        <p className="muted">{facebook.loading ? "Đang kiểm tra kết nối Facebook…" : facebook.data?.connected ? `Đã kết nối ${facebook.data.pageName} · Page ${facebook.data.pageId}` : facebook.data?.error || facebook.error || "Facebook chưa kết nối."}</p>
        <button type="button" className="btn secondary small" onClick={facebook.refresh}>Kiểm tra lại kết nối</button>
        <div className="field"><label htmlFor="schedule-post">Bài đã duyệt</label><select id="schedule-post" name="postId" required><option value="">Chọn bài</option>{posts.data?.filter(p => target !== "FACEBOOK" || p.platform === "Facebook").map(p => <option key={p.id} value={p.id}>{p.headline || p.topic}</option>)}</select></div>
        <div className="field"><label htmlFor="schedule-time">Ngày giờ đăng</label><input id="schedule-time" name="scheduledAt" type="datetime-local" required /></div>
        {target === "FACEBOOK" && <div className="field"><label className="check-row"><input type="checkbox" name="confirmFacebook" required /> Tôi xác nhận đăng công khai nội dung và ảnh đã duyệt lên {facebook.data?.pageName} vào giờ đã chọn.</label></div>}
        <button className="btn" disabled={busy || (target === "FACEBOOK" && !facebook.data?.connected)}>Lưu lịch đăng</button>
      </form></section>
    </div>
    <section className="stack mt"><h2>Kế hoạch chiến dịch</h2>
      {!plans.data?.length && <Empty>Chưa có kế hoạch. Tạo chiến dịch rồi gửi yêu cầu lập kế hoạch.</Empty>}
      {plans.data?.map(p => <article className="card" key={p.id}>
        <div className="row between wrap"><h3>{p.campaign?.name || "Kế hoạch"}</h3><Badge value={p.status} /></div>
        {p.job?.error && <p className="notice error">{p.job.error}</p>}
        <p>{p.result?.summary}</p>
        {reviewer && p.status === "PENDING_APPROVAL" && <div className="row"><button disabled={busy} className="btn" onClick={() => action(`/artifacts/${p.id}/approve`, "PATCH")}>Duyệt kế hoạch</button><button disabled={busy} className="btn secondary" onClick={() => action(`/artifacts/${p.id}/reject`, "PATCH")}>Từ chối</button></div>}
        {editor && p.status === "FAILED" && <button disabled={busy} className="btn secondary" onClick={() => action(`/artifacts/${p.id}/retry`)}>Thử lại</button>}
        {p.result?.items.map((idea, i) => <div className="comment" key={i}>
          <strong>{i + 1}. {idea.topic}</strong><p className="muted">{idea.platform} · {idea.suggestedDate} · {idea.targetAudience}</p><p>{idea.rationale}</p>
          {p.createdPosts?.[i] ? <Link href="/studio" className="btn secondary small">Đã tạo bài — mở Studio</Link> : editor && p.status === "APPROVED" && <button disabled={busy} className="btn secondary small" onClick={() => action(`/artifacts/${p.id}/items/${i}`)}>Tạo bài từ ý tưởng</button>}
        </div>)}
      </article>)}
    </section>
    <section className="stack mt"><h2>Lịch xuất bản</h2>{!schedules.data?.length && <Empty>Chưa có lịch đăng.</Empty>}
      {schedules.data?.map(s => <article className="card" key={s.id}>
        <div className="row between wrap"><strong>{s.post.headline || s.post.topic}</strong><Badge value={s.status} /></div>
        <p>{dateTime(s.scheduledAt)} · {s.target === "FACEBOOK" ? `Facebook Page ${s.pageId}` : "Feed mô phỏng"}</p>
        {s.permalink && <a href={s.permalink} target="_blank" rel="noopener noreferrer" className="btn secondary small">Xem bài trên Facebook</a>}
        {s.error && <p className="notice error">{s.error}</p>}
        {s.status === "UNCERTAIN" && <p>Kiểm tra Page trước khi xử lý tiếp. Hệ thống giữ nguyên bài và không tự gửi lại.</p>}
        {s.status === "UNCERTAIN" && user?.role === "ADMIN" && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action(`/schedules/${s.id}/reconcile`, "POST", { externalPostId: f.get("externalPostId") }); }}>
          <div className="field"><label htmlFor={`reconcile-${s.id}`}>ID bài đã có trên Facebook (PageID_PostID)</label><input id={`reconcile-${s.id}`} name="externalPostId" required pattern="[0-9]+_[0-9]+" maxLength={100} /></div>
          <button disabled={busy} className="btn secondary small">Kiểm tra và xác nhận bài đã đăng</button>
        </form>}
        {["PENDING", "FAILED"].includes(s.status) && <button disabled={busy} className="btn secondary small" onClick={() => action(`/schedules/${s.id}`, "DELETE")}>Hủy lịch</button>}
      </article>)}
    </section>
  </>;
}
