"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource, send, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Badge, Empty, dateTime } from "@/components/ui";
import type { Campaign, Post } from "@/lib/types";
type Artifact = { id: string; kind: string; status: string; campaign?: Campaign; job?: { error?: string }; createdPosts?: Record<string,string>; input: { period?: { from: string; to: string }; metrics?: Record<string,number|null>; definitions?: string }; result?: { summary?: string; recommendations?: string[]; review?: { reason: string }; variants?: { platform: string; headline: string; content: string }[] } };
const labels: Record<string,string> = {createdPosts:"Bài tạo trong kỳ",publishedPosts:"Bài đăng trong kỳ",rejectedPosts:"Bài tạo trong kỳ hiện bị từ chối",comments:"Bình luận trong kỳ",analyzedComments:"Bình luận đã phân tích",negativeComments:"Bình luận tiêu cực/nghiêm trọng",negativeRate:"Tỷ lệ tiêu cực (%)",alerts:"Cảnh báo trong kỳ"};
export default function InsightsPage() {
  const user=useAuth(), editor=user?.role!=="REVIEWER", reviewer=user?.role!=="EDITOR";
  const campaigns=useResource<Campaign[]>("/campaigns");
  const posts=useResource<Post[]>("/posts");
  const variants=useResource<Artifact[]>("/artifacts?kind=repurpose",5000);
  const reports=useResource<Artifact[]>("/artifacts?kind=report",5000);
  const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  async function action(path:string,method="POST",body={}) {
    setBusy(true);setError("");setMessage("");
    try{await send(path,method,body);variants.refresh();reports.refresh();setMessage("Đã ghi nhận yêu cầu.");}catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  function controls(a:Artifact) {return <div className="row wrap">{reviewer&&a.status==="PENDING_APPROVAL"&&<><button disabled={busy} className="btn small" onClick={()=>action(`/artifacts/${a.id}/approve`,"PATCH")}>Duyệt kết quả</button><button disabled={busy} className="btn secondary small" onClick={()=>action(`/artifacts/${a.id}/reject`,"PATCH")}>Từ chối</button></>}{editor&&a.status==="FAILED"&&<button disabled={busy} className="btn secondary small" onClick={()=>action(`/artifacts/${a.id}/retry`)}>Thử lại</button>}</div>;}
  return <>
    <PageTitle title="Chuyển thể & báo cáo" description="Tạo phiên bản cho từng nền tảng và xem báo cáo từ dữ liệu thực tế của chiến dịch."/>
    <Notice error={error||campaigns.error||posts.error||variants.error||reports.error} message={message}/>
    {editor&&<div className="grid two"><section className="card"><h2>Chuyển thể bài đã duyệt</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action(`/posts/${f.get("postId")}/repurpose`);}}>
      <div className="field"><label htmlFor="repurpose-post">Bài gốc</label><select name="postId" id="repurpose-post" required><option value="">Chọn bài</option>{posts.data?.filter(p=>["APPROVED","PUBLISHED"].includes(p.status)).map(p=><option value={p.id} key={p.id}>{p.headline||p.topic}</option>)}</select></div>
      <p className="muted">Tạo ba bản Facebook, LinkedIn và X. Mỗi bản được duyệt trước khi tạo bài chờ kiểm tra ảnh và xuất bản.</p><button disabled={busy} className="btn">Tạo phiên bản</button>
    </form></section><section className="card"><h2>Báo cáo theo kỳ</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action(`/campaigns/${f.get("campaignId")}/report`,"POST",{from:new Date(String(f.get("from"))).toISOString(),to:new Date(String(f.get("to"))).toISOString()});}}>
      <div className="field"><label htmlFor="report-campaign">Chiến dịch</label><select name="campaignId" id="report-campaign" required><option value="">Chọn chiến dịch</option>{campaigns.data?.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="report-from">Từ thời điểm (bao gồm)</label><input name="from" id="report-from" type="datetime-local" required/></div><div className="field"><label htmlFor="report-to">Đến thời điểm (không bao gồm)</label><input name="to" id="report-to" type="datetime-local" required/></div>
      <p className="muted">Báo cáo tuần trước được tạo tự động vào thứ Hai lúc 08:00, giờ Việt Nam, cho chiến dịch có bài viết.</p><button disabled={busy} className="btn">Tạo báo cáo</button>
    </form></section></div>}
    <section className="stack mt"><h2>Phiên bản đa nền tảng</h2>{!variants.data?.length&&<Empty>Chưa có bản chuyển thể.</Empty>}{variants.data?.map(a=><article className="card" key={a.id}><div className="row between"><h3>{a.campaign?.name||"Chuyển thể bài viết"}</h3><Badge value={a.status}/></div>{a.job?.error&&<p className="notice error">{a.job.error}</p>}{controls(a)}{a.result?.review&&<p className="muted">Kiểm tra: {a.result.review.reason}</p>}{a.result?.variants?.map((v,i)=><div className="comment" key={v.platform}><strong>{v.platform} · {v.headline}</strong><p className="prose-content">{v.content}</p>{a.createdPosts?.[i]?<Link className="btn secondary small" href="/approval">Đã tạo — mở hàng đợi duyệt</Link>:editor&&a.status==="APPROVED"&&<button className="btn secondary small" disabled={busy} onClick={()=>action(`/artifacts/${a.id}/variants/${i}`)}>Tạo bài chờ duyệt</button>}</div>)}</article>)}</section>
    <section className="stack mt"><h2>Báo cáo chiến dịch</h2>{!reports.data?.length&&<Empty>Chưa có báo cáo.</Empty>}{reports.data?.map(a=><article className="card" key={a.id}><div className="row between wrap"><h3>{a.campaign?.name||"Báo cáo"}</h3><Badge value={a.status}/></div>{a.input.period&&<p>{dateTime(a.input.period.from)} → {dateTime(a.input.period.to)}</p>}
      <div className="grid two">{Object.entries(a.input.metrics||{}).map(([k,v])=><div className="comment" key={k}><small>{labels[k]||k}</small><strong className="block">{v??"Chưa đủ dữ liệu"}</strong></div>)}</div>
      <p className="hint">{a.input.definitions}</p>{a.job?.error&&<p className="notice error">{a.job.error}</p>}<h4>Nhận xét AI — cần người duyệt kiểm tra</h4><p className="prose-content">{a.result?.summary||"Đang chờ nhận xét. Số liệu phía trên đã được lưu."}</p>{a.result?.recommendations?.map((r,i)=><p key={i}>{i+1}. {r}</p>)}{controls(a)}<a className="btn secondary small mt" href={`/api/artifacts/${a.id}/csv`}>Tải số liệu CSV</a>
    </article>)}</section>
  </>;
}
