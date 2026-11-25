# BAO-UI03/04 — Hàng duyệt trả lời hai kênh & nội dung/trạng thái gửi PR (25/11/2026)

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

PR ở đây là bình luận PR của Page dưới bài do hệ thống đăng (PrContent/PrOutbox
theo HUY-API02) — KHÔNG phải trả lời khách hàng (thuộc BAO-UI03 và giao diện
cộng đồng). Trang panel riêng: route `/studio/pr` (nút "Bình luận PR (nội bộ)"
trong Content Studio); phần compact trên post card ở Feed.

Bản đồ trang `/studio/pr`:
- Chế độ PR của Page: GET `/api/pr/config` — hiển thị mode (OFF/SEMI_AUTO/AUTO)
  và version. ADMIN đổi mode qua PUT `/api/pr/config` gửi kèm version hiện tại
  (CAS); máy chủ từ chối 409 khi version đổi → trang tải lại giá trị mới.
- Nội dung PR: GET `/api/pr/content` — mỗi bản ghi hiển thị text, version,
  status (DRAFT/APPROVED/ARCHIVED), createdBy, reviewedBy, createdAt. Tạo bản
  nháp qua POST `/api/pr/content` {text}; duyệt bản nháp qua POST
  `/api/pr/content/:id/approve`.
- Hàng đợi gửi PR (outbox): GET `/api/pr/outbox` — bảng publicationKey, postId
  (+ scheduleId), contentSnapshot (text + version tại thời điểm tạo, "—" nếu
  không có), status (PENDING/SENT/FAILED/UNCERTAIN), externalId, error,
  createdAt. Trạng thái hiển thị đúng dữ liệu lưu trữ; luồng gửi thật
  (PHUC-WF04/HUY-WF04) chưa triển khai — không có thao tác gửi, không bao giờ
  tự hiển thị "đã gửi" nếu dữ liệu không ghi vậy.

Feed (`/simulator`): trên post card của bài đã xuất bản, khối "Bình luận PR của
Page (nội bộ)" liệt kê các bản ghi outbox khớp theo postId/scheduleId của bài
(status, publicationKey, contentSnapshot.text, externalId, error) kèm liên kết
"Duyệt riêng tại panel PR" — duyệt cùng bài (compact) hoặc duyệt riêng (panel)
đều ghi rõ không phải trả lời khách.

Ma trận quyền (theo backend HUY-API02):
- Xem config/nội dung/outbox: mọi vai trò đã đăng nhập.
- Tạo nội dung PR (POST `/api/pr/content`): ADMIN/EDITOR.
- Duyệt nội dung PR (POST `.../approve`): ADMIN/REVIEWER (bản ARCHIVED bị khóa).
- Đổi chế độ PR (PUT `/api/pr/config`): ADMIN.
- Tạo outbox (POST `/api/pr/outbox`): ADMIN/EDITOR theo backend; UI không phơi
  thao tác này vì gắn với publication của hệ thống đăng bài.

Trạng thái giao diện: đang tải, rỗng ("Chưa có nội dung PR nào.", "Chưa có bản
ghi PR nào trong hàng đợi gửi."), lỗi API qua Notice; thao tác thành công hiện
thông báo ngắn rồi tải lại (polling 8 giây).

## Kiểm thử

- ESLint, `tsc --noEmit` và build production (Next.js/Turbopack) đều pass trước
  mỗi commit.
