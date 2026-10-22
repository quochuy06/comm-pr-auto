"use client";
import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";
const labels: Record<string, string> = {
  DRAFT: "Đang soạn",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  PUBLISHED: "Đã xuất bản",
  PUBLISHING: "Đang gửi / chờ đối soát",
  SENDING: "Đang gửi Facebook",
  UNCERTAIN: "Cần đối soát Facebook",
  REJECTED: "Từ chối",
  CRISIS_ALERT: "Có rủi ro",
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  UNKNOWN: "Chưa đánh giá",
  POSITIVE: "Tích cực",
  NEUTRAL: "Trung tính",
  NEGATIVE: "Tiêu cực",
  CRISIS: "Nghiêm trọng",
  QUEUED: "Đang xếp hàng",
  RUNNING: "Đang xử lý",
  SUCCEEDED: "Hoàn tất",
  PARTIAL: "Cần xử lý ảnh",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  OPEN: "Đang phân tích",
  RESOLVED: "Đã xử lý",
  PENDING: "Chờ xử lý",
  DONE: "Đã phân tích",
  NONE: "Chưa có",
  VERIFIED: "Đã tải ảnh",
  MANUAL: "Ảnh thủ công",
};
export const label = (value: string) => labels[value] || value;
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["APPROVED", "SUCCEEDED", "LOW", "POSITIVE", "RESOLVED", "VERIFIED", "DONE"].includes(value) ? "good" : ["FAILED", "HIGH", "CRISIS", "NEGATIVE", "REJECTED", "CRISIS_ALERT"].includes(value) ? "danger" : ""}`}
    >
      {label(value)}
    </span>
  );
}
export function PageTitle({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Notice({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  return error ? (
    <div role="alert" className="notice error">
      {error}
    </div>
  ) : message ? (
    <div role="status" className="notice success">
      {message}
    </div>
  ) : null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Banner({
  src,
  alt = "Banner bài viết",
}: {
  src: string | null;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <div className="banner-placeholder">
        <ImageOff size={30} />
        <span>
          {failed
            ? "Không tải được ảnh. Hãy đổi ảnh hoặc tạo lại."
            : "Chưa có banner hợp lệ"}
        </span>
      </div>
    );
  return (
    <Image
      src={src}
      alt={alt}
      width={1200}
      height={630}
      unoptimized
      className="banner"
      onError={() => setFailed(true)}
    />
  );
}
export const dateTime = (date: string) =>
  new Date(date).toLocaleString("vi-VN");
