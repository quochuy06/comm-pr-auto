"use client";
import { useState } from "react";
import { useAuth } from "@/components/shell";
import { useResource, send, errorMessage } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { PageTitle, Notice } from "@/components/ui";
import { FacebookSettings } from "@/components/facebook";
export default function SettingsPage() {
  const { data, error, refresh } = useResource<Settings>("/settings");
  const user = useAuth();
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <>
      <PageTitle
        title="Cài đặt xử lý"
        description="Quyết định khi nào hệ thống được tự động hành động và khi nào cần người duyệt."
      />
      <Notice error={actionError || error} message={message} />
      <div className="grid two">
        <section className="card">
          <h2>Chế độ tự động và ngưỡng cảnh báo</h2>
          {data && (
            <form
              key={JSON.stringify(data)}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  await send("/settings", "PATCH", {
                    mode: f.get("mode"),
                    negativeThreshold: Number(f.get("negativeThreshold")),
                    windowMinutes: Number(f.get("windowMinutes")),
                  });
                  setMessage("Đã cập nhật cài đặt.");
                  refresh();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={user?.role !== "ADMIN" || busy}>
                <div className="field">
                  <label htmlFor="mode">Chế độ</label>
                  <select id="mode" name="mode" defaultValue={data.mode}>
                    <option value="CONDITIONAL">Tự động có điều kiện</option>
                    <option value="MANUAL">Luôn chuyển người duyệt</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="negativeThreshold">
                    Số bình luận tiêu cực kích hoạt cảnh báo
                  </label>
                  <input
                    id="negativeThreshold"
                    name="negativeThreshold"
                    type="number"
                    min={2}
                    max={50}
                    defaultValue={data.negativeThreshold}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="windowMinutes">
                    Khoảng thời gian theo dõi (phút)
                  </label>
                  <input
                    id="windowMinutes"
                    name="windowMinutes"
                    type="number"
                    min={1}
                    max={1440}
                    defaultValue={data.windowMinutes}
                    required
                  />
                </div>
                <button className="btn">
                  {busy ? "Đang lưu…" : "Lưu cài đặt"}
                </button>
              </fieldset>
              {user?.role !== "ADMIN" && (
                <p className="hint mt">
                  Chỉ quản trị viên được thay đổi cài đặt.
                </p>
              )}
            </form>
          )}
        </section>
        <section className="card">
          <h2>Quy tắc đang áp dụng</h2>
          <div className="stack">
            <p>
              <strong>Bài PR:</strong> đủ nội dung, ảnh tải được và được AI xem
              ảnh thực tế xác nhận phù hợp, qua kiểm tra AI, rủi ro thấp mới
              được tự duyệt.
            </p>
            <p>
              <strong>Bình luận mô phỏng:</strong> chỉ tự trả lời khi cảm xúc tích
              cực/trung tính và không nhạy cảm; trường hợp khác chuyển người
              duyệt.
            </p>
            <p>
              <strong>Khủng hoảng:</strong> một dấu hiệu nghiêm trọng cũng có
              thể kích hoạt cảnh báo. Thông cáo luôn cần người duyệt.
            </p>
            <p>
              <strong>Khi AI lỗi:</strong> không tự duyệt. Người dùng xem lỗi và
              thử lại khi dịch vụ sẵn sàng.
            </p>
          </div>
          <p className="hint">
            Ảnh tải được không đồng nghĩa ảnh hoàn toàn đúng nội dung. Người
            duyệt vẫn cần kiểm tra hình ảnh khi có nghi ngờ.
          </p>
        </section>
      </div>
      <FacebookSettings />
    </>
  );
}
