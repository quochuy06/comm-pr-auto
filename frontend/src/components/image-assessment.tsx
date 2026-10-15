"use client";
import type { Post } from "@/lib/types";
const labels: Record<string, string> = {
  NOT_REVIEWED: "Chưa kiểm tra ảnh thực tế",
  PENDING: "Đang kiểm tra ảnh",
  PASS: "Ảnh phù hợp nội dung",
  FAIL: "Ảnh chưa phù hợp",
  UNCERTAIN: "Chưa đủ chắc chắn",
  ERROR: "Chưa kiểm tra được ảnh",
  MANUAL: "Người duyệt đã xác nhận",
};
export function ImageAssessment({ post }: { post: Post; refresh?: () => void }) {
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
            để người duyệt quyết định.
          </p>
        )}
      </div>
    </section>
  );
}
