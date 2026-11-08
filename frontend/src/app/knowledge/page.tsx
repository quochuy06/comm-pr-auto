"use client";
import { useState } from "react";
import { api, send, errorMessage, useResource } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Empty } from "@/components/ui";
type Body = { title: string; question: string; answer: string };
type Version = { id: string; version: number; status: string; body: Body; createdBy: string; reviewedBy: string | null; reviewedAt: string | null };
type Document = { id: string; title: string; activeVersionId: string | null; archivedAt: string | null; versions: Version[] };
const blank: Body = { title: "", question: "", answer: "" };
const labels: Record<string,string> = { DRAFT:"Bản nháp", PENDING_APPROVAL:"Chờ duyệt", APPROVED:"Đã duyệt", REJECTED:"Từ chối" };
export default function KnowledgePage() {
  const user=useAuth(), writable=user?.role === "ADMIN" || user?.role === "EDITOR", reviewer=user?.role === "ADMIN" || user?.role === "REVIEWER";
  const {data,error:loadError,loading,refresh}=useResource<{items:Document[];nextCursor:string|null}>("/knowledge/documents?limit=100");
  const [selected,setSelected]=useState<Document|null>(null), [body,setBody]=useState<Body>(blank);
  const [busy,setBusy]=useState(false), [error,setError]=useState(""), [notice,setNotice]=useState("");
  const latest=selected?.versions[0];
  async function open(id:string) {
    setBusy(true);setError("");setNotice("");
    try {const doc=await api<Document>(`/knowledge/documents/${id}`);setSelected(doc);setBody(doc.versions[0]?.body || blank);}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  async function act(action:string,extra:object={}) {
    if(busy || !selected || !latest)return;
    setBusy(true);setError("");setNotice("");
    try {setSelected(await send<Document>(`/knowledge/documents/${selected.id}/${action}`,"POST",{expectedVersion:latest.version,...extra}));refresh();setNotice("Đã lưu thay đổi.");}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <>
    <PageTitle title="Tri thức thương hiệu" description="Lưu FAQ, quản lý phiên bản và duyệt nguồn cho thương hiệu." />
    <p className="notice">Chỉ nguồn đang hoạt động đã duyệt mới được tìm kiếm. Upload tài liệu và hỏi đáp sẽ có ở giai đoạn tiếp theo.</p>
    <Notice error={error || loadError}/>{notice && <p role="status" className="notice">{notice}</p>}
    <div className="grid two"><section className="card" aria-busy={loading}>
      <h2>Danh sách FAQ</h2>
      {writable && <button className="btn" disabled={busy} onClick={()=>{setSelected(null);setBody(blank);setError("");setNotice("");}}>Tạo FAQ mới</button>}
      <button className="btn secondary" disabled={busy} onClick={()=>{refresh();if(selected)void open(selected.id);}}>Tải lại</button>
      {loading ? <p>Đang tải…</p> : !data?.items.length ? <Empty>Chưa có FAQ.</Empty> : <ul>{data.items.map(doc=><li key={doc.id}>
        <button className="btn secondary" disabled={busy} onClick={()=>void open(doc.id)}>{doc.title}</button>
        <p className="muted">{doc.archivedAt ? "Đã lưu trữ" : labels[doc.versions[0]?.status] || "Chưa có phiên bản"} · v{doc.versions[0]?.version} · {doc.activeVersionId ? "Có nguồn đang hoạt động" : "Chưa có nguồn hoạt động"}</p>
      </li>)}</ul>}
      {data?.nextCursor && <p className="muted">Đang hiển thị 100 FAQ mới nhất.</p>}
    </section><section className="card" aria-busy={busy}>
      <h2>{selected ? `FAQ · phiên bản ${latest?.version}` : "Tạo FAQ"}</h2>
      {selected?.archivedAt && <p className="notice">Tài liệu đã lưu trữ và không được dùng làm nguồn.</p>}
      <form onSubmit={async event=>{
        event.preventDefault();if(busy)return;if(selected){await act("versions",body);return;}
        setBusy(true);setError("");setNotice("");
        try {setSelected(await send<Document>("/knowledge/documents","POST",{kind:"FAQ",...body}));refresh();setNotice("Đã lưu bản nháp. Hãy gửi duyệt khi nội dung sẵn sàng.");}
        catch(e){setError(errorMessage(e));}finally{setBusy(false);}
      }}><fieldset disabled={busy || !writable || !!selected?.archivedAt} style={{border:0,padding:0,margin:0,minWidth:0}}>
        {([["title","Tiêu đề",160],["question","Câu hỏi",1000],["answer","Câu trả lời",10000]] as const).map(([key,label,max])=><div className="field" key={key}>
          <label htmlFor={`faq-${key}`}>{label}</label><textarea id={`faq-${key}`} name={key} rows={key === "answer" ? 6 : 2} required maxLength={max} value={body[key]} onChange={e=>setBody({...body,[key]:e.target.value})}/>
        </div>)}
        {writable && <button className="btn" type="submit">{busy ? "Đang xử lý…" : selected ? "Lưu thành phiên bản nháp mới" : "Lưu FAQ nháp"}</button>}
      </fieldset></form>
      {selected && !selected.archivedAt && <div className="actions">
        {writable && latest?.status === "DRAFT" && <button className="btn" disabled={busy} onClick={()=>void act("submit")}>Gửi phiên bản đã lưu để duyệt</button>}
        {reviewer && latest?.status === "PENDING_APPROVAL" && <>
          <button className="btn" disabled={busy} onClick={()=>void act("review",{decision:"APPROVE"})}>Duyệt phiên bản đã lưu</button>
          <button className="btn secondary" disabled={busy} onClick={()=>void act("review",{decision:"REJECT"})}>Từ chối</button>
        </>}
        {reviewer && <button className="btn secondary" disabled={busy} onClick={()=>void act("archive")}>Lưu trữ nguồn</button>}
      </div>}
      {selected && <><h3>Lịch sử và nguồn đã lưu</h3><p className="muted">Gửi duyệt/duyệt áp dụng nội dung đã lưu bên dưới. Thay đổi trong form cần lưu thành phiên bản mới trước.</p>
        {selected.versions.map(v=><article key={v.id} className="card"><strong>v{v.version} · {labels[v.status]}{selected.activeVersionId === v.id ? " · Nguồn đang hoạt động" : ""}</strong>
          <h4>{v.body.title}</h4><p className="prose-content">{v.body.question}</p><p className="prose-content">{v.body.answer}</p>
          <small className="muted">Soạn: {v.createdBy}{v.reviewedBy ? ` · Duyệt: ${v.reviewedBy} · ${new Date(v.reviewedAt!).toLocaleString("vi-VN")}` : ""}</small>
        </article>)}
      </>}
    </section></div>
  </>;
}
