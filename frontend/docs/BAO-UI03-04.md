# BAO-UI03/04 — Hàng duyệt trả lời hai kênh & nội dung/trạng thái gửi PR (13/11/2026)

## BAO-UI03 — Hàng duyệt trả lời (route /replies)

Trang tiêu dùng API PHUC-API03 (`/api/reply-decisions`). Thêm mục "Hàng duyệt
trả lời" vào sidebar (shell.tsx).

Bản đồ trang:
- Bộ lọc: kênh (Tất cả / Bình luận / Messenger) và trạng thái duyệt (Tất cả /
  Chờ xử lý / Đã duyệt / Từ chối) — lọc qua query `?channel=&status=` của API.
- Tab "Chi tiết & thao tác": mỗi quyết định một card hiển thị bản gốc
  (inboundText), reply đề xuất (replyText), nguồn (sourceSnapshot.sources dạng
  `id · vversion`; rỗng/null hiện "Không có nguồn tri thức"), luật (ruleId hoặc
  "Không khớp luật"), lý do chuyển duyệt (reason, "—" nếu không có), nhãn kênh
  (COMMENT/MESSENGER), chế độ (OFF/SEMI_AUTO/AUTO), loại quyết định
  (PENDING_APPROVAL/READY_TO_SEND/SKIPPED/NEEDS_HUMAN) và trạng thái duyệt
  (PENDING/APPROVED/REJECTED) — tất cả nhãn tiếng Việt qua `label()` trong
  ui.tsx; trường không rõ giá trị hiển thị "—".
- Tab "Lịch sử & đối soát": bảng thời điểm tạo, kênh, bản gốc (cắt 100 ký tự),
  trạng thái, người duyệt, thời điểm duyệt, liên kết inbound (inboundId hoặc
  "—") và cột đối soát gửi luôn hiển thị "CHƯA GỬI" — gửi thật thuộc PHUC-WF06
  chưa triển khai, không có API gửi/đối soát nên trạng thái gửi chưa được theo
  dõi; UI không bao giờ tuyên bố đã gửi.

Ma trận quyền (theo backend PHUC-API03):
- Xem danh sách/chi tiết: mọi vai trò đã đăng nhập.
- Sửa reply (PATCH `/reply-decisions/:id`): ADMIN/REVIEWER, chỉ khi PENDING.
- Duyệt (POST `.../approve`): ADMIN/REVIEWER, chỉ khi PENDING; quyết định
  NEEDS_HUMAN bị khóa nút duyệt (backend trả 409) — chỉ sửa hoặc từ chối.
- Từ chối (POST `.../reject` {reason}): ADMIN/REVIEWER, chỉ khi PENDING, reason
  bắt buộc.
- EDITOR: chỉ xem; form thao tác bị khóa kèm giải thích.

Trạng thái giao diện: đang tải ("Đang tải hàng duyệt trả lời…"), rỗng ("Không
có quyết định phản hồi nào khớp bộ lọc."), lỗi từ API hiển thị qua Notice; thao
tác thành công hiện thông báo ngắn rồi tải lại danh sách (polling 8 giây).

## BAO-UI04 — Nội dung PR & trạng thái gửi (Studio/Feed)

(Đang cập nhật ở commit BAO-UI04.)

## Kiểm thử

- ESLint, `tsc --noEmit` và build production (webpack) đều pass trước mỗi commit.
