"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource, send, errorMessage } from "@/lib/api";
import type { PrConfig, PrContent, PrOutbox } from "@/lib/types";
import { PageTitle, Notice, Badge, Empty, dateTime } from "@/components/ui";
import { useAuth } from "@/components/shell";
function PrConfigCard() {
  const { data: config, error, refresh } = useResource<PrConfig>("/pr/config");
  const user = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <section className="card">
      <h2>Chế độ PR của Page</h2>
      {config ? (
        <div className="row wrap">
          <span>Chế độ hiện tại:</span>
          <Badge value={config.mode} />
          <span className="muted">
            Phiên bản cấu hình: {config.version ?? "—"}
          </span>
        </div>
      ) : (
        <Empty>{error ? "Không tải được cấu hình PR." : "Đang tải…"}</Empty>
      )}
      <Notice error={actionError || error} message={message} />
      {isAdmin && config ? (
        <form
          className="mt"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await send("/pr/config", "PUT", {
                mode: f.get("mode"),
                version: config.version,
              });
              setMessage("Đã lưu chế độ PR.");
              refresh();
            } catch (err) {
              setError(errorMessage(err));
              refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="pr-mode">Đổi chế độ PR</label>
            <select id="pr-mode" name="mode" defaultValue={config.mode}>
              <option value="OFF">Tắt</option>
              <option value="SEMI_AUTO">Bán tự động</option>
              <option value="AUTO">Tự động</option>
            </select>
          </div>
          <button className="btn" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu chế độ PR"}
          </button>
          <p className="hint mt">
            Lưu gửi kèm phiên bản cấu hình hiện tại; nếu người khác vừa thay đổi,
            máy chủ từ chối (409) và trang tải lại phiên bản mới.
          </p>
        </form>
      ) : (
        <p className="hint mt">
          Chỉ quản trị viên được đổi chế độ PR.
        </p>
      )}
    </section>
  );
}
function PrContentCard() {
  const {
    data: contents,
    error,
    loading,
    refresh,
  } = useResource<PrContent[]>("/pr/content", 8000);
  const user = useAuth();
  const canCreate = user?.role === "ADMIN" || user?.role === "EDITOR";
  const canApprove = user?.role === "ADMIN" || user?.role === "REVIEWER";
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const [message, setMessage] = useState("");
  async function act(path: string, body: unknown, okMessage: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await send(path, "POST", body);
      setMessage(okMessage);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Nội dung PR của Page</h2>
      <p className="hint mb">
        Bình luận PR của Page dưới bài do hệ thống đăng — không phải trả lời
        khách hàng.
      </p>
      <Notice error={actionError || error} message={message} />
      {canCreate ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(
              "/pr/content",
              { text: f.get("text") },
              "Đã tạo nội dung PR (bản nháp).",
            );
          }}
        >
          <label htmlFor="pr-text">Nội dung PR mới</label>
          <textarea
            id="pr-text"
            name="text"
            rows={3}
            maxLength={2000}
            required
            disabled={busy}
          />
          <button className="btn mt" disabled={busy}>
            {busy ? "Đang gửi…" : "Tạo nội dung PR"}
          </button>
        </form>
      ) : (
        <p className="hint">
          Chỉ quản trị viên hoặc biên tập viên được tạo nội dung PR.
        </p>
      )}
      <div className="stack mt">
        {contents?.length ? (
          contents.map((c) => (
            <article className="comment" key={c.id}>
              <div className="row between wrap">
                <div className="row wrap">
                  <Badge value={c.status} />
                  <span className="muted compact">
                    Phiên bản nội dung: {c.version ?? "—"}
                  </span>
                </div>
                <small className="muted">{dateTime(c.createdAt)}</small>
              </div>
              <p className="prose-content mt">{c.text || "—"}</p>
              <p className="hint">
                Người tạo: {c.createdBy || "—"} · Người duyệt:{" "}
                {c.reviewedBy || "—"}
              </p>
              {c.status === "DRAFT" && (
                <button
                  className="btn small"
                  disabled={!canApprove || busy}
                  onClick={() =>
                    void act(
                      `/pr/content/${c.id}/approve`,
                      {},
                      "Đã duyệt nội dung PR.",
                    )
                  }
                >
                  Duyệt nội dung
                </button>
              )}
            </article>
          ))
        ) : (
          <Empty>
            {loading ? "Đang tải…" : "Chưa có nội dung PR nào."}
          </Empty>
        )}
      </div>
    </section>
  );
}
function PrOutboxCard() {
  const {
    data: outbox,
    error,
    loading,
  } = useResource<PrOutbox[]>("/pr/outbox", 8000);
  return (
    <section className="card">
      <h2>Hàng đợi gửi PR (outbox)</h2>
      <p className="hint mb">
        Trạng thái hiển thị đúng dữ liệu lưu trữ trong hàng đợi. Luồng gửi thật
        (PHUC-WF04/HUY-WF04) chưa triển khai — không có thao tác gửi tại đây và
        trạng thái chỉ thay đổi khi có hệ thống gửi thật.
      </p>
      <Notice error={error} />
      {outbox?.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Thời điểm tạo</th>
                <th>Publication</th>
                <th>Bài đăng</th>
                <th>Nội dung PR tại thời điểm tạo</th>
                <th>Trạng thái</th>
                <th>externalId</th>
                <th>Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {outbox.map((o) => (
                <tr key={o.id}>
                  <td>{dateTime(o.createdAt)}</td>
                  <td>{o.publicationKey || "—"}</td>
                  <td>
                    {o.postId || "—"}
                    {o.scheduleId ? (
                      <>
                        <br />
                        <small className="muted">
                          lịch: {o.scheduleId}
                        </small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {o.contentSnapshot?.text || "—"}
                    {o.contentId ? (
                      <>
                        <br />
                        <small className="muted">
                          nội dung: {o.contentId} · v
                          {o.contentSnapshot?.version ?? "—"}
                        </small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <Badge value={o.status} />
                  </td>
                  <td>{o.externalId || "—"}</td>
                  <td>{o.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          {loading ? "Đang tải…" : "Chưa có bản ghi PR nào trong hàng đợi gửi."}
        </Empty>
      )}
    </section>
  );
}
export default function StudioPrPage() {
  return (
    <>
      <PageTitle
        title="Bình luận PR của Page (nội bộ)"
        description="Nội dung PR của Page đặt dưới bài do hệ thống đăng. KHÔNG phải trả lời khách hàng — phản hồi khách ở Hàng đợi trả lời và Feed & bình luận."
      >
        <Link className="btn secondary" href="/studio">
          Quay lại Studio
        </Link>
      </PageTitle>
      <div className="stack">
        <PrConfigCard />
        <PrContentCard />
        <PrOutboxCard />
      </div>
    </>
  );
}
