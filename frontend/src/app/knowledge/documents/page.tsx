"use client";
import { useState } from "react";
import { send, errorMessage, useResource } from "@/lib/api";
import { PageTitle, Notice, Empty, dateTime } from "@/components/ui";

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
  sourceFile: SourceFile;
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

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<UploadRecord | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    setResult(null);
    if (!file) {
      setError("Hãy chọn tệp cần tải lên.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      setError("Chỉ chấp nhận tệp .pdf, .docx và .txt.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Tệp vượt quá 5MB. Hãy chọn tệp nhỏ hơn.");
      return;
    }
    setBusy(true);
    try {
      const record = await uploadDocument(file);
      setResult(record);
      setNotice("Đã tải lên tài liệu.");
      onUploaded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const drafts = result?.versions.filter((v) => v.status === "DRAFT").length ?? 0;
  const chunks = result?.versions[0]?.chunkCount ?? 0;
  return (
    <section className="card" aria-busy={busy}>
      <h2>Tải lên tài liệu</h2>
      <p className="hint">
        Chấp nhận tệp .pdf, .docx, .txt tối đa 5MB. Tài liệu được trích xuất
        thành các đoạn và chỉ dùng làm nguồn khi nội dung được duyệt.
      </p>
      <Notice error={error} message={notice} />
      <form onSubmit={submit}>
        <fieldset
          disabled={busy}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="field">
            <label htmlFor="doc-file">Tệp tài liệu</label>
            <input
              id="doc-file"
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="hint">
              {file
                ? `Đã chọn: ${file.name} · ${formatSize(file.size)}`
                : "Chưa chọn tệp nào."}
            </p>
          </div>
          <button className="btn" type="submit">
            {busy ? "Đang tải lên…" : "Tải lên"}
          </button>
        </fieldset>
      </form>
      {result && (
        <div className="mt">
          <h3>Trạng thái trích xuất</h3>
          {result.sourceFile.extractionStatus === "OK" ? (
            <p>
              <span className="badge good">OK</span>{" "}
              Trích xuất thành công: {drafts} bản nháp · {chunks} đoạn.
            </p>
          ) : (
            <p>
              <span className="badge danger">FAILED</span>{" "}
              Trích xuất thất bại:{" "}
              {result.sourceFile.extractionError ||
                "Không rõ nguyên nhân. Hãy kiểm tra lại tệp."}
            </p>
          )}
        </div>
      )}
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
  return (
    <section className="card">
      <h2>Danh sách tài liệu</h2>
      <Notice error={loadError} />
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
              </tr>
            </thead>
            <tbody>
              {data.map((rec) => (
                <tr key={rec.documentId}>
                  <td>
                    {rec.sourceFile.filename}
                    {rec.archived && (
                      <span className="muted"> · Đã lưu trữ</span>
                    )}
                  </td>
                  <td>{rec.sourceFile.mimeType}</td>
                  <td>{formatSize(rec.sourceFile.sizeBytes)}</td>
                  <td>
                    {rec.sourceFile.extractionStatus === "OK" ? (
                      <span className="badge good">OK</span>
                    ) : (
                      <span
                        className="badge danger"
                        title={
                          rec.sourceFile.extractionError ||
                          "Không rõ nguyên nhân lỗi trích xuất."
                        }
                      >
                        FAILED
                      </span>
                    )}
                    {rec.sourceFile.extractionStatus === "FAILED" && (
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
