# Hữu Phúc — Community và Crisis

Nhánh `feat/phuc-community-crisis-v2`, dựa trên `feat/bao-repurpose-reporting-v2`.

- `phuc-01-community.json`: 18 node, webhook `analyze-comment`. Bổ sung loại vấn đề, mức ưu tiên. Khiếu nại, an toàn, pháp lý hoặc ưu tiên HIGH luôn chuyển người duyệt, kể cả AI gắn sentiment tích cực.
- `phuc-02-crisis.json`: 18 node, webhook `handle-crisis`. Yêu cầu evidenceIds trỏ đúng bằng chứng và 1–10 bước xác minh; kiểm tra cả workflow lẫn backend. Thông cáo luôn chờ người duyệt.
- Hợp đồng job `V2` áp dụng cho yêu cầu Community/Crisis mới. Callback các job cũ vẫn tương thích; job V2 thiếu metadata sẽ thất bại.
- Feed hiển thị loại vấn đề/ưu tiên. Trang cảnh báo có các bước xác minh. Đổi nhãn duyệt bài theo quy trình duyệt → lên lịch → đăng.
- Giữ ID n8n Community/Crisis khi cập nhật; file JSON đổi tên theo thành viên để rõ trách nhiệm.

Kiểm tra: 26/26 backend/API/DB tests; lint/build frontend đạt. Integration test xác nhận metadata V2 qua callback thật, giữ cổng duyệt thủ công khủng hoảng.

Mã triển khai với hỗ trợ Codex theo yêu cầu nhóm; phân công thể hiện phần bàn giao.
