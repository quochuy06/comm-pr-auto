"use client";
import { useState } from "react";
import { useAuth } from "@/components/shell";
import { send, errorMessage } from "@/lib/api";
import { Notice } from "@/components/ui";
import type { ReviewComment } from "@/lib/types";

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
