# Quốc Huy — Kế hoạch và lịch đăng

Nhánh cuối kỳ `feat/huy-publishing-operations`. Hai workflow nền được bàn giao trên `feat/huy-planning-publishing-v2`.

- `huy-01-planning.json`: 22 node, `plan-campaign`. HUY-WF01: kiểm tra đầu vào (brief khác rỗng, count 1–20) trước khi gọi AI; nạp tri thức đã duyệt qua Knowledge API `answer-context` (lỗi → `INSUFFICIENT`, không bịa) kết hợp giọng thương hiệu vào prompt; mỗi ý tưởng có `contentKind` POST/IMAGE/VIDEO; kết quả kèm `groundedSources`/`knowledgeStatus`, lưu artifact chờ người duyệt (`requiresHuman=true`), không tự xuất bản.
- `huy-02-publishing.json`: 12 node, chạy mỗi phút hoặc webhook có token `publish-due`. Lấy tối đa 50 lịch đến hạn, backend xuất bản trong transaction, ghi kết quả.
- Trang `/planning`: tạo/duyệt kế hoạch, tạo bài từ từng ý tưởng (chống trùng), đặt và hủy lịch.
- Chỉ bài APPROVED đầy đủ mới được đặt lịch; khi đăng kiểm tra lại hash nội dung/ảnh/nền tảng/người duyệt. Lịch trễ quá 24 giờ chuyển FAILED, cần đặt lại.
- Feed chỉ hiển thị PUBLISHED/CRISIS_ALERT. Dữ liệu APPROVED cũ giữ nguyên, cần đặt lịch để xuất hiện lại.
- Schema bổ sung WorkflowArtifact/PostSchedule, không xóa dữ liệu. Artifact dùng chung cho các phần tiếp theo.
- Job FAILED có thể thử lại từ web; callback cũ/lặp không ghi đè kết quả.

Kiểm tra ở bản nền v2: 20/20 backend/API/DB tests; frontend lint/build đạt. Kiểm thử publication đồng thời, revision thay đổi, chưa duyệt, hủy, chưa đến hạn và trễ quá 24 giờ.

Phần web/API/schema đi kèm được phân theo workflow phụ trách. Mã triển khai với hỗ trợ Codex theo yêu cầu nhóm.

Hợp đồng, ca kiểm thử và kịch bản HUY-WF01 xem tại [bàn giao lập kế hoạch](../../backend/docs/HUY-WF01.md).
