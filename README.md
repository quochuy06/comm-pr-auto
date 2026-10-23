# PR Workspace — Communication & PR

Ứng dụng Next.js + Express + Prisma/PostgreSQL + n8n + Gemini. **8 workflow, mỗi thành viên phụ trách 2 luồng**: Hoàng (văn bản/ảnh), Huy (kế hoạch/lịch đăng), Bảo (chuyển thể/báo cáo), Phúc (cộng đồng/khủng hoảng). Xem [phân công và nhánh Git](n8n/WORKFLOW_OWNERSHIP.md).

Website có feed mô phỏng và tùy chọn đăng bài đã duyệt lên Facebook Page theo lịch. Tài khoản, dữ liệu, AI và workflow chạy thật. Luồng Facebook cần cấu hình token riêng và nghiệm thu bằng một bài đã duyệt trên Page thật.

## Đăng lên Facebook Page
- Sau khi sao lưu database, chạy `npm run db:migrate` và `npm run db:generate` trong `backend/`.
- Lưu `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_GRAPH_API_VERSION` (ví dụ `v26.0`) trong `.local/facebook.env` ở root, hoặc biến môi trường backend. Dùng token Page, không dùng token tài khoản cá nhân. Không commit hoặc gửi token vào frontend/n8n.
- Trong **Kế hoạch & lịch đăng**, kiểm tra đúng tên Page, chọn **Facebook Page**, bài đã duyệt, giờ đăng và xác nhận đăng công khai. Lịch cũ và mặc định vẫn lên feed mô phỏng.
- Hỗ trợ bài Facebook với ảnh PNG/JPEG lưu nội bộ, tối đa 6 MB. Workflow n8n Publishing hiện có tiếp tục kiểm tra lịch mỗi phút. Khi thành công, lịch có ID và nút xem bài Facebook.
- Token hết hạn/thiếu quyền: sửa cấu hình và đặt lại lịch lỗi. Khi trạng thái **Cần đối soát Facebook**, không gửi lại: quản trị viên kiểm tra Page rồi nhập ID `PageID_PostID` để xác minh bài đã có. Nếu chưa tìm thấy bài, giữ lịch để điều tra; không có tự động mở khóa/gửi lại khi kết quả chưa rõ.
- Backend giữ khóa bài đang gửi, chặn callback/lịch lặp và không tự đăng lại khi mạng mất phản hồi. Thông cáo khủng hoảng vẫn cần người duyệt và chỉ hiển thị trong web.
- Kiểm thử tự động dùng Facebook giả lập; kiểm tra token đọc Page không thay thế nghiệm thu đăng thật. Hướng dẫn chi tiết trên máy: `docs/FACEBOOK_SETUP.md`.

### Bình luận, phản hồi và số liệu Facebook

