"use client";
import { useState } from "react";
import { send, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Empty } from "@/components/ui";

type FaqPreview = {
  status: "DRAFT";
  persisted: false;
  eligibleForRetrieval: false;
  draft: { title: string; question: string; answer: string };
  warnings: string[];
};

export default function KnowledgePage() {
  const user = useAuth();
  const writable = user?.role === "ADMIN" || user?.role === "EDITOR";
  const [preview, setPreview] = useState<FaqPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <PageTitle title="Tri thức thương hiệu" description="Soạn câu hỏi thường gặp và kiểm tra bản nháp trước khi đưa vào kho tri thức." />
      <p className="notice">Hiện hỗ trợ kiểm tra bản nháp FAQ. Nội dung chưa được lưu và sẽ mất khi rời trang; AI chưa sử dụng bản nháp để trả lời khách. Lưu, duyệt và nhập tài liệu sẽ được bổ sung sau.</p>
      <Notice error={error} />
      {!writable ? (
        <Empty>Tài khoản của bạn chỉ xem. Biên tập viên hoặc quản trị viên có thể soạn và kiểm tra FAQ.</Empty>
      ) : (
        <div className="grid two">
          <section className="card">
            <h2>Soạn FAQ</h2>
            <form onChange={() => { setPreview(null); setError(""); }} onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const fields = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              setPreview(null);
              try {
                const result = await send<FaqPreview>("/knowledge/faq/preview", "POST", {
                  title: fields.get("title"), question: fields.get("question"), answer: fields.get("answer"),
                });
                setPreview(result);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}>
              <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="field">
                  <label htmlFor="faq-title">Tiêu đề</label>
                  <input id="faq-title" name="title" required maxLength={160} />
                </div>
                <div className="field">
                  <label htmlFor="faq-question">Câu hỏi</label>
                  <textarea id="faq-question" name="question" rows={3} required maxLength={1000} />
                </div>
                <div className="field">
                  <label htmlFor="faq-answer">Câu trả lời dự kiến</label>
                  <textarea id="faq-answer" name="answer" rows={8} required maxLength={10000} aria-describedby="faq-hint" />
                  <small id="faq-hint" className="muted">Chỉ nhập thông tin thương hiệu đã xác nhận. Kiểm tra định dạng không xác minh tính đúng sai.</small>
                </div>
                <button className="btn" type="submit">{busy ? "Đang kiểm tra…" : "Kiểm tra bản nháp"}</button>
              </fieldset>
            </form>
          </section>
          <section className="card" aria-live="polite" aria-busy={busy}>
            <h2>Xem trước</h2>
            {busy ? <p>Đang kiểm tra bản nháp…</p> : preview ? (
              <>
                <span className="badge">Bản nháp · Chưa lưu</span>
                <h3>{preview.draft.title}</h3>
                <p className="prose-content"><strong>{preview.draft.question}</strong></p>
                <p className="prose-content">{preview.draft.answer}</p>
                {preview.warnings.map((warning) => <p className="muted" key={warning}>{warning}</p>)}
              </>
            ) : <Empty>Nhập FAQ rồi bấm “Kiểm tra bản nháp” để xem kết quả.</Empty>}
          </section>
        </div>
      )}
    </>
  );
}
