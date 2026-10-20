# 8 workflow — mỗi thành viên 2 luồng

| Thành viên | Workflow | Node | Trigger |
| --- | --- | ---: | --- |
| Hoàng | Tạo/kiểm tra văn bản PR | 17 | POST `generate-post` |
| Hoàng | Tạo/kiểm tra ảnh thực tế | 13 | POST `generate-image` |
| Huy | Lập kế hoạch chiến dịch | 17 | POST `plan-campaign` |
| Huy | Đăng theo lịch | 12 | Mỗi phút / POST `publish-due` |
| Bảo | Chuyển thể đa nền tảng | 17 | POST `repurpose-content` |
| Bảo | Báo cáo chiến dịch | 19 | POST `campaign-report` / thứ Hai 08:00 |
| Phúc | Phân tích/phản hồi cộng đồng | 18 | POST `analyze-comment` |
| Phúc | Xử lý khủng hoảng có bằng chứng | 18 | POST `handle-crisis` |

Tất cả webhook yêu cầu Header Auth `Comm PR Internal Token`. Không gọi trực tiếp từ trình duyệt. Backend tạo WorkflowJob và quyết định trạng thái nghiệp vụ. Chi tiết phân công/nhánh: [WORKFLOW_OWNERSHIP.md](WORKFLOW_OWNERSHIP.md).

## Sinh và cài đặt

```bash
node n8n/scripts/build-workflows.mjs
python3 n8n/scripts/install-local.py
```

Generator lấy từng module `scripts/members/{hoang,huy,bao,phuc}.mjs`, dùng builder chung và tạo đúng tám JSON. `legacy-specs.mjs` chứa prompt nền để kế thừa, không phải workflow thứ chín.

Installer dùng instance `n8n` hiện có, sao lưu SQLite vào `.local/backups`, giữ ID Content/Community/Crisis và bổ sung năm ID ổn định. Đọc Gemini/model/token từ `backend/.env`, lưu key trong credential; JSON trên Git chỉ tham chiếu credential. Sau import/publish cần restart n8n; script đã thực hiện và chờ readiness. Chỉ chạy khi không có job đang xử lý.

Không chạy Compose mới khi PostgreSQL/n8n hiện tại đang hoạt động. Có thể đặt `N8N_CONTAINER` và `BACKEND_CALLBACK_BASE` nếu thay mạng Docker. Callback mặc định `http://172.17.0.1:5000`.

Máy mới: tạo hai credential Header Auth (`Comm PR Gemini`: `x-goog-api-key`; `Comm PR Internal Token`: `x-comm-token`), nhập tám JSON, gán credential, chỉnh model/URL backend và publish từng workflow. Installer local yêu cầu instance đã có Content để tìm project/ID.

## Hợp đồng và chính sách

- Content callback `/api/webhooks/content-text` lưu văn bản rồi tạo job ảnh trong transaction. Callback lặp không tạo thêm job ảnh; text job thành công không có nghĩa ảnh đã đạt.
- Image callback `/api/webhooks/content` giữ nguyên văn bản, gắn đánh giá với hash nội dung/bytes ảnh. IMAGE_ONLY/REVIEW_IMAGE gọi webhook ảnh riêng. Lỗi tải/vision là PARTIAL, không tự duyệt.
- Planning/Repurpose/Report callback `/api/workflow-internal/callback/:kind` lưu WorkflowArtifact và luôn chờ người duyệt. Thử lại giữ input snapshot; nếu nguồn chuyển thể đổi, cần tạo yêu cầu mới.
- Publisher lấy tối đa 50 lịch đến hạn. Backend transaction kiểm tra revision lịch, hash nội dung và trạng thái duyệt trước khi xuất bản lên feed mô phỏng. Hủy/sửa lịch làm request cũ vô hiệu. Lịch trễ quá 24 giờ cần người dùng đặt lại.
- Report snapshot số liệu từ database theo [from,to), không nhận số liệu AI bịa. Tuần tính từ thứ Hai 00:00 giờ Việt Nam. Unique key chống trùng báo cáo campaign/tuần; tối đa 100 chiến dịch có bài mỗi lượt. AI lỗi vẫn giữ số liệu để xem/xuất CSV/thử lại.
- Community job V2 yêu cầu issueType/urgency; khiếu nại, an toàn, pháp lý hoặc mức ưu tiên HIGH chuyển người duyệt. Crisis V2 yêu cầu evidenceIds nằm trong dữ liệu nguồn và các bước cần xác minh; không tự đăng thông cáo.
- Backend tuần tự gọi AI để hạn chế dồn request. Restart tiếp tục QUEUED, đánh dấu RUNNING thất bại để thử lại rõ ràng. Không tự lặp vô hạn khi hết quota.
- n8n có thể báo execution success khi đã gửi callback lỗi thành công. Xem WorkflowJob/Artifact trên web để biết kết quả nghiệp vụ.

## Kiểm thử

```bash
cd backend
RUN_DB_TESTS=true npm test
```

Test API/DB tạo fixture riêng, dọn sau kiểm tra, không gọi AI thật. Kiểm tra cấu trúc/code node, callback trùng/cũ, quyền, lịch đăng đồng thời, source revision, số liệu snapshot và kiểm tra ảnh.

Từ root, ứng dụng và n8n đang chạy:

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" node scripts/browser-smoke.mjs
PLAYWRIGHT_BROWSERS_PATH="$PWD/.local/browsers" node scripts/browser-business.mjs
LIVE_AI=true node scripts/workflow-v2-live.mjs
```

Lệnh cuối gọi dịch vụ AI/ảnh đang cấu hình, kiểm tra đủ tám workflow bằng fixture riêng rồi dọn; lưu kết quả ngoài Git ở `.local/workflow-v2/live-results.json`. Cần Pollinations key có quyền/hạn mức để xác nhận tạo ảnh; không dùng ảnh giả để báo PASS.
