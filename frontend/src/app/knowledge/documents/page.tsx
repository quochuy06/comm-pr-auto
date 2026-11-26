"use client";
import { useState } from "react";
import { send, errorMessage, useResource } from "@/lib/api";
import { PageTitle, Notice, Empty, dateTime } from "@/components/ui";
import { useAuth } from "@/components/shell";

type SourceFile = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  filePath: string;
  extractionStatus: "OK" | "FAILED";
  extractionError: string | null;
};
type UploadVersion = {
  id: string;
  version: number;
  status: string;
  extractionStatus: string;
  chunkCount: number;
  createdAt: string;
};
type UploadRecord = {
  documentId: string;
  pageId: string;
  title: string;
  archived: boolean;
  sourceFile: SourceFile | null;
  versions: UploadVersion[];
};
type SourceRef = {
  documentId: string;
  versionId: string;
  version: number;
  title: string;
  locator: string;
  excerpt: string;
};
type AnswerContract = {
  status: "SUFFICIENT" | "INSUFFICIENT" | "CONFLICT";
  answer: string | null;
  sources: SourceRef[];
  conflicts: { a: SourceRef; b: SourceRef }[];
  brandVoice: { tone: string; style: string; forbidden: string[] } | null;
};

const MAX_FILES = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = [".pdf", ".docx", ".txt"];
const answerStatus: Record<
  AnswerContract["status"],
  { text: string; cls: string }
> = {
  SUFFICIENT: { text: "Đủ nguồn", cls: "badge good" },
  INSUFFICIENT: { text: "Thiếu nguồn — không trả lời bịa", cls: "badge warn" },
  CONFLICT: { text: "Mâu thuẫn — chuyển duyệt", cls: "badge danger" },
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024)
    return `${(bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} KB`;
  return `${bytes} B`;
}

