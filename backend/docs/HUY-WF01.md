# HUY-WF01 — Lập kế hoạch ý tưởng bài/ảnh/video từ chiến dịch và tri thức

Kế hoạch cuối kỳ (acceptance): *Nhận chiến dịch/tri thức → tạo lịch ý tưởng bài/ảnh/video → kiểm tra đầu vào → lưu artifact chờ duyệt; không tự xuất bản.*

Workflow: `n8n/workflows/huy-01-planning.json` (22 node, webhook `plan-campaign`), sinh từ `n8n/scripts/members/huy.mjs`. Callback: `POST /api/workflow-internal/callback/planning` (httpHeaderAuth `Comm PR Internal Token`).

## Sơ đồ node

| Node | Vai trò |
| --- | --- |
| 01 Receive request | Webhook `plan-campaign`, headerAuth. |
| 02 Validate identifiers | Bắt buộc `jobId`, `entityId`, `context`. |
| 03 Limit context | Chặn context > 30 000 ký tự; thêm `contextText`, `startedAt`. |
| **03a Validate planning input** | Kiểm tra `context.brief` có nội dung và dài tối đa 5.000 ký tự, `context.count` là số nguyên 1–20. Đầu vào sai chuyển sang 15 với lỗi theo trường và không gọi AI. |
| **03b Planning input valid** | Nhánh rẽ: hợp lệ → 03c; không hợp lệ → 15 Build authenticated callback (ok=false). |
| **03c Build knowledge request** | Dựng câu hỏi tối đa 1.000 ký tự từ brief, tên và mô tả chiến dịch. Backend cấp `context.pageId` theo phạm vi của kho tri thức. |
| **03d Fetch approved knowledge** | `POST /api/workflow-internal/knowledge/answer-context` (credential `Comm PR Internal Token`, `continueOnFail`). Chỉ lấy tri thức đã duyệt. |
| **03e Merge knowledge context** | Chuẩn hóa `{knowledge:{knowledgeStatus, sources, brandVoice}}`. Lỗi/không rõ → `knowledgeStatus='INSUFFICIENT'`, `sources=[]` — không bịa. |
| 04 Build generation prompt | Prompt = instruction + giọng thương hiệu + tri thức đã duyệt + dữ liệu chiến dịch (trích đoạn và brief là dữ liệu tham chiếu). |
| 05 Generate with Gemini | Sinh JSON kế hoạch (continueOnFail). |
| 06 Extract model response | Trích text, ánh xạ lỗi HTTP sang thông báo Việt (quá tải/hạn mức/thời gian chờ/xác thực). |
| 07 Parse model JSON | Bỏ dấu định dạng khối mã và đọc JSON. |
| 08 Validate generated fields | Kiểm tra cấu trúc, đủ số ý tưởng theo `count`, loại nội dung và nền tảng. |
| 09 Generation succeeded | rẽ: ok → 10; fail → 15. |
| 10 Build independent review + 11 Review with Gemini + 12 Validate reviewer response + 13 Apply review decision | Đánh giá độc lập ý tưởng theo brief, nguồn và giọng thương hiệu. |
| 14 Prepare deliverable | Gắn `requiresHuman=true`, `knowledgeStatus`, `groundedSources=[{id,version}]`; loại cờ `autoEligible` và đặt `review.grounded=false` nếu thiếu nguồn hoặc có xung đột. |
| 15 Build authenticated callback → 16 Persist result in backend → 17 Respond to caller | Callback `POST /api/workflow-internal/callback/planning`; backend lưu artifact **PENDING_APPROVAL**. |

## Hợp đồng đầu vào / đầu ra

**Input** (dispatch từ `POST /api/campaigns/:id/plan`):

```json
{ "jobId": "…", "entityId": "…", "context": { "pageId": "…", "campaign": { "name": "…", "description": "…" }, "brief": "mục tiêu, đối tượng, thời gian", "count": 5 } }
```

**Result** (payload callback, kiểm tra bằng `checkedPlan` trong `backend/src/services/expansion.js`):

```json
{
  "summary": "…",
  "items": [{
    "topic": "…", "targetAudience": "…", "tone": "…",
    "contentKind": "POST | IMAGE | VIDEO",
    "platform": "Facebook | LinkedIn | X",
    "suggestedDate": "…", "rationale": "…"
  }],
  "requiresHuman": true,
  "groundedSources": [{ "id": "versionId", "version": 2 }],
  "knowledgeStatus": "SUFFICIENT | INSUFFICIENT | CONFLICT",
  "review": { "safe": true, "grounded": true, "risk": "LOW", "reason": "…" }
}
```

- `contentKind`: `POST` (bài viết) / `IMAGE` (ảnh, infographic) / `VIDEO` (video). Prompt yêu cầu phối hợp loại nội dung theo brief (chủ đề cần hình ảnh trực quan → IMAGE; có câu chuyện/chuyển động → VIDEO; còn lại → POST). Backend chấp nhận cả khi thiếu (artifact cũ) và mặc định `POST`; giá trị rác (vd. `"GIF"`) bị từ chối 400.
- `groundedSources`/`knowledgeStatus`: tùy chọn, lưu nguyên vào `artifact.result` để truy vết nguồn tri thức; sai cấu trúc → 400, job/artifact FAILED. Danh sách lưu một lần cho mỗi ID phiên bản nguồn được workflow tham chiếu.
- `requiresHuman` luôn là `true` trong artifact — **ý tưởng không bao giờ tự xuất bản**.

