# Phân công workflow v2 — 4 thành viên, mỗi người 2 workflow

Đây là phần mở rộng sau bản giữa kỳ. Mỗi người phụ trách workflow và API/giao diện/kiểm thử đi kèm. Mã được triển khai với hỗ trợ Codex theo yêu cầu của nhóm; tên Git dùng theo chỉ dẫn và lịch sử tác giả đã xác nhận.

| Thành viên / Git author | Nhánh mới | Workflow và tài liệu |
| --- | --- | --- |
| Đức Hoàng — `DucHoang` | `feat/hoang-content-image-v2` | [Văn bản + ảnh](members/HOANG.md) |
| Quốc Huy — `QuocHuy` | `feat/huy-planning-publishing-v2` | [Kế hoạch + lịch đăng](members/HUY.md) |
| Quốc Bảo — `QuocBao` | `feat/bao-repurpose-reporting-v2` | [Chuyển thể + báo cáo](members/BAO.md) |
| Hữu Phúc — `HuuPhuc` | `feat/phuc-community-crisis-v2` | [Cộng đồng + khủng hoảng](members/PHUC.md) |

## Nhánh tích hợp và phụ thuộc

`integration/eight-workflows-v2` là bản chạy đủ 8 workflow và gồm tài liệu/kiểm thử tích hợp cuối.

Các nhánh được xếp nối tiếp để giữ phụ thuộc backend/schema:

```text
main (bản trước mở rộng)
  └─ Hoàng: tách Content/Image, callback nối hai job
      └─ Huy: Artifact dùng chung, Planning/Scheduling, trang /planning
          └─ Bảo: Repurpose/Report, trang /insights
              └─ Phúc: Community/Crisis V2, kiểm tra bằng chứng
                  └─ integration/eight-workflows-v2: bàn giao và kiểm thử cuối
```

Nhánh sau có commit nền của người trước; không có nghĩa toàn bộ thay đổi trên nhánh sau thuộc người đó. So sánh từng nhánh với nhánh ngay trước để xem phần riêng. Nhánh main không được tự merge trong đợt này.

Các commit lõi:

- Hoàng `78750df`: tách hai workflow và cơ chế nối văn bản → ảnh.
- Huy `af5c4cb`: kế hoạch và xuất bản đúng phiên bản duyệt.
- Bảo `8bc9a94`: chuyển thể và báo cáo snapshot.
- Phúc `46ae824`: phân loại vấn đề và khủng hoảng có dẫn chứng; `3d69da2` sửa kiểm thử trình duyệt cho bước xuất bản.

Tên JSON có tiền tố thành viên; các hàm generator nằm trong `scripts/members`. Giữ ID n8n Content/Community/Crisis cũ, thêm năm workflow. Các nhánh cũ từ giữa kỳ giữ nguyên.

## Kết quả kiểm tra tích hợp

- Backend/API/DB: 26/26 kiểm thử đạt; frontend ESLint, TypeScript và production build đạt.
- Trình duyệt desktop/mobile: cả hai trang mới và các trang cũ không tràn ngang; quyền EDITOR/REVIEWER đúng.
- Quy trình người duyệt: duyệt bài → đặt lịch/xuất bản → duyệt phản hồi → ẩn/hiện bình luận → duyệt thông cáo đạt; fixture được dọn sau test.
- Chạy n8n và dịch vụ thật: Publisher, Planning, Repurpose, Report, Community, Crisis, Content đều SUCCEEDED; Image tải VERIFIED và đánh giá PASS.
- Kết quả riêng tư: `.local/workflow-v2/live-results.json`; không đưa credential, dữ liệu thực thi hoặc backup lên Git.
- Một lượt chạy thành công không bảo đảm hạn mức và tính sẵn sàng của dịch vụ ngoài. Chính sách lỗi/duyệt được giữ nguyên.

## Kịch bản trình bày theo người

1. Huy tạo kế hoạch; reviewer duyệt; chọn ý tưởng tạo bài.
2. Hoàng giải thích hai job văn bản/ảnh, thử lại riêng ảnh và điều kiện tự duyệt.
3. Huy đặt lịch; bài chỉ xuất hiện trên feed sau khi được xuất bản.
4. Phúc thêm bình luận, giải thích phân loại và ngưỡng khủng hoảng; thông cáo cần người duyệt.
5. Bảo tạo các phiên bản nền tảng, xem báo cáo theo kỳ và xuất CSV.

Báo cáo tuần tự động chạy thứ Hai 08:00 giờ Việt Nam; có thể tạo theo kỳ trên web để demo ngay. Chuyển thể đa nền tảng chưa đồng nghĩa đăng thật lên từng mạng xã hội.

## Bổ sung Facebook Publishing — 22/10/2026

Huy phụ trách phần mở rộng workflow Publishing trên nhánh `feat/huy-facebook-publishing`: schema lưu kết quả gửi, adapter Facebook, khóa bài/lịch khi gửi, đối soát lỗi chưa rõ kết quả, giao diện chọn nơi xuất bản và kiểm thử đi kèm. Tiếp tục dùng workflow n8n Publishing hiện có, token chỉ nằm phía backend.

