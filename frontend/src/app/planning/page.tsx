"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource, send, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Badge, Empty, dateTime } from "@/components/ui";
import type { Campaign, Post } from "@/lib/types";
type Idea = { topic: string; targetAudience: string; platform: string; suggestedDate: string; rationale: string };
type Plan = { id: string; status: string; campaign?: Campaign; result?: { summary: string; items: Idea[] }; createdPosts?: Record<string, string>; job?: { error?: string } };
type Schedule = { id: string; status: string; scheduledAt: string; error?: string; post: Post };
export default function PlanningPage() {
  const user = useAuth();
  const editor = user?.role !== "REVIEWER";
  const reviewer = user?.role !== "EDITOR";
  const campaigns = useResource<Campaign[]>("/campaigns");
  const plans = useResource<Plan[]>("/artifacts?kind=planning", 5000);
  const posts = useResource<Post[]>("/posts?status=APPROVED", 5000);
  const schedules = useResource<Schedule[]>("/schedules", 5000);
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
    <PageTitle title="Kế hoạch & lịch đăng" description="Lập ý tưởng theo chiến dịch, duyệt kế hoạch và đặt giờ xuất bản lên feed mô phỏng." />
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
        void action(`/posts/${f.get("postId")}/schedule`, "POST", { scheduledAt: new Date(value).toISOString() });
      }}>
        <div className="field"><label htmlFor="schedule-post">Bài đã duyệt</label><select id="schedule-post" name="postId" required><option value="">Chọn bài</option>{posts.data?.map(p => <option key={p.id} value={p.id}>{p.headline || p.topic}</option>)}</select></div>
        <div className="field"><label htmlFor="schedule-time">Ngày giờ đăng</label><input id="schedule-time" name="scheduledAt" type="datetime-local" required /></div>
        <button className="btn" disabled={busy}>Lưu lịch đăng</button>
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
      {schedules.data?.map(s => <article className="card" key={s.id}><div className="row between wrap"><strong>{s.post.headline || s.post.topic}</strong><Badge value={s.status} /></div><p>{dateTime(s.scheduledAt)} · {s.post.platform}</p>{s.error && <p className="notice error">{s.error}</p>}{["PENDING", "FAILED"].includes(s.status) && <button disabled={busy} className="btn secondary small" onClick={() => action(`/schedules/${s.id}`, "DELETE")}>Hủy lịch</button>}</article>)}
    </section>
  </>;
}