## Nhánh lỗi

- **03a/03b — đầu vào sai** (brief rỗng/không phải chuỗi, count không phải số nguyên 1–20): structured error trước khi gọi AI → 15 (ok=false) → callback → job/artifact **FAILED** kèm thông báo nêu rõ trường sai.
- **03d lỗi** (tri thức không trả lời được, question chỉ chứa từ dừng, backend sập): `continueOnFail` → 03e đặt `INSUFFICIENT`, `sources=[]`; kế hoạch vẫn sinh nhưng bị giới hạn "không bịa sự kiện, giá hoặc thông tin sản phẩm".
- **05/07/08 — AI lỗi hoặc JSON sai cấu trúc**: 09 rẽ nhánh fail → 15 với thông báo lỗi dịch vụ đã chuẩn hóa (429 hạn mức, 503 quá tải, timeout thời gian chờ, 401/403 xác thực).
- **11/12 — review không hợp lệ**: `ok=false`, không tự động duyệt.

## Phụ thuộc tri thức

- Node 03d gọi Knowledge API nội bộ (`answer-context`) — chỉ trả về tài liệu ở trạng thái **APPROVED** cùng phạm vi với trang tri thức (Page cấu hình trên máy chủ, `default` khi chưa cấu hình Page), kèm `brandVoice` (tone/style/forbidden).
- Prompt sinh ý tưởng (04) kết hợp brief + chiến dịch với nguồn tri thức đã duyệt và giọng thương hiệu; khi `CONFLICT` prompt ghi rõ chỉ dùng thông tin chắc chắn.
- Thiếu tri thức hoặc có xung đột thì prompt chỉ yêu cầu đề xuất ý tưởng và tránh khẳng định dữ kiện chưa kiểm chứng.

## Không tự xuất bản

- Artifact xử lý thành công về **PENDING_APPROVAL**; `result.requiresHuman=true`.
- Việc tạo bài từ một ý tưởng là **hành động riêng** (`POST /api/artifacts/:id/items/:index`) chỉ chạy khi artifact đã được người duyệt **APPROVED**; bài tạo ra ở trạng thái chờ soạn/duyệt, chưa đăng.
- Lịch đăng bài là một luồng khác (`huy-02-publishing`) và chỉ nhận bài APPROVED đủ nội dung.

## Kịch bản demo

1. Tạo chiến dịch "Hiên Cà Phê — ra mắt dòng cà phê sữa đá", nạp vài tài liệu tri thức (menu, giá, giọng thương hiệu) và duyệt tri thức.
2. `POST /api/campaigns/:id/plan` với brief "giới thiệu dòng mới cho khách trẻ, chạy 2 tuần đầu tháng 12" và `count: 6`.
3. Quan sát log workflow: 03a xác thực đầu vào → 03d lấy tri thức đã duyệt → 04 đưa nguồn đã duyệt và giọng thương hiệu vào prompt → Gemini sinh 6 ý tưởng với loại POST, IMAGE hoặc VIDEO phù hợp brief.
4. Artifact ở **PENDING_APPROVAL**; mở trang `/planning` xem `contentKind`, `groundedSources`, `knowledgeStatus`.
5. Trong môi trường kiểm thử, giả lập đầu ra `contentKind:"GIF"` để kiểm tra job chuyển FAILED.
6. Duyệt artifact (REVIEWER) → tạo bài từ ý tưởng số 0 → thấy bài mới ở trạng thái chờ soạn — **không có bài nào được đăng tự động**.

## Kiểm thử

- `backend/test/scheduling.test.js`: `checkedPlan` chấp nhận 3 giá trị `contentKind`, mặc định `POST`, từ chối giá trị rác; `groundedSources`/`knowledgeStatus` passthrough hợp lệ và từ chối sai cấu trúc; `requiresHuman=true`.
- `backend/test/expansion-api.test.js`: callback hợp lệ lưu `contentKind`/`groundedSources`/`knowledgeStatus` và đưa artifact về **PENDING_APPROVAL**. Callback sai cấu trúc trả 400 và artifact chuyển **FAILED**.
- `backend/test/workflows.test.js`: 22 node, tên duy nhất, code compile, credential trên httpRequest, nhánh lỗi Gemini, không lộ secret.
- Kiểm thử hồi quy 25/11: **85/85 backend/API/DB tests** trên PostgreSQL 18 cô lập, 20 migration. Ca API theo đường tạo kế hoạch thực tế kiểm tra Page lấy từ cấu hình máy chủ, lưu artifact chờ duyệt, không sinh bài; dispatch n8n trong bộ test này dùng mock.
- Ca node kiểm tra đầu vào sai, giới hạn câu hỏi, nguồn lỗi/sai cấu trúc, đúng số ý tưởng, review dùng cùng nguồn và loại cờ tự duyệt.
- Chạy n8n 2.35.7 cô lập với HTTP mock cho Gemini. Import và publish bản kiểm thử của workflow; gọi API tạo kế hoạch trong ứng dụng. Hai prompt nhận nguồn đã duyệt thuộc Page cấu hình. Tài liệu nháp và nguồn của Page khác bị loại. Kết quả VIDEO chờ duyệt; lỗi HTTP 503 ở bước review đưa artifact về **FAILED**. Cả hai lượt đều không tạo bài.
- Frontend lint, TypeScript và webpack production build đạt. Gemini thật và n8n triển khai hiện tại chưa được chạy với bản này.
