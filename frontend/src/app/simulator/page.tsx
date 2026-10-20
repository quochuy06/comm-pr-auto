"use client";
import { useState } from "react";
import { MessageSquare, Globe, Send } from "lucide-react";
import { useResource, send, errorMessage } from "@/lib/api";
import type { Post } from "@/lib/types";
import {
  PageTitle,
  Notice,
  Banner,
  Badge,
  Empty,
  dateTime,
} from "@/components/ui";
import { useAuth } from "@/components/shell";
function FeedPost({ post, refresh }: { post: Post; refresh: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const user = useAuth();
  const canModerate = user?.role === "ADMIN" || user?.role === "REVIEWER";
  return (
    <article className="card">
      <div className="row between mb">
        <div className="row">
          <span className="brand-icon">
            <Globe size={20} />
          </span>
          <div>
            <strong>{post.campaign?.name || "PR Workspace"}</strong>
            <small className="block muted">
              {post.platform} · {dateTime(post.createdAt)}
            </small>
          </div>
        </div>
        <Badge value={post.status} />
      </div>
      <h2>{post.headline || post.topic}</h2>
      <p className="prose-content">{post.content}</p>
      <Banner
        key={post.bannerUrl}
        src={post.bannerUrl}
        alt={post.headline || post.topic}
      />
      {post.alerts
        ?.filter((a) => a.publishedAt)
        .map((a) => (
          <div className="notice info mt" key={a.id}>
            <strong>Phản hồi chính thức · Đã được người duyệt kiểm tra</strong>
            <p className="prose-content mt">{a.statement}</p>
          </div>
        ))}
      <hr className="divider" />
      <div className="row">
        <MessageSquare size={18} />
        <strong>{post.comments?.length || 0} bình luận</strong>
      </div>
      {post.comments?.map((c) => (
        <div className="comment" key={c.id}>
          <div className="row between wrap">
            <strong>{c.author}</strong>
            <div className="row wrap">
              <Badge
                value={
                  c.analysisStatus === "DONE" ? c.sentiment : c.analysisStatus
                }
              />
              {c.risk === "HIGH" && <Badge value="HIGH" />}
            </div>
          </div>
          {c.analysisMeta && <p className="hint">Phân loại: {c.analysisMeta.issueType} · Ưu tiên: {c.analysisMeta.urgency}</p>}
          <p className="prose-content mt">
            {c.moderated
              ? "Bình luận đã được ẩn bởi người kiểm duyệt."
              : c.text}
          </p>
          {c.moderated && canModerate && (
            <details>
              <summary>Xem nội dung đã ẩn</summary>
              <p className="prose-content">{c.text}</p>
            </details>
          )}
          {c.replyText && !c.moderated && (
            <div className="reply">
              <strong>Phản hồi từ nhóm PR</strong>
              <p className="prose-content">{c.replyText}</p>
            </div>
          )}
          {c.replyStatus === "PENDING" && (
            <p className="hint">Phản hồi đang chờ người duyệt.</p>
          )}
          {canModerate && (
            <button
              className="btn secondary small mt"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await send(`/comments/${c.id}/moderate`, "PATCH", {
                    moderated: !c.moderated,
                  });
                  refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {c.moderated ? "Hiện lại bình luận" : "Ẩn bình luận"}
            </button>
          )}
        </div>
      ))}
      <Notice error={error} />
      <form
        className="mt"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!comment.trim()) return;
          setBusy(true);
          setError("");
          try {
            await send(`/posts/${post.id}/comments`, "POST", { text: comment });
            setComment("");
            refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={`comment-${post.id}`}>Thêm bình luận mô phỏng</label>
        <textarea
          id={`comment-${post.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Nhập phản hồi để thử luồng phân tích cảm xúc và trả lời…"
          maxLength={3000}
          required
          rows={2}
        />
        <div className="row between mt">
          <small className="muted">
            Bình luận được lưu và gửi tới AI phân tích.
          </small>
          <button className="btn" disabled={busy}>
            <Send size={15} />
            {busy ? "Đang gửi…" : "Gửi"}
          </button>
        </div>
      </form>
    </article>
  );
}
export default function SimulatorPage() {
  const { data, error, loading, refresh } = useResource<Post[]>("/posts", 5000);
  const posts =
    data?.filter((p) =>
      ["PUBLISHED", "CRISIS_ALERT"].includes(p.status),
    ) || [];
  return (
    <>
      <PageTitle
        title="Feed & bình luận"
        description="Không gian mô phỏng mạng xã hội. Bài và bình luận lưu thật trong hệ thống; chưa đăng lên Facebook."
      />
      <Notice error={error} />
      <div className="feed stack">
        {posts.length ? (
          posts.map((p) => <FeedPost key={p.id} post={p} refresh={refresh} />)
        ) : (
          <Empty>
            {loading
              ? "Đang tải bảng tin…"
              : "Chưa có bài đã đăng. Duyệt bài rồi đặt lịch tại Kế hoạch & lịch đăng."}
          </Empty>
        )}
      </div>
    </>
  );
}
