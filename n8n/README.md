# Community và Crisis workflows

Bản Git này đưa lên hai workflow, mỗi workflow có **17 node**:

- `agent-3-community.json`: phân tích cảm xúc/rủi ro bình luận, soạn phản hồi, kiểm tra độc lập và callback để backend quyết định tự trả lời hay chờ duyệt.
- `agent-4-crisis.json`: tổng hợp bằng chứng, soạn thông cáo/hành động, kiểm tra độc lập và callback; thông cáo luôn cần con người duyệt.

File Content cũ giữ nguyên; bản nâng cấp Content/Visual và xử lý ảnh đang hoãn. Hai script bên dưới chỉ sinh/cài Community và Crisis, không thay hoặc publish workflow Content.

## Sinh và cài workflow

Từ root:

```bash
node n8n/scripts/build-workflows.mjs
python3 n8n/scripts/install-local.py
```

Generator không chứa secret. Installer dành cho instance hiện có: tìm workflow `generate-post` để xác định project sở hữu, sao lưu SQLite vào `.local/backups/`, đọc cấu hình backend, import hai workflow và credential rồi publish/restart n8n. Chỉ chạy khi không có job đang xử lý; việc này không cần thực hiện chỉ để commit mã nguồn.

- Container mặc định `n8n`, đổi bằng `N8N_CONTAINER`.
- `N8N_CALLBACK_SECRET` trong `backend/.env` phải có ít nhất 32 ký tự.
- `GEMINI_API_KEY`/`GEMINI_MODEL` đọc từ `backend/.env`; mặc định model `gemini-3.5-flash-lite`.
- Credential dùng chung `Comm PR Gemini` gửi `x-goog-api-key`; `Comm PR Internal Token` gửi `x-comm-token`. Cập nhật credential chung có thể ảnh hưởng các workflow khác đang dùng nó.
- `BACKEND_CALLBACK_BASE` đổi địa chỉ backend nhìn từ Docker; mặc định `http://172.17.0.1:5000`.

Máy mới chưa có workflow Content/project hiện hữu: import thủ công hai JSON trong n8n, tạo/gán hai credential Header Auth, chỉnh URL callback `/api/webhooks/community` và `/api/webhooks/crisis`, rồi publish. Không đặt key trực tiếp trong JSON.

## Kiểm tra và giới hạn

Mỗi workflow gọi Gemini tối đa hai lần, gồm soạn và kiểm tra. Hạn mức, quá tải, timeout và lỗi xác thực được phân loại; không xuất nguyên lỗi có credential lên giao diện. Callback có token và job/entity ID; backend bỏ qua kết quả cũ/lặp và không tự đăng thông cáo.

Trong `backend`: `node --test test/workflows.test.js` kiểm tra cấu trúc, credential reference, code node và nhánh lỗi của hai workflow. Từ root: `node scripts/live-demo.mjs community` hoặc `crisis` chạy thật trên một bài đã duyệt, lưu bằng chứng ở `.local/demo-runs/`.

N8n execution hoàn tất có thể chỉ có nghĩa đã gửi callback lỗi; cần kiểm tra trạng thái WorkflowJob. AI miễn phí vẫn có thể hết quota; người duyệt phải hiệu đính thông cáo trước khi xuất bản.
