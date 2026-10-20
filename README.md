# PR Workspace — Communication & PR

Ứng dụng Next.js + Express + Prisma/PostgreSQL + n8n + Gemini. **8 workflow, mỗi thành viên phụ trách 2 luồng**: Hoàng (văn bản/ảnh), Huy (kế hoạch/lịch đăng), Bảo (chuyển thể/báo cáo), Phúc (cộng đồng/khủng hoảng). Xem [phân công và nhánh Git](n8n/WORKFLOW_OWNERSHIP.md).

Website dùng feed mô phỏng, còn tài khoản, dữ liệu, AI và workflow chạy thật. Facebook Page dành cho giai đoạn cuối kỳ.

## Máy hiện tại
- Web: http://localhost:3000
- Backend health: http://localhost:5000/health
- n8n: http://localhost:5678
- Tài khoản demo: `.local/demo-accounts.json` (ADMIN, EDITOR, REVIEWER; không đưa lên Git).
- Dữ liệu/credential và backup riêng: `.local/`; ảnh đã tải: `backend/storage/media/`.
- PostgreSQL container: `comm_pr_postgres`; n8n đang dùng: `n8n`, volume `n8n_n8n_data`.

Không chạy thêm Compose trên máy này khi hai container đã chạy: cấu hình Compose dành cho máy mới, không tự gắn vào các volume đang dùng.

## Chạy ứng dụng
Terminal backend:
```bash
cd backend
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```
`backend/.env` cần DATABASE_URL, PORT, N8N_BASE_URL và N8N_CALLBACK_SECRET. Tham khảo `backend/.env.example`; secret nội bộ phải là chuỗi ngẫu nhiên ít nhất 32 ký tự, giống credential `Comm PR Internal Token` trong n8n. Không thay secret khi chưa cập nhật credential.

Tạo ảnh cần key **Pollinations riêng**, không dùng key Gemini. Lấy key tại https://enter.pollinations.ai, đặt `POLLINATIONS_API_KEY` trong `backend/.env`; model mặc định `POLLINATIONS_IMAGE_MODEL=flux`. Khởi động lại backend sau khi sửa `.env`. Backend gửi key bằng header đến `https://gen.pollinations.ai/image/`; không đưa key vào frontend hay workflow JSON. Tài khoản/key phải còn hạn mức cho model đã chọn.

Nếu thiếu key hoặc dịch vụ ảnh lỗi, nội dung vẫn được lưu ở hàng đợi duyệt, yêu cầu có trạng thái `PARTIAL` (cần xử lý ảnh) và không tự duyệt. Sau khi cấu hình xong, vào Studio chọn bài → **Thử lại riêng ảnh**; không cần tạo lại toàn bộ bài. Lỗi kiểm tra ảnh cũng có thể thử lại riêng bước kiểm tra.

Terminal frontend:
```bash
cd frontend
npm ci
npm run dev
```
Frontend gọi `/api` cùng origin; Next.js proxy về `http://127.0.0.1:5000`. Nếu đổi backend, đặt `BACKEND_URL` ở môi trường frontend. `NEXT_PUBLIC_API_URL` cũ không còn được dùng. Nếu đổi origin/port web, sửa `FRONTEND_ORIGIN` backend cho khớp. Demo mặc định chạy `localhost:3000`.

Bản production:
```bash
cd frontend
npm run build
npm start
```

## Workflow
Xem [hướng dẫn n8n](n8n/README.md). Instance hiện tại đã cài tám workflow và credential. Chỉ cài lại khi thay đổi JSON:
```bash
node n8n/scripts/build-workflows.mjs
python3 n8n/scripts/install-local.py
```
Script cài đặt sao lưu trước khi thay đổi và restart n8n. Không chạy lúc workflow đang xử lý yêu cầu. Không commit export chứa API key hoặc dữ liệu thực thi.

