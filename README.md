# PR Workspace — Communication & PR

Ứng dụng nhóm: Next.js + Express + Prisma/PostgreSQL + n8n + Gemini. Feed được mô phỏng; tài khoản, dữ liệu, phân quyền và workflow dùng backend thật. Chưa tích hợp đăng Facebook.

## Phạm vi bản Git hiện tại

- Hoàng: database, session/phân quyền, API bài viết/chiến dịch, dashboard/settings và hàng đợi workflow.
- Phúc: duyệt bài, callback, bình luận/phản hồi, cảnh báo và thông cáo luôn cần người duyệt.
- Bảo: shell, đăng nhập, dashboard, chiến dịch, Studio, settings và component chung.
- Huy: Docker, cấu hình Git, workflow Community/Crisis và công cụ kiểm tra.

**Phần xử lý ảnh đang được giữ lại để sửa.** Controller chuẩn bị ảnh, workflow Content/Visual 24 node và các nút tạo lại/kiểm tra riêng ảnh chưa có trong bản Git này. File Content cũ được giữ nguyên lịch sử, chưa tương thích đầy đủ hợp đồng job mới; không dùng file đó để xác nhận demo tạo bài hoàn chỉnh. Một số schema/dịch vụ ảnh đã nằm trong commit Hoàng/Phúc trước khi quyết định hoãn, nhưng không có nghĩa luồng ảnh đã chạy được.

Giao diện chỉ hiển thị kết quả ảnh hiện có. Lỗi ảnh không được tự duyệt. Bản local tích hợp đầy đủ và dữ liệu demo trên máy nhóm được giữ riêng; cần hoàn tất và kiểm tra phần ảnh trước khi trình diễn toàn bộ luồng tạo bài.

## Chạy ứng dụng

Chuẩn bị PostgreSQL, sao chép `backend/.env.example` thành `backend/.env` và điền cấu hình. Không đưa key/mật khẩu lên Git. Chạy trong thư mục `backend`:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Backend ở `http://localhost:5000`; `GET /health` kiểm tra database. Seed bổ sung dữ liệu, không xóa dữ liệu cũ; tài khoản lưu riêng tại `.local/demo-accounts.json` ở root dự án.

Chạy trong thư mục `frontend`:

```bash
npm ci
npm run dev
```

Web ở `http://localhost:3000`. Next.js proxy `/api` và `/media` về backend; có thể đổi `BACKEND_URL`. `FRONTEND_ORIGIN` của backend cần khớp địa chỉ web. Production: `npm run build` rồi `npm start`.

Compose dành cho máy mới. Trên máy nhóm đã có PostgreSQL/n8n và dữ liệu, không chạy thêm container để tránh nhầm instance/volume. Tham khảo [hướng dẫn workflow](n8n/README.md) trước khi cài n8n.

## Quyền và quy tắc

| Vai trò | Chức năng |
| --- | --- |
| ADMIN | Quản trị, cấu hình và toàn bộ thao tác |
| EDITOR | Tạo/sửa chiến dịch, soạn bài, xem feed/bình luận |
| REVIEWER | Duyệt bài/phản hồi, moderation và xử lý khủng hoảng |

Bình luận chỉ tự trả lời khi rủi ro thấp và qua kiểm tra. Nội dung tiêu cực/nhạy cảm chuyển người duyệt. Thông cáo khủng hoảng không được AI tự xuất bản. Khi AI lỗi, hệ thống giữ trạng thái lỗi và yêu cầu xử lý tiếp.

## Kiểm tra phạm vi đã bàn giao

Trong `backend`:

```bash
RUN_DB_TESTS=true node --test test/core-api.test.js test/policy.test.js test/workflows.test.js
```

Các test dùng ID riêng và tự dọn fixture; không gọi AI. `image-review.test.js` còn phần kiểm tra workflow ảnh mới, `integration.test.js` còn phần gọi prepare-image: bộ kiểm thử đầy đủ cần các file ảnh đang hoãn, không coi nhánh này đã đạt full suite.

Trong `frontend`: `npm run lint` và `npm run build`.

Từ root: `node scripts/demo-preflight.mjs` kiểm tra dịch vụ/dữ liệu mà không gọi AI. Khi có bài đã duyệt, `node scripts/live-demo.mjs community` hoặc `crisis` chạy thử workflow thật; script chỉ hỗ trợ hai mode này trong bản hiện tại.

Kiểm thử trình duyệt dùng Playwright cài riêng trong `.local/browser-tools`, browser tại `.local/browsers`: `scripts/browser-smoke.mjs` và `scripts/browser-business.mjs`. Backend/frontend phải đang chạy và đã seed. Script business cần banner demo `/media/80191d05-f6ec-4c01-822f-7f13e1279788.jpg` có trên máy nhóm; không dùng làm kiểm tra máy mới khi thiếu fixture ảnh này.

Tài liệu kế hoạch/bàn giao, hướng dẫn trợ lý, credential, backup, media và kết quả chạy được giữ local, không commit. Chưa merge các nhánh thành viên vào `main`.
