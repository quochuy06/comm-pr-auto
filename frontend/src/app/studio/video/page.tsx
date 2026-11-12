"use client";
import { useEffect, useState } from "react";
import { api, send, errorMessage } from "@/lib/api";
import type { VideoJob } from "@/lib/types";
import { PageTitle, Notice, Empty, dateTime } from "@/components/ui";
import { useAuth } from "@/components/shell";

const statusLabel: Record<string, string> = {
  PENDING: "Đang sinh",
  SUCCEEDED: "Hoàn tất",
  FAILED: "Thất bại",
};
const verificationLabel: Record<string, string> = {
  FFPROBE: "Đã kiểm tra bằng ffprobe",
  CONTAINER_ONLY: "Chỉ kiểm tra container",
};
function VideoStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === "SUCCEEDED" ? "good" : status === "FAILED" ? "danger" : ""}`}
    >
      {statusLabel[status] || status}
    </span>
  );
}
type DemoFlags = { approved: boolean; scheduled: boolean };
const noDemo: DemoFlags = { approved: false, scheduled: false };

function JobDetail({
  job,
  demo,
  onToggleDemo,
}: {
  job: VideoJob;
  demo: DemoFlags;
  onToggleDemo: (kind: keyof DemoFlags) => void;
}) {
  return (
    <div className="stack">
      {job.status === "PENDING" && (
        <p className="notice info">
          Video đang được sinh. Trang tự cập nhật trạng thái mỗi 10 giây cho
          đến khi hoàn tất.
        </p>
      )}
      {job.status === "FAILED" && (
        <div role="alert" className="notice error">
          Sinh video thất bại: {job.error || "Không rõ nguyên nhân."}
        </div>
      )}
      {job.result && (
        <>
          <video
            controls
            src={job.result.url}
            style={{ width: "100%", maxWidth: 560, borderRadius: 8 }}
          />
          <div className="row wrap">
            <a className="btn secondary" href={job.result.url} download>
              Tải video xuống
            </a>
          </div>
          <p className="muted">
            Độ phân giải: {job.result.width}×{job.result.height} · Codec:{" "}
            {job.result.codec} · Thời lượng: {job.result.duration} giây · Kiểm
            tra:{" "}
            {verificationLabel[job.result.verification] ||
              job.result.verification}
          </p>
          <p className="hint">
            SHA-256: {job.result.sha256.slice(0, 16)}… · MIME:{" "}
            {job.result.mimeType}
          </p>
        </>
      )}
      <p className="muted">
        Mã yêu cầu: {job.jobId} · Mã tài nguyên: {job.assetId || "chưa có"} ·
        Cập nhật lần cuối: {dateTime(job.updatedAt)}
      </p>
      {job.status === "SUCCEEDED" && (
        <>
          <div className="row wrap">
            {demo.approved && (
              <span className="badge good">Đã duyệt (GIẢ LẬP)</span>
            )}
            {demo.scheduled && (
              <span className="badge">Đã đặt lịch (GIẢ LẬP)</span>
            )}
          </div>
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => onToggleDemo("approved")}
            >
              Duyệt
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => onToggleDemo("scheduled")}
            >
              Đặt lịch đăng
            </button>
          </div>
          <p className="hint">
            Hai nút trên chỉ mô phỏng trạng thái trong trình duyệt (GIẢ LẬP),
            không gửi dữ liệu lên máy chủ.
          </p>
        </>
      )}
    </div>
  );
}

export default function VideoStudioPage() {
  const user = useAuth();
  const writable = user?.role === "ADMIN" || user?.role === "EDITOR";
  const [jobs, setJobs] = useState<VideoJob[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState("");
  const [demo, setDemo] = useState<Record<string, DemoFlags>>({});

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<VideoJob[]>("/video/jobs?limit=50")
      .then((list) => {
        if (active) {
          setJobs(list);
          setLoadError("");
        }
      })
      .catch((e: unknown) => {
        if (active) setLoadError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);

  // Tự cập nhật từng job đang PENDING mỗi 10 giây cho đến khi có kết quả cuối.
  const pendingKey = (jobs ?? [])
    .filter((job) => job.status === "PENDING")
    .map((job) => job.jobId)
    .join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const ids = pendingKey.split(",");
    const timer = setInterval(() => {
      if (document.hidden) return;
      ids.forEach((jobId) => {
        api<VideoJob>(`/video/jobs/${jobId}`)
          .then((state) =>
            setJobs((prev) =>
              prev
                ? prev.map((job) => (job.jobId === jobId ? state : job))
                : prev,
            ),
          )
          .catch(() => undefined); // sẽ thử lại ở chu kỳ sau
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [pendingKey]);

  function toggleDemo(jobId: string, kind: keyof DemoFlags) {
    setDemo((prev) => {
      const current = prev[jobId] || noDemo;
      return { ...prev, [jobId]: { ...current, [kind]: !current[kind] } };
    });
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const job = await send<VideoJob>("/video/jobs", "POST", {
        prompt: f.get("prompt"),
        duration: Number(f.get("duration")),
        aspectRatio: f.get("aspectRatio"),
      });
      setJobs((prev) =>
        prev ? [job, ...prev.filter((j) => j.jobId !== job.jobId)] : [job],
      );
      setExpanded(job.jobId);
      setNotice("Đã gửi yêu cầu tạo video. Trạng thái sẽ tự cập nhật.");
      form.reset();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Video Studio"
        description="Tạo video PR bằng AI, theo dõi tiến độ sinh video và xem trước kết quả trước khi đưa vào kịch bản đăng bài."
      />
      <p className="notice info">
        Chức năng duyệt/đặt lịch là GIẢ LẬP cho demo — pipeline đăng thật
        (HUY-WF03) chưa kết nối.
      </p>
      <Notice error={error || loadError} />
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <div className="grid two">
        <section className="card">
          <h2>Tạo video mới</h2>
          {!writable && (
            <p className="notice">
              Tài khoản người duyệt chỉ xem được kết quả. Tạo video cần tài
              khoản biên tập viên hoặc quản trị viên.
            </p>
          )}
          <form onSubmit={create}>
            <fieldset
              disabled={busy || !writable}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <div className="field">
                <label htmlFor="video-prompt">Mô tả video (prompt)</label>
                <textarea
                  id="video-prompt"
                  name="prompt"
                  rows={4}
                  required
                  maxLength={2000}
                  placeholder="Ví dụ: Quay ly cà phê tái sử dụng trên bàn gỗ, ánh sáng ban ngày, camera di chuyển chậm, không có chữ trong khung hình."
                />
                <p className="hint">
                  Mô tả rõ chủ thể, bối cảnh và chuyển động mong muốn (tối đa
                  2000 ký tự).
                </p>
              </div>
              <div className="grid two">
                <div className="field">
                  <label htmlFor="video-duration">Thời lượng</label>
                  <select
                    id="video-duration"
                    name="duration"
                    defaultValue="8"
                  >
                    <option value="5">5 giây</option>
                    <option value="8">8 giây</option>
                    <option value="10">10 giây</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="video-aspect">Tỷ lệ khung hình</label>
                  <select
                    id="video-aspect"
                    name="aspectRatio"
                    defaultValue="16:9"
                  >
                    <option value="16:9">16:9 — ngang</option>
                    <option value="9:16">9:16 — dọc</option>
                    <option value="1:1">1:1 — vuông</option>
                  </select>
                </div>
              </div>
              <button disabled={busy || !writable} className="btn full">
                {busy ? "Đang gửi yêu cầu…" : "Tạo video"}
              </button>
            </fieldset>
            <p className="hint mt">
              Mỗi yêu cầu tạo một video mới. Quá trình sinh có thể mất vài
              phút; bạn có thể rời trang và quay lại sau.
            </p>
          </form>
        </section>
        <section className="card">
          <div className="row between wrap">
            <h2>Danh sách video</h2>
            <button
              className="btn secondary"
              type="button"
              onClick={() => setRevision((x) => x + 1)}
            >
              Tải lại
            </button>
          </div>
          {jobs === null ? (
            loadError ? (
              <Empty>Không tải được danh sách video. Hãy thử Tải lại.</Empty>
            ) : (
              <p>Đang tải danh sách video…</p>
            )
          ) : jobs.length === 0 ? (
            <Empty>
              Chưa có video nào. Hãy tạo video đầu tiên bằng biểu mẫu bên trái.
            </Empty>
          ) : (
            <>
              {jobs.map((job) => {
                const flags = demo[job.jobId] || noDemo;
                return (
                  <article className="card" key={job.jobId}>
                    <div className="row between wrap">
                      <div className="row wrap">
                        <VideoStatusBadge status={job.status} />
                        <span className="muted">
                          Nhà cung cấp: {job.provider}
                        </span>
                      </div>
                      <span className="muted">{dateTime(job.createdAt)}</span>
                    </div>
                    <p className="prose-content">{job.prompt}</p>
                    <p className="muted">
                      {job.params.duration} giây · tỷ lệ{" "}
                      {job.params.aspectRatio} · {job.params.width}×
                      {job.params.height}
                    </p>
                    <div className="actions">
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={() =>
                          setExpanded(expanded === job.jobId ? "" : job.jobId)
                        }
                      >
                        {expanded === job.jobId ? "Ẩn chi tiết" : "Chi tiết"}
                      </button>
                    </div>
                    {expanded === job.jobId && (
                      <JobDetail
                        job={job}
                        demo={flags}
                        onToggleDemo={(kind) => toggleDemo(job.jobId, kind)}
                      />
                    )}
                  </article>
                );
              })}
              <p className="muted">Đang hiển thị 50 video mới nhất.</p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
