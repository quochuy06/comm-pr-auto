# HOANG-API04 — Adapter video AI (bản demo free), 12/11/2026

Phần triển khai adapter sinh video AI theo hợp đồng G0/G4: lưu provider job ID
trước khi poll, poll có deadline, không sinh lại khi poll, kiểm tra MP4 bằng
ffprobe. Chưa có kịch bản/n8n workflow (HOANG-WF06/07), chưa upload Meta
(HUY-WF03/HUY-API01) và chưa UI (BAO-UI05). Asset SUCCEEDED không phải video
đã đăng.

## Quyết định dịch vụ (người dùng, 12/11/2026)

- Yêu cầu: miễn phí cho demo. Đã khảo sát lại thị trường 10/2026: các API lớn
  (Veo/Runway/Luma/Pika) không có free tier; máy không có GPU nên không sinh
  local được.
- Provider đích: **Agnes Video** (apihub.agnes-ai.com) — free key tại
  platform.agnes-ai.com, model `agnes-video-2.5-flash` miễn phí (trial price
  $0/giây, promo có hạn, ~1 video/phút), async task/poll đúng thiết kế adapter.
  Người dùng đã cấp key vào `backend/.env` (12/11/2026).
- Dự phòng: Hugging Face Spaces/Inference (miễn phí vững nhưng queue lâu).
  free.ai CogVideoX (480p/3s, 1 clip/2 ngày) — không đạt profile 5–10s.

## Contract Agnes live (kiểm chứng 12/11/2026 bằng request thật)

- Create: `POST https://apihub.agnes-ai.com/v1/videos`, body đúng schema
  `{model, prompt, seconds (chuỗi), mode: "text", size: "720P", aspect_ratio}`.
  Response có `video_id` — đây là KHÓA POLL (`id`/`task_id` chỉ định danh task).
- Poll: `GET https://apihub.agnes-ai.com/agnesapi?video_id=<id>&model_name=<model>`
  (không phải /v1/videos/{id} như tài liệu cũ).
- Field BỊ CẤM đã gặp thật (HTTP 400 "forbidden field"): `num_frames`,
  `frame_rate`, `width`, `height`, `duration`. `mode` là bắt buộc. Do đó không
  thể đặt kích thước/thời lượng trực tiếp — dùng `seconds` + `aspect_ratio`,
  `size` chỉ nhận "720P" (rule riêng của Flash).
- Lỗi tạm thời đã gặp: HTTP 503 `video_queue_full` (hàng đợi free đầy) — map
  thành HttpError 503 riêng, cần retry có giãn cách, không sinh task mới liên tục.
- Key đã xác minh hợp lệ (request qua auth và validation, vào hàng đợi).
- Lưu ý: model v2.0 đã retired 25/09/2026; dùng 2.5 series. Response shape
  của retrieve khi task xong vẫn parse phòng thủ, cần xác minh thêm khi có
  clip thành công.

## Mã

- `src/services/video/provider.js` — interface chung + chọn provider theo
  `VIDEO_PROVIDER` (`agnes` mặc định, `mock` cho test/demo offline).
- `src/services/video/agnes.js` — adapter Agnes: POST /v1/videos → task id,
  GET /v1/videos/{id} → status + URL, tải MP4. Parse phản hồi phòng thủ; cần
  đối chiếu response thật khi có key. Lỗi 401/402/429 map thông báo riêng.
- `src/services/video/mock.js` — mock (ghi rõ provider "mock"): render clip
  thật bằng ffmpeg (testsrc2) để chạy trọn nhánh ffprobe; thiếu ffmpeg thì
  trả MP4 container tối thiểu (chỉ qua kiểm tra container).
- `src/services/videoJobs.js` — tạo job, lưu provider job ID vào
  WorkflowAttempt TRƯỚC poll; poll idempotent, timeout (`VIDEO_JOB_DEADLINE_MS`,
  mặc định 15 phút) finalize FAILED/PROVIDER_TIMEOUT không tự sinh lại;
  `verifyVideo` ffprobe container/codec/duration/dimensions (giới hạn 30s,
  1920px, 50 MB) hoặc CONTAINER_ONLY khi thiếu ffprobe; lưu file + sha256.
- `src/routes/videoRoutes.js` — API demo: POST /api/video/jobs (ADMIN/EDITOR),
  GET /api/video/jobs/:id (sync khi còn PENDING), POST /api/video/jobs/:id/sync.
- Migration `20261112090000_video_jobs`: chỉ thêm bảng `VideoAsset` (+FK
  WorkflowJob); job/attempt tái dùng WorkflowJob/WorkflowAttempt hiện có.

## Kiểm chứng (12/11/2026, PostgreSQL 18 cô lập trong /tmp, cổng 5433)

- `RUN_DB_TESTS=true node --test --test-concurrency=1 test/*.test.js`:
  **58/58 đạt, zero skipped** (51 hồi quy G0 + 7 test video mới: validate
  input, adapter Agnes (stub fetch), happy path + idempotent poll, timeout
  không sinh lại, provider fail, MP4 hỏng).
- Demo thật với mock: clip `/media/videos/42b1a333-bba4-45d5-b385-a36b891c7540.mp4`
  — ffprobe: h264, 1280×720, 3.0s, 1.038.860 bytes, sha256 đã ghi vào DB.
- Migration deploy + status: 14/14 trên DB test. Chưa áp migration vào DB
  ứng dụng/VPS (cần backup trước, theo quy tắc dự án).

## Env mới (backend/.env, không commit key thật)

- `VIDEO_PROVIDER` = `agnes` | `mock`
- `AGNES_API_KEY` — key Agnes khi có (đăng ký platform.agnes-ai.com)
- `AGNES_VIDEO_MODEL` = `agnes-video-2.5-flash`
- `VIDEO_JOB_DEADLINE_MS` = 900000

## Giới hạn / chưa làm

- Chưa xác minh response shape Agnes thật (chưa có key); adapter parse phòng
  thủ nhiều dạng — cần chạy thử 1 clip thật và chỉnh mapping khi cấp key.
- Agnes free là promo có hạn, watermark/quyền sử dụng chưa kiểm chứng; miễn
  phí thường không cho thương mại — chỉ dùng demo.
- Timeout bị coi là đối soát sau, không auto-regenerate (đúng yêu cầu, nhưng
  khác với UX "thử lại" — nút retry phải tạo job mới có chủ đích).
- Test API qua HTTP (login cookie) chưa có; mới test service + adapter. API
  e2e/UI thuộc HUY-API01/BAO-UI05.
- G4 đầy đủ còn: kịch bản video (HOANG-WF06), sinh qua workflow n8n
  (HOANG-WF07), duyệt/đặt lịch/upload Meta (HUY-WF03) — các trạng thái
  tạo/duyêt/upload/published phải tách bạch.
