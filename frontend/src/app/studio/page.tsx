"use client";
import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { send, useResource, errorMessage } from "@/lib/api";
import type { Campaign, Post } from "@/lib/types";
import { PageTitle, Notice, Banner, Badge, Empty } from "@/components/ui";
import { ImageAssessment } from "@/components/image-assessment";
import { useAuth } from "@/components/shell";
function Preview({ id }: { id: string }) {
  const {
    data: post,
    error,
    refresh,
  } = useResource<Post>(`/posts/${id}`, 5000);
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const user = useAuth();
  if (!post) return <Notice error={error} message="Đang tải bài viết…" />;
  const active = ["QUEUED", "RUNNING"].includes(post.job?.status || "");
  const needsImage = !active && !!post.content &&
    (post.imageStatus === "FAILED" || post.imageReviewStatus === "ERROR");
  return (
    <div className="stack">
      <Notice error={actionError || error} />
      <div className="row between wrap">
        <Badge value={post.status} />
        <span className="muted">{post.platform}</span>
      </div>
      {post.job && (
        <div className="notice info">
          <div className="row wrap">
            <span>Yêu cầu AI:</span>
            <Badge value={needsImage && post.job.status === "SUCCEEDED" ? "PARTIAL" : post.job.status} />
          </div>
          {post.job.error && <p className="mt">{post.job.error}</p>}
        </div>
      )}
      {needsImage && (
        <div className="notice info" role="status">
          <strong>Nội dung đã có, ảnh cần xử lý thêm</strong>
          <p className="mt">Bài đã được lưu. Bạn có thể thử lại riêng ảnh bên dưới để giữ nguyên nội dung. Bài chưa được tự duyệt khi ảnh chưa đạt kiểm tra.</p>
        </div>
      )}
      <h2>{post.headline || post.topic}</h2>
      <p className="prose-content">
        {post.content ||
          "Nội dung sẽ tự cập nhật khi AI hoàn tất. Bạn có thể chuyển trang trong lúc chờ."}
      </p>
      <Banner
        key={post.bannerUrl}
        src={post.bannerUrl}
        alt={post.headline || post.topic}
      />
      <div className="row wrap">
        <span>Ảnh:</span>
        <Badge value={post.imageStatus} />
        <span>Rủi ro:</span>
        <Badge value={post.risk} />
      </div>
      <ImageAssessment post={post} refresh={refresh} />
      {post.reviewReason && (
        <p className="hint">Kiểm tra AI: {post.reviewReason}</p>
      )}
      {user?.role !== "REVIEWER" &&
        !["APPROVED", "PUBLISHED", "CRISIS_ALERT"].includes(post.status) && (
          <form
            key={post.id + (post.imagePrompt || "")}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await send(`/posts/${post.id}/regenerate`, "POST", {
                  imagePrompt: f.get("imagePrompt"),
                });
                refresh();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="regenerate-prompt">Điều chỉnh mô tả hình ảnh</label>
            <textarea
              id="regenerate-prompt"
              name="imagePrompt"
              defaultValue={post.imagePrompt || ""}
              maxLength={2000}
              rows={3}
            />
            <p className="hint mb">
              Mô tả rõ chủ thể, bối cảnh và bố cục mong muốn. Tạo lại sẽ chạy cả
              bước soạn và kiểm tra bài.
            </p>
            <button
              disabled={
                busy || ["RUNNING", "QUEUED"].includes(post.job?.status || "")
              }
              className="btn secondary"
            >
              {busy ? "Đang gửi…" : "Tạo lại bài và banner"}
            </button>
          </form>
        )}
      <Link
        className="btn secondary"
        href={post.status === "APPROVED" ? "/simulator" : "/approval"}
      >
        {post.status === "APPROVED" ? "Xem trên feed" : "Mở hàng đợi duyệt"}
      </Link>
    </div>
  );
}
export default function StudioPage() {
  const { data: campaigns } = useResource<Campaign[]>("/campaigns");
  const { data: posts, refresh } = useResource<Post[]>("/posts", 10000);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const user = useAuth();
  return (
    <>
      <PageTitle
        title="Content Studio"
        description="Từ ý tưởng đến bài PR: tạo nội dung, chọn hình ảnh và kiểm tra trước khi đưa lên feed."
      />
      <Notice error={error} />
      <div className="grid two">
        <section className="card">
          <h2>
            <Sparkles size={20} className="inline" /> Thông tin bài viết
          </h2>
          {user?.role === "REVIEWER" ? (
            <Empty>
              Tài khoản người duyệt có thể xem kết quả. Tạo nội dung bằng tài
              khoản biên tập viên hoặc quản trị viên.
            </Empty>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  const post = await send<Post>(
                    "/posts/generate",
                    "POST",
                    Object.fromEntries(f),
                  );
                  setSelected(post.id);
                  refresh();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="campaignId">Chiến dịch</label>
                <select id="campaignId" name="campaignId">
                  <option value="">Bài viết độc lập</option>
                  {campaigns?.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="topic">
                  Chủ đề và thông tin cần truyền tải
                </label>
                <textarea
                  id="topic"
                  name="topic"
                  rows={4}
                  required
                  maxLength={1500}
                  placeholder="Ví dụ: Giới thiệu ly tái sử dụng EcoCup, khuyến khích mang ly cá nhân khi đi cà phê. Không đưa giá hoặc ưu đãi."
                />
              </div>
              <div className="field">
                <label htmlFor="targetAudience">Đối tượng</label>
                <input
                  id="targetAudience"
                  name="targetAudience"
                  maxLength={500}
                  defaultValue="Sinh viên và nhân viên văn phòng"
                />
              </div>
              <div className="grid two">
                <div className="field">
                  <label htmlFor="tone">Giọng điệu</label>
                  <select id="tone" name="tone">
                    <option>Gần gũi, tích cực</option>
                    <option>Chuyên nghiệp, tin cậy</option>
                    <option>Trang trọng, thận trọng</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="platform">Định dạng nền tảng</label>
                  <select id="platform" name="platform">
                    <option>Facebook</option>
                    <option>LinkedIn</option>
                    <option>X</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="imagePrompt">
                  Định hướng hình ảnh (tùy chọn)
                </label>
                <textarea
                  id="imagePrompt"
                  name="imagePrompt"
                  rows={2}
                  maxLength={2000}
                  placeholder="Ví dụ: Ly tái sử dụng màu xanh trên bàn cà phê, ánh sáng ban ngày, không chữ trong ảnh."
                />
              </div>
              <button disabled={busy} className="btn full">
                {busy ? "Đang gửi yêu cầu…" : "Tạo bài viết với AI"}
              </button>
              <p className="hint mt">
                AI miễn phí có hạn mức. Khi lỗi, hệ thống giữ trạng thái rõ ràng
                để bạn thử lại.
              </p>
            </form>
          )}
        </section>
        <section className="card">
          <div className="field">
            <label htmlFor="selectedPost">Xem kết quả bài viết</label>
            <select
              id="selectedPost"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Chọn một bài viết</option>
              {posts?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.topic}
                </option>
              ))}
            </select>
          </div>
          {selected ? (
            <Preview key={selected} id={selected} />
          ) : (
            <Empty>
              Tạo bài mới hoặc chọn một bài để xem nội dung, banner và trạng
              thái xử lý.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
