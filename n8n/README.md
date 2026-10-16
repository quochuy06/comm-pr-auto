# Ba workflow báo cáo giữa kỳ
Content có 24 node; Community và Crisis có 17 node mỗi luồng. Sinh lại JSON: `node n8n/scripts/build-workflows.mjs`.

1. **Content & Visual Review**: nhận chủ đề → kiểm tra ID → giới hạn ngữ cảnh → prompt theo loại nội dung → Gemini soạn → trích text → parse JSON → validate → rẽ nhánh lỗi → prompt kiểm tra độc lập → Gemini kiểm tra → validate đánh giá → quyết định đề xuất → dựng URL ảnh → backend tải/lưu ảnh → kiểm tra tải thành công → gửi bytes ảnh thực tế cho Gemini → chuẩn hóa kết quả đánh giá ảnh → payload callback → lưu backend → trả kết quả.
2. **Community & Sentiment**: cùng các bước kiểm soát nhưng đầu vào là bình luận + bài viết; phân loại cảm xúc, độ nhạy cảm/rủi ro; tạo phản hồi, kiểm tra phản hồi; backend quyết định tự trả lời hoặc chờ duyệt.
3. **Crisis Communication**: ngữ cảnh gồm bài viết + bằng chứng kích hoạt; tổng hợp sự việc, thông cáo và hành động; kiểm tra độc lập; backend luôn chuyển duyệt thủ công.

Nhánh lỗi không tạo nội dung giả: callback `ok:false` làm job FAILED. Backend xử lý callback bằng token, job ID và version của thực thể; nhận lại callback không gây xuất bản lặp.

## Cài trên máy đang dùng
Không chạy thêm `docker compose up` nếu PostgreSQL/n8n hiện có đã chạy: tránh tạo instance và volume khác. Compose dành cho máy mới. Instance hiện tại tên `n8n`, volume `n8n_n8n_data`.

Từ root chạy `python3 n8n/scripts/install-local.py`. Script sao lưu SQLite riêng, lấy khóa Gemini đang có mà không in ra màn hình, chuyển vào credential `Comm PR Gemini`, tạo credential token nội bộ, giữ ID workflow nội dung, thêm hai workflow, publish và restart n8n. Cần Docker CLI và quyền truy cập container. Backend phải có `N8N_CALLBACK_SECRET` tối thiểu 32 ký tự. Có thể đổi `N8N_CONTAINER` và `BACKEND_CALLBACK_BASE`.

Import thủ công ở máy mới: tạo 2 Header Auth credentials: `Comm PR Gemini` (`x-goog-api-key`) và `Comm PR Internal Token` (`x-comm-token`, giống backend). Gán credential cho node Gemini, Webhook và Callback; chỉnh URL callback theo địa chỉ backend nhìn từ Docker; publish từng workflow. Không đặt secret trực tiếp trong JSON.

## Giới hạn
- Tạo bài mới gọi Gemini tối đa ba lần: soạn, kiểm tra văn bản, kiểm tra ảnh. Community/Crisis dùng hai lần. Tạo lại hoặc kiểm tra riêng ảnh chỉ gọi Gemini một lần khi tải ảnh thành công. Hàng đợi backend chạy tuần tự để hạn chế dồn request; miễn phí vẫn có thể hết quota.
- Gemini nhận bytes ảnh đã lưu qua `inline_data`. Backend gắn kết quả với SHA-256 của ảnh và nội dung, kiểm tra cấu trúc, yêu cầu chủ thể/hành động/chi tiết/bối cảnh đều đúng và confidence >= 0.85. FAIL/UNCERTAIN/ERROR không tự duyệt. Đây là kiểm tra bằng AI, không bảo đảm ảnh chính xác tuyệt đối.
- Ảnh Pollinations là dịch vụ ngoài: lỗi ảnh chuyển bài sang chờ duyệt và báo thiếu banner. Có thể bổ sung ảnh HTTPS thủ công.
- Ngưỡng khủng hoảng và chế độ tự động nằm ở Settings; backend là nơi quyết định cuối cùng.

