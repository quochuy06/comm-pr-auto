# Hữu Phúc · G2 phản hồi comment và Messenger

| Mã | Workflow và đầu ra |
| --- | --- |
| PHUC-WF01 | Giữ webhook phân loại bình luận hiện có. Nhánh theo lịch đọc bình luận Facebook đã xác minh và chuyển sang định tuyến khi có kết quả phân loại. Quá thời hạn hoặc phân loại lỗi chuyển người xử lý. |
| PHUC-WF03 | Nhận công việc từ tin nhắn xác minh qua webhook/polling Meta. Gemini phân loại rủi ro trong n8n. Dữ liệu thiếu, lỗi dịch vụ và nội dung nhạy cảm đều đi vào nhánh cần người xử lý. |
| PHUC-WF04 | Ưu tiên luật từ khóa đúng Page và đúng kênh. Lời đáp mẫu của luật cần reviewer. Luật chỉ định tài liệu sẽ giới hạn WF05 của Hoàng vào tài liệu đó. Xung đột luật chuyển reviewer. |
| PHUC-WF05 | Đọc kết quả của workflow tri thức và áp dụng OFF, SEMI_AUTO hoặc AUTO. AUTO chỉ xếp hàng khi có kết quả grounded độc lập và nguồn đúng Page còn APPROVED, đang hoạt động. |
| PHUC-WF06 | N8n yêu cầu gửi bằng ID hàng đợi. Backend giữ transaction claim, tài khoản Meta, kiểm tra lại cấu hình/luật/nguồn và xác minh lại comment hoặc Messenger trong cửa sổ 24 giờ. |
| PHUC-WF07 | Tìm hồ sơ chờ xử lý quá SLA, đánh dấu quá hạn một lần và ghi audit. Thông cáo khủng hoảng giữ quy trình duyệt riêng của WF02. |

## Bật sau khi chuẩn bị

1. Áp dụng migration bổ sung `20261126090000_reply_advice` theo runbook. Mặc định runtime tắt.
2. Cài và publish các workflow qua installer. Giữ nguyên ID của các workflow đang dùng. Gói có bản cập nhật WF05 của Hoàng để nhận ID tài liệu tùy chọn.
3. Đặt `REPLY_ADVICE_ENABLED=true` ở backend khi đã sẵn sàng, rồi chọn chế độ theo từng kênh của Page. Dữ liệu nhập sau phiên bản cấu hình hiện tại mới tham gia. Ngưỡng chuyển cấp mặc định 30 phút, chỉnh bằng `REPLY_ADVICE_SLA_MINUTES`.
4. Các bản ghi reply G2 có `sendStatus`, `sendError`, `externalReplyId` và `escalatedAt`. Duyệt bản G2 yêu cầu cả phiên bản đang xem và xác nhận gửi. Kết quả `UNCERTAIN` cần đối soát trên Page trước khi quyết định xử lý tiếp.

Cấu hình lời chào có vòng đời riêng. Comment đã được xếp vào tư vấn sẽ dành một suất phản hồi cho luồng đó. Messenger tư vấn chỉ xử lý tin nhắn đến đã xác minh, kể cả khi lời chào đang trong thời gian chờ.

Kiểm thử dùng PostgreSQL cô lập, callback Gemini giả lập và adapter Meta giả lập. Bao phủ ba chế độ, sự kiện trùng, giới hạn Page và tài liệu, lỗi AI, thay đổi nguồn hoặc cấu hình, timeout gửi và chuyển cấp SLA.