- Bài đã duyệt có thể đặt lịch lên feed mô phỏng hoặc Facebook Page; lịch cũ giữ nguyên kênh mô phỏng.
- Đã nghiệm thu một bài có ảnh trên Page Hiên Cà Phê lúc 12:25:06 ngày 22/10/2026 và đọc lại từ Meta API để kiểm tra nội dung/ảnh.
- 30/30 kiểm thử backend/API/DB đạt; lint, TypeScript, production build bằng Webpack và browser desktop/mobile đạt.
- Bình luận, phản hồi, số liệu Facebook và quản lý token dài hạn chưa thuộc commit Publishing này.

## Facebook Community/Insights — phần bổ sung 22/10/2026

Bản đầy đủ nằm trên `feat/facebook-community-insights`, dựa trên Publishing (`4243141`). Commit được xếp nối tiếp theo phụ thuộc: Huy transport/token → Phúc Community/Inbox → Bảo Reporting/UI → Huy runtime/bàn giao.

- Phúc: schema bình luận/event/outbox, đồng bộ bình luận thật, webhook ký HMAC, phản hồi qua người duyệt, chống gửi trùng/đối soát; API/callback, Feed/Approval và kiểm thử Community. Prompt Community bổ sung yêu cầu không bịa địa chỉ/tiện ích, tôn trọng bối cảnh thương hiệu demo.
- Bảo: snapshot số liệu Facebook trong báo cáo/CSV, hiển thị nguồn bình luận và số liệu thiếu là null; controls lấy số liệu và bảng kết nối ở Settings.
- Huy: script đổi token dài hạn, transport Facebook dùng chung, worker/polling và hướng dẫn cấu hình webhook. Giữ token bên backend, giữ workflow ID/credential hiện có.
- Chưa có URL HTTPS để đăng ký webhook công khai; localhost dùng polling. Chỉ các bài Facebook đã xuất bản qua hệ thống được đồng bộ; hiện lấy bình luận cấp đầu.


### Tự trả lời mẫu — 22/10/2026
Phúc phụ trách cấu hình/điều kiện tự trả lời comment và lời chào Messenger chỉ sau inbound, hàng gửi và kiểm thử; Bảo phụ trách UI sửa mẫu/lịch sử tại Settings; Huy phụ trách transport/polling/webhook và script kiểm tra8 quyền. Không dùng comment-to-DM. Hai luồng đã nghiệm thu SENT trên Page thật; mẫu hiện tại dùng đủ Hiên Cà Phê theo yêu cầu. Messenger chống lặp lời chào 60 phút/người; comment không có cooldown này.


## Git bàn giao Facebook — 22/10/2026

- Huy: `feat/huy-facebook-runtime`, transport và script đổi token, cuối chuỗi bổ sung startup worker/README/bàn giao.
- Phúc: `feat/phuc-facebook-community` (`3e2847c`), bình luận/webhook/hàng gửi và chính sách tự động; chỉ có inbound Messenger mới tạo lời chào riêng.
- Bảo: `feat/bao-facebook-insights`, snapshot/CSV, dữ liệu hiển thị và giao diện sửa mẫu/trạng thái.
- Nhánh đầy đủ: `feat/facebook-community-insights`. Các nhánh thành viên được xếp nối tiếp, giữ nguyên tác giả của commit nền; dùng nhánh đầy đủ để chạy demo. Main chưa được cập nhật trong đợt push này.
- Schema/migrations/API nền dùng chung nằm trong commit Community của Phúc; ghi đồng tác giả Bảo cho phần số liệu và Huy cho worker/lifecycle, thay vì gán phần dùng chung cho một người. Các tệp UI/types/controller dùng chung được stage theo delta của từng chủ sở hữu.
- 35/35 backend/API/DB tests đạt, gồm mốc Messenger 59:59.999 và đúng60phút; lint/TypeScript đạt. Production build Webpack và browser desktop/mobile đã nghiệm thu trên cùng source; không gửi Meta thật trong bộ test. Token, backup và media vẫn ở tệp riêng bị Git ignore.

## Phản hồi mẫu không chờ AI — 23/10/2026

Theo yêu cầu mới: lời chào cố định cho comment và Messenger không phụ thuộc kết quả AI; phân tích rủi ro chạy riêng, thông cáo khủng hoảng vẫn cần người duyệt. Giữ xác minh nguồn, chống gửi trùng, đối soát UNCERTAIN và cooldown Messenger 60 phút.

- Phúc — `codex/phuc-template-replies`: chính sách mẫu comment/Messenger và kiểm thử AI chưa chạy/lỗi.
- Huy — `codex/huy-webhook-reply-latency`: webhook đánh thức worker sau lưu sự kiện, hàng gửi mỗi giây, polling dự phòng khoảng 15 giây; tài liệu vận hành.
- Bảo — `codex/bao-template-reply-ui`: giao diện giải thích đúng việc gửi mẫu không chờ AI và chu kỳ đồng bộ mới.

Các nhánh xếp nối tiếp Phúc → Huy → Bảo để giữ phụ thuộc; bản đầy đủ được tích hợp vào main theo yêu cầu. Không đổi schema/migration, token hoặc workflow n8n. Thời gian thực tế còn phụ thuộc Meta, lượng dữ liệu và thời gian gọi API; không cam kết gửi tức thì tuyệt đối.
