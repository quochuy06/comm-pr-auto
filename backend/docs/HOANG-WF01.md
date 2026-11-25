# HOANG-WF01 — Soạn bài PR có nguồn tri thức đã duyệt

Webhook `generate-post` của `n8n/workflows/hoang-01-content.json` giữ nguyên ID, xác thực và callback hiện có. Generator nằm tại `n8n/scripts/members/hoang.mjs`.

| Node | Vai trò |
| --- | --- |
| 01–03 | Nhận webhook nội bộ, kiểm tra job/bài và giới hạn độ dài ngữ cảnh. Backend gửi brief, thông tin chiến dịch và phạm vi Page theo cấu hình kho tri thức. |
| 03c–03e | Từ brief tạo câu truy xuất, gọi `POST /api/workflow-internal/knowledge/answer-context` bằng credential nội bộ và kiểm tra nguồn trả về. Nếu chưa cấu hình Facebook, dùng kho `default` trên môi trường local. |
| 04–09 | Cung cấp brief, nguồn và giọng thương hiệu cho Gemini. Tách JSON kết quả và kiểm tra trường bài viết. |
| 10–13 | Gemini kiểm tra độc lập dữ kiện, an toàn và giọng thương hiệu. Workflow đối chiếu các ID mà bản nháp trích dẫn với tập nguồn đã truy xuất, rồi gắn ID và số phiên bản. |
| 14–17 | Hoàn thiện tiêu đề/nội dung rồi gửi callback `POST /api/webhooks/content-text`. Backend lưu bài chờ duyệt và chuyển sang bước ảnh. |

Callback lưu `Post.contentReview.knowledgeStatus` và `Post.contentReview.groundedSources` (mảng `{ id, version }`, trong đó `id` là ID phiên bản tri thức). Backend kiểm lại các phiên bản đang hoạt động, đã duyệt và đúng Page trước khi lưu đánh giá và trước khi xét tự duyệt ở callback ảnh. Việc lưu text và xếp hàng ảnh vẫn nằm trong cùng giao dịch.

Nếu kho trả lỗi, nguồn rỗng, mâu thuẫn hoặc trích dẫn ngoài tập đã cấp, bài hợp lệ vẫn được lưu chờ người duyệt. Khi nguồn đã bị lưu trữ, thay phiên bản hoặc đổi Page trong lúc chờ ảnh, callback ảnh không được nâng đánh giá văn bản thành đạt. Callback văn bản cũ thiếu metadata nguồn vẫn lưu được bài nhưng cũng cần người duyệt. Lỗi Gemini hoặc JSON đầu ra không hợp lệ vẫn đi qua nhánh báo lỗi của workflow.

## Kiểm thử

- PostgreSQL 18 QA cô lập với 20 migration hiện có. Bộ test backend tuần tự đạt 84/84 trên nhánh Hoàng và 85/85 khi áp bản vá lên `origin/main` tại `03cfe58`. Cả hai lượt chạy đều thực thi đầy đủ các test DB.
- `cd backend && RUN_DB_TESTS=true node --test test/text-workflow.test.js` thực thi logic của các Code node và kiểm tra HTTP callback trên PostgreSQL QA với n8n giả lập. Các ca gồm nguồn đúng Page, nguồn ngoài Page, nguồn đã archive giữa hai callback, callback lặp và kết quả thiếu nguồn.
- `node n8n/scripts/build-workflows.mjs` sinh lại JSON cùng các workflow còn lại. `backend/test/workflows.test.js` kiểm tra kết nối, credential, cú pháp và nhánh lỗi.
- Chạy webhook tạo văn bản trên n8n 2.35.7 và PostgreSQL QA cô lập với Gemini giả lập. Nguồn đã duyệt đúng Page được lưu đúng ID/phiên bản. Thiếu nguồn hoặc trích dẫn ngoài tập nguồn giữ bài chờ duyệt. Reviewer trả HTTP 503 làm job thất bại. Bước ảnh được kiểm thử riêng qua callback backend với asset mô phỏng.
