"use client";
import { useState } from "react";
import { useResource, send, errorMessage } from "@/lib/api";
import type { Alert, Job } from "@/lib/types";
import { PageTitle, Notice, Badge, Empty, dateTime } from "@/components/ui";
import { useAuth } from "@/components/shell";
function AlertCard({
  alert: a,
  jobs,
  refresh,
}: {
  alert: Alert;
  jobs: Job[];
  refresh: () => void;
}) {
  const user = useAuth();
  const canReview = user?.role === "ADMIN" || user?.role === "REVIEWER";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const job = jobs.find((j) => j.entityId === a.id);
  const processing = job && ["QUEUED", "RUNNING"].includes(job.status);
  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await send(
        `/alerts/${a.id}/${action}`,
        action === "retry" ? "POST" : "PATCH",
        body,
      );
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="card">
      <div className="row between wrap">
        <div>
          <h2>{a.post?.topic}</h2>
          <small className="muted">{dateTime(a.createdAt)}</small>
        </div>
        <Badge value={a.status} />
      </div>
      <Notice error={error} />
      <p className="notice error mt">{a.trigger}</p>
      {job && (
        <div className="row wrap mb">
          <span>Workflow:</span>
          <Badge value={job.status} />
          {job.error && <span className="muted">{job.error}</span>}
        </div>
      )}
      <div className="grid two">
        <section>
          <h3>Bằng chứng kích hoạt</h3>
          <p className="hint mb">
            Các phản ánh bên dưới chưa được coi là sự thật đã xác minh.
          </p>
          {a.evidence.map((c) => (
            <blockquote className="evidence" key={c.id}>
              <p className="prose-content">{c.text}</p>
              <Badge value={c.sentiment} />
            </blockquote>
          ))}
          {a.summary && (
            <>
              <h3 className="mt">Tóm tắt AI</h3>
              <p className="prose-content">{a.summary}</p>
            </>
          )}
          {a.actions?.length ? (
            <>
              <h3>Hành động đề xuất</h3>
              <ol className="list-decimal pl-5">
                {a.actions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
        <section>
          <h3>Thông cáo phản hồi</h3>
          {a.statement ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("approve", {
                  statement: new FormData(e.currentTarget).get("statement"),
                });
              }}
            >
              <label htmlFor={`statement-${a.id}`} className="hint mb">
                Kiểm tra dữ kiện và hiệu đính trước khi đăng.
              </label>
              <textarea
                id={`statement-${a.id}`}
                name="statement"
                defaultValue={a.statement}
                rows={12}
                maxLength={12000}
                required
                disabled={!canReview || busy || a.status !== "PENDING_APPROVAL"}
              />
              <p className="hint mt">
                Kiểm tra AI: {a.reviewReason || "Chưa có"}
              </p>
              {a.status === "PENDING_APPROVAL" && canReview && (
                <div className="row wrap mt">
                  <button className="btn" disabled={busy}>
                    Duyệt và đăng phản hồi trên feed
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => void act("reject")}
                  >
                    Từ chối
                  </button>
                </div>
              )}
            </form>
          ) : (
            <Empty>
              Đang chờ bản nháp từ workflow khủng hoảng. Nếu có lỗi, hãy thử
              lại.
            </Empty>
          )}
          {canReview && (
            <div className="row wrap mt">
              {["OPEN", "PENDING_APPROVAL", "REJECTED"].includes(a.status) && (
                <button
                  className="btn secondary"
                  disabled={busy || !!processing}
                  onClick={() => void act("retry")}
                >
                  Soạn lại thông cáo
                </button>
              )}
              {a.status !== "RESOLVED" && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void act("resolve")}
                >
                  Đánh dấu đã xử lý
                </button>
              )}
            </div>
          )}
          <p className="hint mt">
            Thông cáo khủng hoảng không bao giờ được AI tự đăng.
          </p>
        </section>
      </div>
    </article>
  );
}
export default function AlertsPage() {
  const { data, error, loading, refresh } = useResource<Alert[]>(
    "/alerts",
    5000,
  );
  const jobs = useResource<Job[]>("/jobs", 5000);
  const [showResolved, setShowResolved] = useState(false);
  const alerts =
    data?.filter((a) => showResolved || a.status !== "RESOLVED") || [];
  return (
    <>
      <PageTitle
        title="Cảnh báo rủi ro"
        description="Theo dõi tín hiệu nghiêm trọng, xác minh tình huống và duyệt thông cáo phản hồi."
      />
      <Notice error={error || jobs.error} />
      <label className="check-row mb">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(e) => setShowResolved(e.target.checked)}
        />
        Hiển thị cả cảnh báo đã xử lý
      </label>
      <div className="stack">
        {alerts.length ? (
          alerts.map((a) => (
            <AlertCard
              key={a.id + a.status}
              alert={a}
              jobs={jobs.data || []}
              refresh={() => {
                refresh();
                jobs.refresh();
              }}
            />
          ))
        ) : (
          <Empty>
            {loading ? "Đang tải cảnh báo…" : "Chưa có cảnh báo cần xử lý."}
          </Empty>
        )}
      </div>
    </>
  );
}
