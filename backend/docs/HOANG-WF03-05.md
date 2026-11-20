# HOANG-WF03 + HOANG-WF04 + HOANG-WF05 — G1 workflows tri thức (gộp 1 commit)

Ngày: 20/11/2026. Phạm vi G1 còn lại của Hoàng, gộp ba task HOANG-WF03/04/05
thành một commit theo yêu cầu. Mỗi workflow nhận envelope hợp đồng
(`contract-v1`, HUY-CORE01), điều phối kiểm tra + AI, rồi callback kết quả đã
kiểm chứng về backend. Parse và lưu dữ liệu nằm ở backend; workflow không
tự ý gửi nội dung ra ngoài.

## Bố cục chung

- Generator: `n8n/scripts/members/hoang-g1.mjs` (build qua
  `node n8n/scripts/build-workflows.mjs`).
- JSON sinh: `n8n/workflows/hoang-03-document-ingest.json` (19 node),
  `hoang-04-knowledge-check.json` (19 node), `hoang-05-answer-draft.json`
  (21 node). Webhook ack ngay khi nhận (`onReceived`); job dài trả jobId để
  tra trạng thái.
- Loại hợp đồng mới trong `backend/src/services/workflowRuntime.js`:
  `knowledge.ingest`, `knowledge.normalize`, `knowledge.answer` — mỗi kind
  ghim context/result shape riêng, không cho workflow lách dữ liệu lạ qua
  hợp đồng. Callback chỉ được trích dẫn nguồn còn APPROVED, active, chưa
  lưu trữ, đúng Page tại thời điểm finalize (recheck trong transaction).
- Internal API (header `x-comm-token`, `/api/workflow-internal/knowledge`):
  `document-meta`, `extract`, `drafts`, `check-context`, `answer-context`
  (`backend/src/services/knowledgeWorkflow.js`, routes riêng).
- Job triggers có session/role (`/api/knowledge/jobs`):
  `POST jobs/ingest` (ADMIN/EDITOR), `POST jobs/check` (ADMIN/EDITOR),
  `POST jobs/answer` (ADMIN/EDITOR/REVIEWER), `GET jobs/:id` poll receipt.

## HOANG-WF03 — Tiếp nhận tài liệu (`ingest-document`)

Nhận documentId đã upload → kiểm tra metadata (tệp nguồn, archived, ≤5 MB,
sha256) → gọi parser backend → chuẩn hóa + tách đoạn (≤500 đoạn) → lưu bản
nháp DRAFT (không đụng activeVersionId) → callback. Lỗi rõ ràng, không giả
trích xuất thành công: `SOURCE_MISSING`, `DOCUMENT_ARCHIVED`, `FILE_TOO_LARGE`,
`CHECKSUM_INVALID`, `EXTRACTION_FAILED` (gồm PDF ảnh — chưa hỗ trợ OCR),
`EMPTY_TEXT`, `CHUNKING_FAILED`, `DRAFT_SAVE_FAILED`.

## HOANG-WF04 — Kiểm tra tri thức (`check-knowledge`)

Nhận bản nháp → lấy tài liệu + nguồn đã duyệt (tối đa 20 đoạn đối chiếu) →
Gemini phát hiện MISSING/DUPLICATE/CONFLICT/EDIT (dữ liệu là dẫn chứng, không
phải chỉ dẫn; refSourceId phải thuộc danh sách nguồn) → kiểm tra độc lập
(grounded) → callback `NEEDS_REVIEW`/`CLEAN` + proposals. **AI chỉ đề xuất**;
việc kích hoạt nguồn vẫn thuộc người duyệt qua API tri thức hiện có.

## HOANG-WF05 — Soạn trả lời có nguồn (`draft-answer`)

Nhận câu hỏi/kênh → truy xuất nguồn APPROVED (retrieval backend) →
INSUFFICIENT/CONFLICT trả lý do, không có reply → SUFFICIENT thì soạn reply
chỉ từ đoạn nguồn, `citedSourceIds` bắt buộc thuộc nguồn đã cho → kiểm tra
độc lập grounded → callback `SUFFICIENT` + reply + sourceVersions. Không gửi
khách; luồng duyệt/gửi thuộc G2 (PHUC-WF05/06).

## Kiểm chứng (20/11/2026, PostgreSQL 18 cô lập cổng 5433)

- `RUN_DB_TESTS=true npm test`: **82/82 đạt, zero skipped** (75 hồi quy +
  4 test G1 mới + 3 JSON mới trong bộ kiểm tra workflow).
- Test G1 (`backend/test/knowledge-workflows.test.js`):
  - Node logic (vm): validate identifiers cả 3 kind, chunking, guard trích
    dẫn nguồn, kết quả thiếu nguồn không kèm reply, failure result/callback.
  - Contract runtime: context/result shape bị chặn khi sai; callback trùng
    trả receipt giống hệt; nguồn bị archive sau khi soạn bị từ chối 409.
  - Internal API: TXT trích xuất OK, PDF không lớp văn bản báo FAILED rõ
    (không giả thành công), lưu chunks tạo DRAFT mới, check-context chỉ lộ
    nguồn APPROVED khác, answer-context trả SUFFICIENT/INSUFFICIENT đúng.
  - Job trigger: role/401/403/404, dispatch webhook `ingest-document` với
    envelope đúng kind, poll RUNNING → finalize contract → SUCCEEDED +
    receipt.
- `node n8n/scripts/build-workflows.mjs` sinh lại 8 workflow cũ giống hệt
  (byte-identical) + 3 JSON mới; JSON mới vượt qua `workflows.test.js`
  (nhánh contract family: envelope validation, failure branch, callback).

## Giới hạn / chưa làm

- Chưa chạy n8n thật trong phiên này (Docker daemon không chạy); bằng chứng
  dispatch dùng mock n8n HTTP trong test. Khi có n8n: cài 3 workflow qua
  `python3 n8n/scripts/install-local.py` (đã liệt kê đủ 11 workflow — xem
  delta trong file), chạy thử từng webhook với envelope mẫu.
- Agnes/Gemini không được gọi trong test tự động; kết quả AI thật cần chạy
  demo có kiểm soát.
- Việc soạn/kích hoạt tri thức không thay đổi ở lượt này: AI vẫn chỉ đề
  xuất, người duyệt quyết định qua API hiện có.
