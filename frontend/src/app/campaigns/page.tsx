"use client";
import { useState } from "react";
import { useResource, send, errorMessage } from "@/lib/api";
import type { Campaign } from "@/lib/types";
import { PageTitle, Notice, Empty } from "@/components/ui";
import { useAuth } from "@/components/shell";
export default function CampaignsPage() {
  const { data, error, refresh } = useResource<Campaign[]>("/campaigns");
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setError] = useState("");
  const user = useAuth();
  const writable = user?.role !== "REVIEWER";
  return (
    <>
      <PageTitle
        title="Chiến dịch"
        description="Nhóm các bài PR theo mục tiêu và cung cấp ngữ cảnh thống nhất cho AI."
      />
      <Notice error={actionError || error} message={message} />
      <div className="grid two">
        <section className="stack">
          {data?.map((c) => (
            <article className="card" key={c.id}>
              <div className="row between">
                <h2>{c.name}</h2>
                <span className="badge">{c._count?.posts || 0} bài</span>
              </div>
              <p className="muted prose-content">
                {c.description || "Chưa có mô tả."}
              </p>
              {writable && (
                <button
                  className="btn secondary small"
                  onClick={() => setEditing(c)}
                >
                  Chỉnh sửa
                </button>
              )}
            </article>
          ))}
          {data?.length === 0 && (
            <Empty>Chưa có chiến dịch. Hãy tạo chiến dịch đầu tiên.</Empty>
          )}
        </section>
        {writable && (
          <section className="card">
            <h2>{editing ? "Chỉnh sửa chiến dịch" : "Tạo chiến dịch"}</h2>
            <form
              key={editing?.id || "new"}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const form = e.currentTarget;
                setBusy(true);
                setError("");
                try {
                  await send(
                    editing ? `/campaigns/${editing.id}` : "/campaigns",
                    editing ? "PATCH" : "POST",
                    { name: f.get("name"), description: f.get("description") },
                  );
                  setMessage("Đã lưu chiến dịch.");
                  setEditing(null);
                  form.reset();
                  refresh();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="campaign-name">Tên chiến dịch</label>
                <input
                  id="campaign-name"
                  name="name"
                  maxLength={160}
                  required
                  defaultValue={editing?.name}
                />
              </div>
              <div className="field">
                <label htmlFor="campaign-description">
                  Mục tiêu và thông tin đã xác minh
                </label>
                <textarea
                  id="campaign-description"
                  name="description"
                  rows={6}
                  maxLength={3000}
                  defaultValue={editing?.description || ""}
                  placeholder="Sản phẩm, thông điệp, sự kiện và các dữ kiện được phép sử dụng…"
                />
              </div>
              <div className="row">
                <button className="btn" disabled={busy}>
                  {busy ? "Đang lưu…" : "Lưu chiến dịch"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setEditing(null)}
                  >
                    Hủy
                  </button>
                )}
              </div>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