## Kiểm tra và tạo lại riêng ảnh
- Nhánh `03a`/`03b` giữ nguyên tiêu đề/nội dung cho mode IMAGE_ONLY hoặc REVIEW_IMAGE. Các mode này bỏ qua hai lượt Gemini xử lý văn bản.
- Backend `POST /api/webhooks/prepare-image` xác thực token, job hiện hành, tải ảnh tối đa hai lần khi lỗi tạm thời, lưu bytes và hash. REVIEW_IMAGE dùng lại ảnh `/media/` hiện tại.
- Các node `14a`–`14e` kiểm tra ảnh thật. Nếu tải lỗi hoặc Gemini vision lỗi, bài vẫn chờ người duyệt.
- `POST /api/posts/:id/regenerate-image` tạo ảnh mới; `POST /api/posts/:id/review-image` kiểm tra lại ảnh đã lưu. Đang xử lý thì không cho duyệt hoặc gửi thêm yêu cầu ảnh.
- Bài đã duyệt chỉ ADMIN/REVIEWER được đưa về chờ duyệt để kiểm tra lại ảnh; tạm ẩn khỏi feed. Bài cũ chưa lưu đánh giá văn bản vẫn cần người duyệt dù ảnh PASS.
- Gemini image input tham khảo: https://ai.google.dev/gemini-api/docs/image-understanding .
- Pollinations hiện có tài liệu endpoint xác thực tại https://gen.pollinations.ai/ . Mã hiện tại vẫn dùng nguồn ảnh legacy đang có; một số lần thử trả HTTP 402. Không tự đổi sang dịch vụ trả phí; UI báo lỗi và hỗ trợ người duyệt thay URL ảnh.

## Đổi project/API key Gemini

- Lưu `GEMINI_API_KEY` trong `backend/.env` (ngoài Git). `GEMINI_MODEL` chọn model cho tất cả node Gemini; cấu hình hiện tại là `gemini-3.5-flash-lite`.
- Chạy `python3 n8n/scripts/install-local.py` khi không có job đang chạy. Script ưu tiên key từ `.env`, cập nhật credential `comm-pr-gemini`, đồng bộ model, backup dữ liệu và publish/restart n8n.
- Generator JSON cũng dùng `gemini-3.5-flash-lite` mặc định. Key chỉ nằm trong cấu hình riêng/credential, không nằm trong JSON workflow.
- Khi đổi sang project `comm-pr-auto`, API đã trả 404 cho `gemini-2.5-flash` với thông báo model không còn dành cho người dùng mới và đề nghị `gemini-3.8-flash`; vì vậy đã đổi model cùng key. Lượt gọi tạo nội dung đầu tiên trên model mới gặp 503 quá tải; lần kiểm tra tiếp theo timeout. Không coi việc import credential thành công là bằng chứng tạo nội dung thành công.

## Cấu hình đã kiểm tra cuối cho buổi demo
- Model đang cài: `gemini-3.5-flash-lite`; cùng key/project riêng của nhóm. Đã chạy thành công Content, Community và Crisis sau khi 3.8 Flash gặp 503/timeout. Các đoạn ghi 3.8 ở trên là lịch sử chuyển key.
- Generator/installer và `.env.example` mặc định Flash-Lite; `GEMINI_MODEL` trong `.env` vẫn là cấu hình khi cài.
- Lỗi gọi/kiểm tra văn bản được phân biệt: 429 hạn mức, 503 quá tải, timeout, lỗi quyền/key, model không khả dụng hoặc JSON sai. Không trả nguyên error chứa thông tin credential ra UI.
- n8n execution có thể hiển thị success khi nhánh lỗi đã callback thành công; trạng thái nghiệp vụ cần xem ở WorkflowJob trên web. `success` của n8n không có nghĩa AI đã tạo nội dung thành công.
