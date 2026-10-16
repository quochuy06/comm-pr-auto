"use client";
import { useState } from "react";
import type { Post } from "@/lib/types";
import { send, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { Notice } from "@/components/ui";
const labels: Record<string, string> = {
  NOT_REVIEWED: "Chưa kiểm tra ảnh thực tế",
  PENDING: "Đang kiểm tra ảnh",
  PASS: "Ảnh phù hợp nội dung",
  FAIL: "Ảnh chưa phù hợp",
  UNCERTAIN: "Chưa đủ chắc chắn",
  ERROR: "Chưa kiểm tra được ảnh",
  MANUAL: "Người duyệt đã xác nhận",
};
export function ImageAssessment({
  post,
  refresh,
}: {
  post: Post;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const user = useAuth();
  const running =
    ["RUNNING", "QUEUED"].includes(post.job?.status || "") ||
    post.imageReviewStatus === "PENDING";
  const published = ["APPROVED", "PUBLISHED", "CRISIS_ALERT"].includes(
    post.status,
  );
  const canProcess =
    post.status !== "CRISIS_ALERT" &&
    !!post.headline &&
    !!post.content &&
    !!post.imagePrompt &&
    (!published || user?.role !== "EDITOR");
  async function process(action: string, imagePrompt?: string) {
    setBusy(true);
    setError("");
    try {
      await send(
        `/posts/${post.id}/${action}`,
        "POST",
        imagePrompt === undefined ? {} : { imagePrompt },
      );
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack mt" aria-label="Kiểm tra hình ảnh">
      <div
        className={`notice ${post.imageReviewStatus === "PASS" ? "success" : post.imageReviewStatus === "FAIL" || post.imageReviewStatus === "ERROR" ? "error" : "info"}`}
      >
        <strong>{labels[post.imageReviewStatus] || labels.NOT_REVIEWED}</strong>
        {!["NOT_REVIEWED", "PENDING", "MANUAL"].includes(
          post.imageReviewStatus,
        ) &&
          post.imageReview && (
            <>
              <p className="mt">{post.imageReview.reason}</p>
              {post.imageReview.observed && (
                <p className="hint mt">
                  AI nhìn thấy: {post.imageReview.observed}
                </p>
              )}
              {!!post.imageReview.missingElements?.length && (
                <p className="hint mt">
                  Chưa đạt: {post.imageReview.missingElements.join("; ")}
                </p>
              )}
            </>
          )}
        {post.imageError && <p className="mt">{post.imageError}</p>}
        {!["PASS", "MANUAL"].includes(post.imageReviewStatus) && (
          <p className="hint mt">
            Chỉ tự duyệt khi cả nội dung và ảnh thực tế đều đạt kiểm tra. Có thể
            tạo lại ảnh hoặc để người duyệt quyết định.
          </p>
        )}
      </div>
      <Notice error={error} />
      {canProcess && !published && (post.imageStatus === "FAILED" || post.imageReviewStatus === "ERROR") && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy || running}
          onClick={() => void process(post.imageStatus === "VERIFIED" && post.bannerUrl?.startsWith("/media/") ? "review-image" : "regenerate-image")}
        >
          {busy || running ? "Đang xử lý ảnh…" : post.imageStatus === "VERIFIED" ? "Thử lại kiểm tra ảnh" : "Thử lại riêng ảnh"}
        </button>
      )}
      {canProcess && (
        <details>
          <summary>Sửa hoặc kiểm tra lại ảnh</summary>
          {published && (
            <p className="hint mt">
              Thao tác này đưa bài về chờ duyệt và tạm ẩn khỏi feed trong lúc
              kiểm tra.
            </p>
          )}
          <form
            key={post.id + post.imagePrompt}
            className="mt"
            onSubmit={(e) => {
              e.preventDefault();
              void process(
                "regenerate-image",
                String(new FormData(e.currentTarget).get("imagePrompt")),
              );
            }}
          >
            <label htmlFor={`image-only-${post.id}`}>Mô tả ảnh cần tạo</label>
            <textarea
              id={`image-only-${post.id}`}
              name="imagePrompt"
              defaultValue={post.imagePrompt || ""}
              rows={4}
              required
              maxLength={2000}
            />
            <p className="hint mb">
              Nêu rõ vật thể, hành động và chi tiết bắt buộc nhìn thấy. Tiêu đề
              và nội dung bài được giữ nguyên.
            </p>
            <div className="row wrap">
              <button className="btn secondary" disabled={busy || running}>
                Tạo lại riêng ảnh
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={
                  busy || running || !post.bannerUrl?.startsWith("/media/")
                }
                onClick={() => void process("review-image")}
              >
                Kiểm tra ảnh hiện tại
              </button>
            </div>
          </form>
        </details>
      )}
    </section>
  );
}
