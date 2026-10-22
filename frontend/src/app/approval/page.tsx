"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource, send, errorMessage } from "@/lib/api";
import type { Post, ReviewComment } from "@/lib/types";
import {
  PageTitle,
  Notice,
  Badge,
  Banner,
  Empty,
  dateTime,
} from "@/components/ui";
import { ImageAssessment } from "@/components/image-assessment";
import { useAuth } from "@/components/shell";
import { FacebookReplyDelivery } from "@/components/facebook";
function PostReview({
  post,
  refresh,
  canReview,
}: {
  post: Post;
  refresh: () => void;
  canReview: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await send(`/posts/${post.id}/${action}`, "PATCH", body);
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
        <div>
          <h2>{post.topic}</h2>
          <small className="muted">
            {post.campaign?.name || "Bài độc lập"} · {post.platform} ·{" "}
            {dateTime(post.createdAt)}
          </small>
        </div>
        <Badge value={post.status} />
      </div>
      <Notice error={error} />
      <div className="grid two">
        <div>
          <Banner key={post.bannerUrl} src={post.bannerUrl} alt={post.topic} />
          <div className="row wrap mt">
            <Badge value={post.imageStatus} />
            <span className="muted compact">Rủi ro</span>
            <Badge value={post.risk} />
          </div>
          <p className="hint mt">
            {post.reviewReason || "Chưa có kết quả kiểm tra AI."}
          </p>
          <ImageAssessment post={post} refresh={refresh} />
          {post.imagePrompt && (
            <details className="mt">
              <summary>Mô tả ảnh</summary>
              <p className="hint">{post.imagePrompt}</p>
            </details>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              "approve",
              Object.fromEntries(new FormData(e.currentTarget)),
            );
          }}
        >
          <fieldset
            disabled={
              !canReview ||
              busy ||
              post.status === "DRAFT" ||
              post.imageReviewStatus === "PENDING"
            }
          >
            <div className="field">
              <label htmlFor={`headline-${post.id}`}>Tiêu đề</label>
              <input
                id={`headline-${post.id}`}
                name="headline"
                defaultValue={post.headline || ""}
                required
                maxLength={500}
              />
            </div>
            <div className="field">
              <label htmlFor={`content-${post.id}`}>Nội dung</label>
              <textarea
                id={`content-${post.id}`}
                name="content"
                defaultValue={post.content || ""}
                rows={8}
                required
                maxLength={12000}
              />
            </div>
            <div className="field">
              <label htmlFor={`banner-${post.id}`}>URL banner</label>
              <input
                id={`banner-${post.id}`}
                name="bannerUrl"
                defaultValue={post.bannerUrl || ""}
                placeholder="https://…"
                required
                maxLength={6000}
              />
              <p className="hint">
                Nếu ảnh AI lỗi, bổ sung ảnh HTTPS phù hợp và kiểm tra trước khi
                duyệt.
              </p>
            </div>
            <button className="btn" disabled={busy}>
              Duyệt bài để lên lịch
            </button>
          </fieldset>
          <div className="row wrap mt">
            {canReview && (
              <button
                disabled={busy}
                type="button"
                className="btn danger"
                onClick={() => void act("reject")}
              >
                Từ chối
              </button>
            )}
            <Link className="btn secondary" href="/studio">
              Mở Studio
            </Link>
          </div>
          {post.status === "DRAFT" && (
            <p className="hint mt">
              Chờ AI hoàn tất. Nếu xử lý lỗi, vào Studio chọn bài và tạo lại.
            </p>
          )}
          {!canReview && (
            <p className="hint mt">
              Chỉ người duyệt hoặc quản trị viên có thể phê duyệt.
            </p>
          )}
        </form>
      </div>
    </article>
  );
}
function CommentReview({
  comment: c,
  refresh,
  canReview,
}: {
  comment: ReviewComment;
  refresh: () => void;
  canReview: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await send(
        `/comments/${c.id}/${action}`,
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
      <h2>{c.post?.topic}</h2>
      <div className="row wrap">
        <strong>{c.author}</strong>
        <Badge value={c.sentiment} />
        <Badge value={c.risk} />
        <Badge value={c.analysisStatus} />
      </div>
      <p className="prose-content mt">{c.text}</p>
      <p className="hint">Nguồn: {c.source === "FACEBOOK" ? "Facebook Page · phản hồi sẽ được gửi công khai sau khi duyệt" : "Mô phỏng"}{c.remoteDeleted ? " · Bình luận đã bị xóa" : ""}</p>
      <FacebookReplyDelivery comment={c} refresh={refresh} />
      <Notice error={error} />
      <p className="hint mb">{c.reason || "Chờ kết quả phân tích."}</p>
      {c.replyStatus === "PENDING" && !c.remoteDeleted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("reply", {
              replyText: new FormData(e.currentTarget).get("replyText"),
              ...(c.source === "FACEBOOK" ? { confirmFacebook: new FormData(e.currentTarget).get("confirmFacebook") === "on", sourceHash: c.sourceHash } : {}),
            });
          }}
        >
          <label htmlFor={`reply-${c.id}`}>Phản hồi đề xuất</label>
          <textarea
            id={`reply-${c.id}`}
            name="replyText"
            defaultValue={c.suggestedReply || ""}
            rows={4}
            maxLength={5000}
            required
            disabled={!canReview || busy}
          />
          {c.source === "FACEBOOK" && <label className="mt"><input type="checkbox" name="confirmFacebook" required disabled={!canReview || busy} /> Tôi đã kiểm tra nội dung và xác nhận gửi phản hồi công khai lên Facebook.</label>}
          <div className="row wrap mt">
            <button disabled={!canReview || busy} className="btn">
              {c.source === "FACEBOOK" ? "Duyệt và gửi Facebook" : "Duyệt phản hồi"}
            </button>
            <button
              disabled={!canReview || busy}
              className="btn danger"
              type="button"
              onClick={() => void act("reject")}
            >
              Từ chối
            </button>
          </div>
        </form>
      )}
      {c.analysisStatus === "FAILED" && !c.remoteDeleted && (
        <button
          className="btn secondary"
          disabled={!canReview || busy}
          onClick={() => void act("retry")}
        >
          Phân tích lại
        </button>
      )}
    </article>
  );
}
export default function ApprovalPage() {
  const posts = useResource<Post[]>("/posts", 6000);
  const comments = useResource<ReviewComment[]>("/comments", 6000);
  const [tab, setTab] = useState("posts");
  const user = useAuth();
  const canReview = user?.role === "ADMIN" || user?.role === "REVIEWER";
  const pendingPosts =
    posts.data?.filter((p) =>
      ["DRAFT", "PENDING_APPROVAL"].includes(p.status),
    ) || [];
  const pendingComments =
    comments.data?.filter(
      (c) => !c.remoteDeleted && (c.replyStatus === "PENDING" || c.analysisStatus === "FAILED" || ["PENDING", "SENDING", "FAILED", "UNCERTAIN"].includes(c.facebookReply?.status || "")),
    ) || [];
  return (
    <>
      <PageTitle
        title="Hàng đợi duyệt"
        description="Kiểm tra bài viết và hiệu đính phản hồi. Phản hồi Facebook yêu cầu xác nhận gửi công khai."
      />
      <Notice error={posts.error || comments.error} />
      <div className="tabs">
        <button
          className={tab === "posts" ? "active" : ""}
          onClick={() => setTab("posts")}
        >
          Bài PR ({pendingPosts.length})
        </button>
        <button
          className={tab === "comments" ? "active" : ""}
          onClick={() => setTab("comments")}
        >
          Phản hồi bình luận ({pendingComments.length})
        </button>
        <Link className="btn secondary" href="/alerts">
          Thông cáo khủng hoảng
        </Link>
      </div>
      <div className="stack">
        {tab === "posts" ? (
          pendingPosts.length ? (
            pendingPosts.map((p) => (
              <PostReview
                key={
                  p.id +
                  p.status +
                  (p.bannerUrl || "") +
                  (p.headline || "") +
                  (p.content || "")
                }
                post={p}
                refresh={posts.refresh}
                canReview={canReview}
              />
            ))
          ) : (
            <Empty>
              {posts.loading ? "Đang tải…" : "Không có bài viết chờ duyệt."}
            </Empty>
          )
        ) : pendingComments.length ? (
          pendingComments.map((c) => (
            <CommentReview
              key={c.id + c.replyStatus + c.analysisStatus + c.sourceHash}
              comment={c}
              refresh={comments.refresh}
              canReview={canReview}
            />
          ))
        ) : (
          <Empty>
            {comments.loading ? "Đang tải…" : "Không có phản hồi cần xử lý."}
          </Empty>
        )}
      </div>
    </>
  );
}
