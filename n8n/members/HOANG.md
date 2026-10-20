# Đức Hoàng — Content và Image

Đợt mở rộng workflow v2; nhánh `feat/hoang-content-image-v2`.

- `hoang-01-content.json`: 17 node, webhook `generate-post`, soạn và kiểm tra văn bản, callback `content-text`.
- `hoang-02-image.json`: 13 node, webhook `generate-image`, tải ảnh, kiểm tra bytes bằng Gemini vision, callback `content`.
- Callback văn bản lưu bài chờ duyệt, hoàn tất job văn bản rồi tạo một job IMAGE_ONLY trong cùng transaction. Callback lặp/cũ không tạo ảnh thêm.
- Chỉ callback ảnh mới áp dụng chính sách duyệt tổng hợp. Lỗi ảnh giữ nguyên bài, không tự duyệt. Có thể gọi lại riêng ảnh từ Studio.
- Generator chung: `workflow-builder.mjs`; phần sở hữu: `scripts/members/hoang.mjs`. Installer giữ ID Content cũ, bổ sung ID Image riêng.
- Job QUEUED được tiếp tục khi backend restart; job RUNNING chuyển lỗi để người dùng thử lại, tránh đoán kết quả dịch vụ ngoài.

Kiểm tra: `cd backend && RUN_DB_TESTS=true npm test` (16/16 tại commit nền). Test mới dùng HTTP giả lập cục bộ, không gọi Gemini/Pollinations.

Phân công này ghi trách nhiệm bàn giao; mã được triển khai với hỗ trợ Codex theo yêu cầu nhóm.