async function uploadDocument(file: File): Promise<UploadRecord> {
  const response = await fetch(
    `/api/documents/upload?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      body: file,
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
    },
  );
  const body = await response
    .json()
    .catch(() => ({ message: "Máy chủ không phản hồi đúng định dạng." }));
  if (!response.ok) throw new Error(body.message || "Không thể tải tệp lên.");
  return body.data as UploadRecord;
}

type UploadResult = {
  filename: string;
  summary: string;
  ok: boolean;
};

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<UploadResult[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setResults([]);
    if (!files.length || files.length > MAX_FILES) {
      setError(`Hãy chọn từ 1 đến ${MAX_FILES} tệp.`);
      return;
    }

    const form = e.currentTarget;
    setBusy(true);
    try {
      for (const file of files) {
        let result: UploadResult;
        try {
          if (!ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
            throw new Error("Chỉ chấp nhận tệp .pdf, .docx và .txt.");
          }
          if (file.size === 0 || file.size > MAX_BYTES) {
            throw new Error("Tệp phải có nội dung và có dung lượng tối đa 5 MB.");
          }
          const record = await uploadDocument(file);
          const ok = record.sourceFile?.extractionStatus === "OK";
          result = {
            filename: file.name,
            ok,
            summary: ok
              ? `Đã trích xuất ${record.versions[0]?.chunkCount ?? 0} đoạn.`
              : record.sourceFile?.extractionError || "Không trích xuất được nội dung.",
          };
        } catch (err) {
          result = { filename: file.name, ok: false, summary: errorMessage(err) };
        }
        setResults((previous) => [...previous, result]);
      }
      form.reset();
      setFiles([]);
      onUploaded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-busy={busy}>
      <h2>Tải lên tài liệu</h2>
      <p className="hint">
        Mỗi lượt tối đa {MAX_FILES} tệp PDF, DOCX hoặc TXT, tối đa 5 MB mỗi tệp.
        Nội dung cần được duyệt trước khi dùng làm nguồn.
      </p>
      <Notice error={error} />
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="doc-file">Tệp tài liệu</label>
          <input
            id="doc-file"
            type="file"
            accept=".pdf,.docx,.txt"
            multiple
            disabled={busy}
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              setError(selected.length > MAX_FILES ? `Chỉ chọn tối đa ${MAX_FILES} tệp mỗi lượt.` : "");
              setFiles(selected);
            }}
          />
        </div>
        <button className="btn" type="submit" disabled={busy || !files.length || files.length > MAX_FILES}>
          {busy ? `Đang xử lý ${results.length}/${files.length} tệp…` : "Tải lên"}
        </button>
      </form>
      <div aria-live="polite">
        {results.length > 0 && (
          <div className="mt">
            <h3>Kết quả từng tệp</h3>
            <ul>
              {results.map((result, index) => (
                <li key={index}>
                  <strong>{result.filename}</strong>{" "}
                  <span className={`badge ${result.ok ? "good" : "danger"}`}>
                    {result.ok ? "Đã trích xuất" : "Lỗi"}
                  </span>
                  <p className="hint">{result.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function DocumentsSection({
  data,
  loadError,
  loading,
  refresh,
}: {
  data: UploadRecord[] | null;
  loadError: string;
  loading: boolean;
  refresh: () => void;
}) {
  const canDelete = useAuth()?.role === "ADMIN";
  const [deleteTarget, setDeleteTarget] = useState<UploadRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  async function confirmDelete() {
    if (!canDelete || !deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await send(`/documents/${deleteTarget.documentId}`, "DELETE");
      setDeleteMessage(`Đã xóa tài liệu ${deleteTarget.title}.`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="card">
      <h2>Danh sách tài liệu</h2>
      <Notice error={loadError || deleteError} message={deleteMessage} />
      {deleteTarget && canDelete && (
        <div className="card mb" role="group" aria-label="Xác nhận xóa tài liệu">
          <p>Xóa <strong>{deleteTarget.title}</strong> khỏi kho tri thức và ngừng dùng làm nguồn?</p>
          <div className="row wrap mt">
            <button className="btn danger small" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "Đang xóa…" : "Xác nhận xóa"}
            </button>
            <button className="btn secondary small" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>
              Hủy
            </button>
          </div>
        </div>
      )}
      <div className="row wrap">
        <button className="btn secondary" type="button" onClick={refresh}>
          Tải lại
        </button>
      </div>
      {loading ? (
        <p>Đang tải danh sách tài liệu…</p>
      ) : !data?.length ? (
        <Empty>Chưa có tài liệu nào. Hãy tải lên tài liệu đầu tiên.</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tên file</th>
                <th>Loại MIME</th>
                <th>Dung lượng</th>
                <th>Trạng thái trích xuất</th>
                <th>Số phiên bản / đoạn</th>
                <th>Ngày tải</th>
                {canDelete && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((rec) => (
                <tr key={rec.documentId}>
                  <td>
                    {rec.sourceFile?.filename ?? rec.title}
                    {rec.archived && (
                      <span className="muted"> · Đã lưu trữ</span>
                    )}
                  </td>
                  <td>{rec.sourceFile?.mimeType ?? "—"}</td>
                  <td>{rec.sourceFile ? formatSize(rec.sourceFile.sizeBytes) : "—"}</td>
                  <td>
                    {rec.sourceFile?.extractionStatus === "OK" ? (
                      <span className="badge good">OK</span>
                    ) : rec.sourceFile ? (
                      <span
                        className="badge danger"
                        title={
                          rec.sourceFile.extractionError ||
                          "Không rõ nguyên nhân lỗi trích xuất."
                        }
                      >
                        FAILED
                      </span>
                    ) : "—"}
                    {rec.sourceFile?.extractionStatus === "FAILED" && (
                      <p className="hint">
                        {rec.sourceFile.extractionError ||
                          "Không rõ nguyên nhân lỗi trích xuất."}
                      </p>
                    )}
                  </td>
                  <td>
                    {rec.versions.length} phiên bản ·{" "}
                    {rec.versions[0]?.chunkCount ?? 0} đoạn
                  </td>
                  <td>
                    {rec.versions[0]?.createdAt
                      ? dateTime(rec.versions[0].createdAt)
                      : "—"}
                  </td>
                  {canDelete && (
                    <td>
                      <button
                        type="button"
                        className="btn danger small"
                        aria-label={`Xóa ${rec.title}`}
                        disabled={Boolean(deleteTarget)}
                        onClick={() => { setDeleteError(""); setDeleteMessage(""); setDeleteTarget(rec); }}
                      >
                        Xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <ul>
      {sources.map((src) => (
        <li key={`${src.versionId}-${src.locator}`}>
          <strong>{src.title}</strong>
          <p className="muted">
            v{src.version} · {src.locator}
          </p>
          <p className="prose-content">{src.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}

function QaSection({ documents }: { documents: UploadRecord[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnswerContract | null>(null);

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const question = String(f.get("question") || "").trim();
    if (!question) {
      setError("Hãy nhập câu hỏi cần thử.");
      return;
    }
    const pageId = String(f.get("pageId") || "").trim();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await send<AnswerContract>("/retrieval/answer", "POST", {
          question,
          ...(pageId ? { pageId } : {}),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-busy={busy}>
      <h2>Thử hỏi đáp</h2>
      <p className="notice info">
        Kết quả truy xuất từ nguồn ĐÃ DUYỆT; hệ thống không tự bịa dữ kiện.
      </p>
      <form onSubmit={ask}>
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="field">
            <label htmlFor="qa-question">Câu hỏi</label>
            <textarea
              id="qa-question"
              name="question"
              rows={3}
              required
              maxLength={1000}
              placeholder="Ví dụ: Chính sách đổi trả của cửa hàng như thế nào?"
            />
          </div>
          <div className="field">
            <label htmlFor="qa-page">Phạm vi truy xuất (không bắt buộc)</label>
            <select id="qa-page" name="pageId" defaultValue="">
              <option value="">Toàn bộ tài liệu đã duyệt</option>
              {documents.map((rec) => (
                <option key={rec.documentId} value={rec.pageId}>
                  {rec.title}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">
            {busy ? "Đang truy vấn…" : "Hỏi"}
          </button>
        </fieldset>
      </form>
      <Notice error={error} />
      {result && (
        <div className="mt">
          <p>
            <strong>Kết quả:</strong>{" "}
            <span className={answerStatus[result.status].cls}>
              {answerStatus[result.status].text}
            </span>
          </p>
          {result.answer ? (
            <p className="prose-content">{result.answer}</p>
          ) : (
            <p className="hint">
              {result.status === "INSUFFICIENT"
                ? "Thiếu nguồn đã duyệt khớp với câu hỏi — hệ thống không trả lời bịa."
                : "Chưa có câu trả lời được ghi nhận."}
            </p>
          )}
          {result.status === "CONFLICT" && (
            <div className="notice error">
              <strong>Cảnh báo mâu thuẫn:</strong> các nguồn cùng độ khớp nhưng
              khác tài liệu — cần người duyệt chọn nguồn đúng.
              {result.conflicts.length > 0 && (
                <ul>
                  {result.conflicts.map((pair, index) => (
                    <li key={index}>
                      “{pair.a.title}” ({pair.a.locator}) ↔ “{pair.b.title}” (
                      {pair.b.locator})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <h3>Nguồn truy xuất</h3>
          {!result.sources.length ? (
            <Empty>Không có nguồn nào được truy xuất cho câu hỏi này.</Empty>
          ) : (
            <SourceList sources={result.sources} />
          )}
        </div>
      )}
    </section>
  );
}

export default function KnowledgeDocumentsPage() {
  const {
    data: documents,
    error: loadError,
    loading,
    refresh,
  } = useResource<UploadRecord[]>("/documents");
  return (
    <>
      <PageTitle
        title="Tài liệu & hỏi đáp"
        description="Tải lên tài liệu, theo dõi trạng thái trích xuất và thử hỏi đáp trên nguồn đã duyệt."
      />
      <div className="stack">
        <UploadSection onUploaded={refresh} />
        <DocumentsSection
          data={documents}
          loadError={loadError}
          loading={loading}
          refresh={refresh}
        />
        <QaSection documents={documents ?? []} />
      </div>
    </>
  );
}