- Cấp đủ `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `read_insights`. Trên ứng dụng chưa phát hành, quyền đọc người dùng bên ngoài có thể bị giới hạn bởi chế độ phát triển/App Review.
- Tự khám phá bài đã xuất bản trên toàn Page đang kết nối, gồm bài đăng trực tiếp và bài cập nhật ảnh đại diện; nhập một lần để theo dõi, không đăng lại. Đồng bộ bình luận cấp đầu khoảng 2 phút/lượt, tối đa 5 bài và 2.000 bình luận/bài/lượt. Mỗi lượt khám phá đọc tối đa 10.000 bài; nếu chưa đầy đủ sẽ ghi cảnh báo trong log backend. Feed có nút đồng bộ thủ công và nhãn Facebook/Mô phỏng. Phân trang chưa đầy đủ được báo rõ; không suy luận bình luận bị xóa từ việc thiếu trong kết quả API.
- Phản hồi Facebook mặc định qua người duyệt hiệu đính, tích xác nhận công khai và bấm **Duyệt và gửi Facebook**. Có thể bật mẫu tự động theo quy tắc ở dưới. Hàng gửi bền vững chạy mỗi 30 giây, kiểm tra lại bình luận gốc trước khi gửi, không tự gửi lại nếu kết quả chưa rõ. ADMIN có thể đối soát bằng ID phản hồi; chỉ phản hồi chắc chắn thất bại mới được thử lại.
- Feed hiển thị snapshot reactions/comments/shares và Views (`post_media_view`, nếu khả dụng). Worker lấy snapshot khoảng 15 phút; có thể lấy ngay bằng nút trên bài. Chỉ số API không cung cấp là `null`, không biến thành 0. Báo cáo/CSV lưu nguồn bình luận và snapshot gần nhất thu thập trong kỳ; đó là số tích lũy của bài, không phải lượt tăng trong kỳ.
- Webhook `/api/facebook/webhook` hỗ trợ GET challenge và POST xác minh HMAC SHA256 trên body gốc; feed events được lưu, chống lặp và xử lý bằng worker. Cần URL HTTPS trỏ về backend, cấu hình callback trong Meta App, đăng ký trường `feed` và đăng ký Page với ứng dụng trước khi nhận được sự kiện thật. `FACEBOOK_WEBHOOK_VERIFY_TOKEN` và `FACEBOOK_APP_SECRET` chỉ ở máy chủ. Localhost dùng đồng bộ định kỳ; webhook chưa đăng ký không ảnh hưởng việc nhập bình luận.
- Đổi token dài hạn: điền `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_USER_ACCESS_TOKEN` mới cùng cấu hình Page trong `.local/facebook.env`, chạy `node backend/scripts/facebook-token.mjs` từ root. Script kiểm tra 7 quyền, đổi User Token, lấy token đúng Page, xác minh danh tính rồi ghi tệp atomically với quyền 0600; lỗi không thay token hiện có. Chỉ gửi credential tới `graph.facebook.com`, không in giá trị. Hạn User Token hiển thị ở **Cài đặt xử lý → Kết nối Facebook**; token Page vẫn có thể bị thu hồi, không tự gia hạn vô hạn.

### Lời chào tự động: comment và Messenger là hai luồng riêng

- ADMIN mở **Cài đặt xử lý → Kết nối Facebook → Trả lời tự động theo mẫu**, sửa hai mẫu với biến `{name}` và bật từng luồng. Tên thiếu sẽ dùng “bạn”. Việc bật/sửa mẫu cần xác nhận cho phép tự gửi; dữ liệu có từ trước thời điểm bật không bị trả lời ngược lại.
- **Bình luận:** chỉ trả lời công khai dưới bình luận. Chỉ gửi mẫu khi AI đã phân tích và reviewer AI đều đạt, rủi ro thấp, không nhạy cảm; AI lỗi/khiếu nại vẫn chờ người duyệt. Không chuyển bình luận thành tin nhắn riêng.
- **Messenger:** chỉ gửi sau khi đọc/xác minh một tin nhắn khách chủ động gửi vào Page, trong cửa sổ 24 giờ. Tối đa một lời chào/người/60 phút; đủ 60 phút rồi khách nhắn tiếp mới được chào lại. Bỏ qua echo của Page; các dấu hiệu nghiêm trọng chuyển trạng thái HUMAN để xem trực tiếp trong hộp thư Page. Đây là lời chào mẫu, chưa phải chatbot tư vấn nhiều lượt. Chế độ chung MANUAL sẽ không gửi tự động.
- Cần thêm `pages_messaging` vào 7 quyền trước, cập nhật User Token rồi chạy `node backend/scripts/facebook-token.mjs --messenger`. Đọc hộp thư qua API Conversations định kỳ khoảng 2 phút; tối đa 100 hội thoại/lượt, 20 tin gần nhất/hội thoại. Có nút đồng bộ ngay và lịch sử trạng thái gửi trong Settings.
- Webhook có thể nhận thêm trường `messages` sau khi đăng ký callback HTTPS và Page với ứng dụng. Raw body phải có HMAC đúng; echo/ngoài Page bị bỏ qua. Localhost dùng polling nên không phản hồi tức thì.
- Hàng gửi Messenger lưu ID tin đến và ID gửi; timeout/DB mất sau khi Meta nhận tin chuyển UNCERTAIN, không tự gửi lại. Tắt hoặc đổi mẫu hủy hàng gửi tự động cũ chưa thực hiện. Kiểm tra trực tiếp hộp thư Page khi chưa rõ kết quả; UI không khẳng định đã gửi khi chỉ mới xếp hàng.

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
