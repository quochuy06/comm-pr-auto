# Quốc Bảo — Chuyển thể và báo cáo

Nhánh `feat/bao-repurpose-reporting-v2`, dựa trên `feat/huy-planning-publishing-v2`.

- `bao-01-repurpose.json`: 17 node, `repurpose-content`. Tạo đủ Facebook/LinkedIn/X, giới hạn độ dài, kiểm tra độc lập. Chỉ chuyển thể bài đã duyệt. Bản tạo từ kết quả vẫn chờ duyệt bài/ảnh.
- `bao-02-report.json`: 19 node, `campaign-report`. Backend tính snapshot theo kỳ [from,to), AI chỉ nhận xét. Tự tạo báo cáo tuần trước vào thứ Hai 08:00 Asia/Ho_Chi_Minh; tối đa 100 chiến dịch có bài mỗi lượt, chống trùng campaign/tuần bằng unique key.
- Trang `/insights`: chuyển thể, duyệt kết quả, tạo bài từ phiên bản, báo cáo theo kỳ, CSV số liệu có bảo vệ công thức bảng tính.
- Dấu kiểm tra bài gốc chặn áp dụng phiên bản khi nguồn đổi. Tạo bài từ cùng phiên bản nhiều lần trả cùng ID.
- Báo cáo không có reach/impression giả. Tỷ lệ tiêu cực là null nếu không có bình luận đã phân tích. Bài cũ chưa ghi publishedAt không được tính số bài đăng trong kỳ.
- AI lỗi vẫn giữ snapshot số liệu và cho thử lại. Nhận xét AI cần người duyệt; số liệu gốc không bị callback AI thay đổi.

Kiểm tra tại commit: 24/24 backend/API/DB tests, frontend lint/build đạt. Tests kiểm tra vai trò, callback lặp, nguồn thay đổi, số liệu bất biến, giới hạn X và CSV.

Mã triển khai với hỗ trợ Codex theo yêu cầu nhóm; phân công thể hiện phần bàn giao.