## Chức năng mở rộng
- `/planning`: lập kế hoạch chiến dịch, duyệt ý tưởng, tạo bài và đặt/hủy lịch đăng.
- `/insights`: chuyển thể bài đã duyệt sang Facebook/LinkedIn/X, báo cáo theo kỳ và tải CSV.
- Lịch đăng quét mỗi phút, kiểm tra lại phiên bản duyệt và chống đăng trùng. Lịch trễ quá 24 giờ chuyển lỗi để người dùng đặt lại.
- Báo cáo tuần trước tự tạo thứ Hai 08:00 giờ Việt Nam; số liệu từ database, nhận xét AI chờ người duyệt.
- Các migration mới chỉ bổ sung dữ liệu. Sau pull cần `npm run db:migrate`, `npm run db:generate`, sinh/cài lại workflow và khởi động backend; frontend cần build lại.

## Quyền và quy tắc
| Vai trò | Chức năng |
| --- | --- |
| ADMIN | Tất cả, gồm cài đặt chế độ/ngưỡng |
| EDITOR | Tạo/sửa chiến dịch, tạo/tạo lại bài, xem dữ liệu và bình luận |
| REVIEWER | Duyệt/từ chối bài và phản hồi, ẩn bình luận, xử lý khủng hoảng |

- Mặc định tự động có điều kiện, có thể đổi sang thủ công.
- Bài PR: đủ nội dung, ảnh tải thật, Gemini kiểm tra ảnh thực tế đạt PASS, rủi ro thấp và kiểm tra văn bản đạt mới tự duyệt. **Duyệt không tự đăng**: vào Kế hoạch & lịch đăng để đặt giờ. Feed chỉ hiển thị PUBLISHED/CRISIS_ALERT. Bài APPROVED cũ giữ nguyên, cần đặt lịch để xuất bản.
- Bình luận: chỉ tự trả lời nội dung tích cực/trung tính, không nhạy cảm, qua kiểm tra.
- Khủng hoảng: dấu hiệu nghiêm trọng hoặc ngưỡng tiêu cực trong cửa sổ theo dõi; thông cáo luôn chờ người duyệt.
- Hết quota/lỗi AI: FAILED, không tự duyệt; người dùng thử lại ở Studio/Approval/Alerts.
- Session cookie HttpOnly, SameSite; API có kiểm tra origin và quyền. Callback/webhook dùng token, job ID và kiểm tra trạng thái để bỏ qua kết quả cũ/lặp.

## Kiểm tra
```bash
cd backend
npm test
RUN_DB_TESTS=true npm test
```
Test tích hợp cần PostgreSQL đã migrate và token trong `.env`; chỉ tạo/xóa dữ liệu test có ID riêng. Không gọi Gemini trong test tích hợp.
```bash
cd frontend
npm run lint
npm run build
```
Kiểm thử trình duyệt local (Playwright nằm ngoài dependency ứng dụng):
```bash
npm install --prefix .local/browser-tools playwright
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" .local/browser-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" node scripts/browser-smoke.mjs
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" node scripts/browser-business.mjs
```
Chạy từ root, frontend/backend đang bật và đã seed. Ảnh chụp nằm trong `.local/`.

Kiểm tra nhanh trước buổi demo (không gọi AI): `node scripts/demo-preflight.mjs`.
Model đã thử thành công: `gemini-3.5-flash-lite`. Kết quả kiểm tra cuối và dữ liệu dự phòng lưu local tại `docs/FINAL_DEMO_CHECK_2026-10-15.md`. Đợt mở rộng v2 đã kiểm tra lại đủ tám workflow với dịch vụ thật, gồm tải ảnh VERIFIED và đánh giá PASS; xem `n8n/WORKFLOW_OWNERSHIP.md`. Kết quả mỗi lần chạy vẫn phụ thuộc hạn mức dịch vụ.

## Tài liệu nhóm
- Bộ nhớ phạm vi và tiến độ: `docs/IMPLEMENTATION_PLAN.md`
- Bàn giao file theo thành viên/nhánh: `docs/HANDOFF.md`
- Kịch bản báo cáo và test chung: `docs/DEMO.md`
- Kết quả kiểm tra và giới hạn: `docs/VALIDATION.md`

Các tài liệu nhóm trên được giữ local trong `docs/`, không nằm trong bản Git. Credential, backup và kết quả chạy cũng được giữ local, không commit.
