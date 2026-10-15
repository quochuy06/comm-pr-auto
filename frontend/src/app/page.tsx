"use client";
import Link from "next/link";
import {
  FileText,
  FolderOpen,
  MessageSquare,
  ShieldAlert,
  Plus,
} from "lucide-react";
import { useResource } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { PageTitle, Badge, Notice, dateTime, Empty } from "@/components/ui";
import { useAuth } from "@/components/shell";
export default function Home() {
  const { data, error, loading } = useResource<Dashboard>("/dashboard", 8000);
  const user = useAuth();
  return (
    <>
      <PageTitle
        title="Tổng quan truyền thông"
        description="Theo dõi nội dung, phản hồi cộng đồng và các trường hợp cần chú ý."
      >
        {user?.role !== "REVIEWER" && (
          <Link className="btn" href="/studio">
            <Plus size={17} />
            Tạo bài PR
          </Link>
        )}
      </PageTitle>
      <Notice error={error} />
      {loading ? (
        <Empty>Đang tải dữ liệu…</Empty>
      ) : (
        data && (
          <div className="stack">
            <div className="grid stats">
              {[
                { label: "Bài viết", value: data.posts, icon: FileText },
                {
                  label: "Chiến dịch",
                  value: data.campaigns,
                  icon: FolderOpen,
                },
                {
                  label: "Bình luận",
                  value: data.comments,
                  icon: MessageSquare,
                },
                {
                  label: "Cảnh báo chưa đóng",
                  value: data.alerts,
                  icon: ShieldAlert,
                },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="card stat">
                  <span className="stat-label">
                    <Icon size={18} />
                    {label}
                  </span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="notice info row between wrap">
              <span>
                <strong>{data.pending} bài viết</strong> đang chờ người duyệt.
                Thông cáo khủng hoảng luôn được duyệt thủ công.
              </span>
              <Link href="/approval" className="btn secondary small">
                Mở hàng đợi
              </Link>
            </div>
            <div className="grid two">
              <section className="card">
                <h2>Hoạt động 7 ngày</h2>
                <p className="hint mb">
                  Bình luận đã phân tích · số tiêu cực/nghiêm trọng ở bên phải.
                </p>
                {data.trend.map((d) => (
                  <div className="chart-row" key={d.date}>
                    <span>{d.date.slice(5)}</span>
                    <div className="chart-bar">
                      <span
                        style={{
                          width: `${(d.total / Math.max(1, ...data.trend.map((x) => x.total))) * 100}%`,
                        }}
                      />
                    </div>
                    <span>
                      {d.total} / {d.negative}
                    </span>
                  </div>
                ))}
                <div className="row wrap mt">
                  {data.sentiments.map((s) => (
                    <span key={s.sentiment}>
                      <Badge value={s.sentiment} /> {s._count._all}
                    </span>
                  ))}
                </div>
              </section>
              <section className="card">
                <h2>Ba workflow đang phục vụ</h2>
                {[
                  [
                    "01",
                    "Nội dung & hình ảnh",
                    "Soạn bài, tạo mô tả ảnh và kiểm tra độc lập.",
                  ],
                  [
                    "02",
                    "Cộng đồng & cảm xúc",
                    "Phân tích bình luận, đề xuất phản hồi phù hợp.",
                  ],
                  [
                    "03",
                    "Phản hồi khủng hoảng",
                    "Tổng hợp bằng chứng, soạn thông cáo chờ duyệt.",
                  ],
                ].map(([n, title, detail]) => (
                  <div key={n} className="workflow-item row">
                    <span className="user-avatar">{n}</span>
                    <div>
                      <strong>{title}</strong>
                      <small className="block muted">{detail}</small>
                    </div>
                  </div>
                ))}
              </section>
            </div>
            <section className="card">
              <div className="row between mb">
                <h2>Yêu cầu xử lý gần đây</h2>
                <span className="muted compact">Tự cập nhật mỗi 8 giây</span>
              </div>
              {!data.jobs.length ? (
                <p className="muted">Chưa có yêu cầu xử lý.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Workflow</th>
                        <th>Trạng thái</th>
                        <th>Thời gian</th>
                        <th>Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.jobs.map((j) => (
                        <tr key={j.id}>
                          <td>
                            {{
                              content: "Nội dung PR",
                              community: "Bình luận",
                              crisis: "Khủng hoảng",
                            }[j.kind] || j.kind}
                          </td>
                          <td>
                            <Badge value={j.status} />
                          </td>
                          <td>{dateTime(j.createdAt)}</td>
                          <td>{j.error || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card">
              <h2>Nhật ký quyết định</h2>
              {data.audits.length ? (
                data.audits.map((a) => (
                  <div key={a.id} className="workflow-item">
                    <div className="row between wrap">
                      <strong className="compact">{a.action}</strong>
                      <small className="muted">{dateTime(a.createdAt)}</small>
                    </div>
                    <small>
                      {a.actor}
                      {a.detail ? ` · ${a.detail}` : ""}
                    </small>
                  </div>
                ))
              ) : (
                <p className="muted">
                  Các quyết định duyệt và thao tác sẽ xuất hiện tại đây.
                </p>
              )}
            </section>
          </div>
        )
      )}
    </>
  );
}
