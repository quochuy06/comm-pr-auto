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

Huy phụ trách phần mở rộng workflow Publishing trên nhánh `codex/huy-facebook-publishing`: schema lưu kết quả gửi, adapter Facebook, khóa bài/lịch khi gửi, đối soát lỗi chưa rõ kết quả, giao diện chọn nơi xuất bản và kiểm thử đi kèm. Tiếp tục dùng workflow n8n Publishing hiện có, token chỉ nằm phía backend.

- Bài đã duyệt có thể đặt lịch lên feed mô phỏng hoặc Facebook Page; lịch cũ giữ nguyên kênh mô phỏng.
- Đã nghiệm thu một bài có ảnh trên Page Hiên Cà Phê lúc 12:25:06 ngày 22/10/2026 và đọc lại từ Meta API để kiểm tra nội dung/ảnh.
- 30/30 kiểm thử backend/API/DB đạt; lint, TypeScript, production build bằng Webpack và browser desktop/mobile đạt.
- Bình luận, phản hồi, số liệu Facebook và quản lý token dài hạn chưa thuộc commit Publishing này.
