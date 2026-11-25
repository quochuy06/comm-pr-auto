"use client";
import { useState } from "react";
import { useResource, send, errorMessage } from "@/lib/api";
import type { ReplyDecision, ReplySourceSnapshot } from "@/lib/types";
import {
  PageTitle,
  Notice,
  Badge,
  Empty,
  dateTime,
} from "@/components/ui";
import { useAuth } from "@/components/shell";
function Sources({ snapshot }: { snapshot: ReplySourceSnapshot | null }) {
  const sources = snapshot?.sources || [];
  if (!sources.length)
    return <span className="muted">Không có nguồn tri thức</span>;
  return (
    <span className="row wrap compact">
      {sources.map((s) => (
        <span className="badge" key={`${s.id}-v${s.version}`}>
          {s.id} · v{s.version}
        </span>
      ))}
    </span>
  );
}
function DecisionCard({
  decision: d,
  refresh,
  canReview,
}: {
  decision: ReplyDecision;
  refresh: () => void;
  canReview: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const actionable = d.status === "PENDING";
  async function act(
    path: string,
    method: string,
    body: unknown = {},
    okMessage: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await send(path, method, body);
      setMessage(okMessage);
      setEditing(false);
      setRejecting(false);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="card">
      <div className="row between wrap mb">
        <div className="row wrap">
          <Badge value={d.channel} />
          <Badge value={d.mode} />
          <Badge value={d.decision} />
          <Badge value={d.status} />
        </div>
        <small className="muted">{dateTime(d.createdAt)}</small>
      </div>
      <p className="hint">
        Luật: {d.ruleId ? d.ruleId : "Không khớp luật"} · Nguồn:{" "}
        <Sources snapshot={d.sourceSnapshot} />
      </p>
      <p className="hint">
        Lý do chuyển duyệt: {d.reason || "—"}
      </p>
      <div className="grid two">
        <div>
          <strong>Bản gốc (khách gửi)</strong>
          <p className="prose-content mt">{d.inboundText}</p>
        </div>
        <div>
          <strong>Reply đề xuất</strong>
          {editing ? (
            <form
              className="mt"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(
                  `/reply-decisions/${d.id}`,
                  "PATCH",
                  { replyText: f.get("replyText") },
                  "Đã lưu nội dung reply.",
                );
              }}
            >
              <label htmlFor={`reply-edit-${d.id}`}>Nội dung reply</label>
              <textarea
                id={`reply-edit-${d.id}`}
                name="replyText"
                defaultValue={d.replyText || ""}
                rows={4}
                maxLength={2000}
                required
                disabled={busy}
              />
              <div className="row wrap mt">
                <button className="btn small" disabled={busy}>
                  {busy ? "Đang lưu…" : "Lưu nội dung reply"}
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Hủy
                </button>
              </div>
            </form>
          ) : (
            <p className="prose-content mt">{d.replyText || "—"}</p>
          )}
        </div>
      </div>
      <Notice error={error} message={message} />
      {!editing && !rejecting && (
        <div className="row wrap mt">
          <button
            className="btn secondary small"
            disabled={!canReview || !actionable || busy}
            onClick={() => setEditing(true)}
          >
            Sửa reply
          </button>
          <button
            className="btn small"
            disabled={
              !canReview || !actionable || busy || d.decision === "NEEDS_HUMAN"
            }
            onClick={() =>
              void act(
                `/reply-decisions/${d.id}/approve`,
                "POST",
                {},
                "Đã duyệt quyết định phản hồi.",
              )
            }
          >
            Duyệt
          </button>
          <button
            className="btn danger small"
            disabled={!canReview || !actionable || busy}
            onClick={() => setRejecting(true)}
          >
            Từ chối
          </button>
        </div>
      )}
      {rejecting && (
        <form
          className="mt"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(
              `/reply-decisions/${d.id}/reject`,
              "POST",
              { reason: f.get("reason") },
              "Đã từ chối quyết định phản hồi.",
            );
          }}
        >
          <label htmlFor={`reject-${d.id}`}>Lý do từ chối</label>
          <textarea
            id={`reject-${d.id}`}
            name="reason"
            rows={2}
            maxLength={1000}
            required
            disabled={busy}
          />
          <div className="row wrap mt">
            <button className="btn danger small" disabled={busy}>
              {busy ? "Đang gửi…" : "Xác nhận từ chối"}
            </button>
            <button
              type="button"
              className="btn secondary small"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Hủy
            </button>
          </div>
        </form>
      )}
      {!canReview && (
        <p className="hint mt">
          Chỉ người duyệt hoặc quản trị viên được sửa, duyệt hoặc từ chối quyết
          định phản hồi.
        </p>
      )}
      {canReview && d.decision === "NEEDS_HUMAN" && actionable && (
        <p className="hint mt">
          Ca này được đánh dấu cần người xử lý — không duyệt được; hãy xem lý do
          chuyển duyệt, chỉ sửa hoặc từ chối.
        </p>
      )}
    </article>
  );
}
export default function RepliesPage() {
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const user = useAuth();
  const canReview = user?.role === "ADMIN" || user?.role === "REVIEWER";
  const params = new URLSearchParams();
  if (channel) params.set("channel", channel);
  if (status) params.set("status", status);
  const query = params.toString();
  const { data, error, loading, refresh } = useResource<ReplyDecision[]>(
    `/reply-decisions${query ? `?${query}` : ""}`,
    8000,
  );
  const decisions = data || [];
  return (
    <>
      <PageTitle
        title="Hàng duyệt trả lời"
        description="Phản hồi khách trên Comment và Messenger: bản gốc, reply đề xuất, nguồn tri thức, luật và lý do chuyển duyệt. Gửi thật tới khách thuộc PHUC-WF06 — chưa triển khai."
      />
      <Notice error={error} />
      <div className="card mb">
        <div className="row wrap">
          <div className="field">
            <label htmlFor="filter-channel">Kênh</label>
            <select
              id="filter-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">Tất cả kênh</option>
              <option value="COMMENT">Bình luận</option>
              <option value="MESSENGER">Messenger</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-status">Trạng thái duyệt</label>
            <select
              id="filter-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="PENDING">Chờ xử lý</option>
              <option value="APPROVED">Đã duyệt</option>
              <option value="REJECTED">Từ chối</option>
            </select>
          </div>
        </div>
      </div>
      <div className="tabs">
        <button
          className={tab === "queue" ? "active" : ""}
          onClick={() => setTab("queue")}
        >
          Chi tiết & thao tác
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          Lịch sử & đối soát
        </button>
      </div>
      {tab === "queue" ? (
        <div className="stack">
          {decisions.length ? (
            decisions.map((d) => (
              <DecisionCard
                key={d.id + d.status + (d.replyText || "")}
                decision={d}
                refresh={refresh}
                canReview={canReview}
              />
            ))
          ) : (
            <Empty>
              {loading
                ? "Đang tải hàng duyệt trả lời…"
                : "Không có quyết định phản hồi nào khớp bộ lọc."}
            </Empty>
          )}
        </div>
      ) : (
        <div className="card">
          <p className="hint mb">
            Đối soát gửi: trạng thái gửi tới khách chưa được theo dõi — luồng gửi
            thật (PHUC-WF06) chưa triển khai, mọi quyết định hiển thị CHƯA GỬI.
          </p>
          {decisions.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Thời điểm tạo</th>
                    <th>Kênh</th>
                    <th>Bản gốc</th>
                    <th>Trạng thái</th>
                    <th>Người duyệt</th>
                    <th>Thời điểm duyệt</th>
                    <th>Liên kết inbound</th>
                    <th>Đối soát gửi</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td>{dateTime(d.createdAt)}</td>
                      <td>
                        <Badge value={d.channel} />
                      </td>
                      <td>
                        {d.inboundText.slice(0, 100)}
                        {d.inboundText.length > 100 ? "…" : ""}
                      </td>
                      <td>
                        <Badge value={d.status} />
                      </td>
                      <td>{d.reviewedBy || "—"}</td>
                      <td>
                        {d.reviewedAt ? dateTime(d.reviewedAt) : "—"}
                      </td>
                      <td>{d.inboundId || "—"}</td>
                      <td>
                        <span className="badge warn">CHƯA GỬI</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              {loading
                ? "Đang tải lịch sử…"
                : "Chưa có lịch sử quyết định phản hồi."}
            </Empty>
          )}
        </div>
      )}
    </>
  );
}
