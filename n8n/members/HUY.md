# Quốc Huy — Kế hoạch và lịch đăng

Nhánh `feat/huy-planning-publishing-v2`, dựa trên `feat/hoang-content-image-v2`.

- `huy-01-planning.json`: 17 node, `plan-campaign`. Nhận brief và chiến dịch, tạo 1–20 ý tưởng, kiểm tra độc lập, lưu kế hoạch chờ người duyệt.
- `huy-02-publishing.json`: 12 node, chạy mỗi phút hoặc webhook có token `publish-due`. Lấy tối đa 50 lịch đến hạn, backend xuất bản trong transaction, ghi kết quả.
- Trang `/planning`: tạo/duyệt kế hoạch, tạo bài từ từng ý tưởng (chống trùng), đặt và hủy lịch.
- Chỉ bài APPROVED đầy đủ mới được đặt lịch; khi đăng kiểm tra lại hash nội dung/ảnh/nền tảng/người duyệt. Lịch trễ quá 24 giờ chuyển FAILED, cần đặt lại.
- Feed chỉ hiển thị PUBLISHED/CRISIS_ALERT. Dữ liệu APPROVED cũ giữ nguyên, cần đặt lịch để xuất hiện lại.
- Schema bổ sung WorkflowArtifact/PostSchedule, không xóa dữ liệu. Artifact dùng chung cho các phần tiếp theo.
- Job FAILED có thể thử lại từ web; callback cũ/lặp không ghi đè kết quả.

Kiểm tra tại commit: 20/20 backend/API/DB tests; frontend lint/build đạt. Kiểm thử publication đồng thời, revision thay đổi, chưa duyệt, hủy, chưa đến hạn và trễ quá 24 giờ.

Phần web/API/schema đi kèm được phân theo workflow phụ trách. Mã triển khai với hỗ trợ Codex theo yêu cầu nhóm.
