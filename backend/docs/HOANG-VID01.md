# HOANG-VID01 — Khảo sát video AI, 08/11/2026

Chủ sở hữu bàn giao: Hoàng; Huy phối hợp yêu cầu xuất bản. Đây là khảo sát,
chưa chọn dịch vụ hoặc cấp ngân sách, chưa gọi tác vụ sinh video trả phí.

## Phương án có API

| Phương án | Giá tham khảo USD | Đặc điểm / giới hạn |
| --- | --- | --- |
| Google Gemini Omni 1.2 Flash trực tiếp | Khoảng 0,07 USD/giây đầu ra 720p, khoảng 0,70 USD/10 giây; input tính riêng | Model `gemini-omni-1.2-flash`, text/image/video → video có âm thanh, 3–15 giây. 720p mặc định; MP4; SynthID vô hình. API trả interaction ID để theo dõi tác vụ. Chỉ paid tier. |
| Runway Gen-4 Turbo | 5 credit/giây × 0,01 USD = 0,05 USD/giây; 0,50 USD/10 giây | Model `gen4_turbo`, phương án image-to-video để chuyển ảnh đã duyệt thành chuyển động. Cần tài khoản/API credit riêng; không suy ra hạn mức từ gói web. |
| Runway Gen-4.5 | 12 credit/giây = 0,12 USD/giây; 1,20 USD/10 giây | Model `gen4.5`; lựa chọn chất lượng khác để thử đối chiếu nếu ngân sách cho phép. |

Giá Google dựa trên 5.792 output token/giây 720p, 12 USD/triệu output token;
10 giây tính ra 0,69504 USD, làm tròn khoảng 0,70 USD. Bảng chưa gồm input,
thuế, chuyển đổi tiền, lưu trữ, ảnh đầu vào hoặc tạo lại. Runway tính credit
cho mỗi tác vụ; giá/model cần kiểm tra lại trước khi triển khai G4.
Tài liệu Google hiện chuyển hướng hướng dẫn video sang Omni và ghi Veo 3.1
Preview đã ngừng trên Gemini API; không tích hợp theo tên model Veo cũ.

Nguồn: [Google video](https://ai.google.dev/gemini-api/docs/video),
[Google Omni](https://aistudio.google.com/docs/omni),
[Google pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Runway pricing](https://docs.dev.runwayml.com/guides/pricing/),
[Runway models](https://docs.dev.runwayml.com/guides/models/).

## Thời gian, watermark, quyền sử dụng

Chưa có tài khoản video/hạn mức được cấp cho lượt này nên chưa có clip thử,
chi phí thực đo hoặc p50/p95 thời gian. Không cam kết độ trễ từ giá niêm yết.
Adapter phải lưu ID trước khi poll, có deadline, giữ tác vụ khi restart;
timeout chưa được coi là lý do tự sinh lại clip tính phí.

Google công bố SynthID vô hình; chưa kiểm chứng trực quan file đầu ra.
Runway: chưa có clip để xác minh watermark; không khẳng định không watermark.
Khi dùng API Runway trong UI cần attribution theo điều khoản/branding.
Runway không nhận quyền sở hữu nội dung của người dùng; người dùng vẫn cần
quyền với ảnh, nhạc, logo và nhân vật đầu vào. Google cũng không nhận quyền
sở hữu nội dung được tạo theo điều khoản; các giới hạn sử dụng vẫn áp dụng.
Không đưa ảnh khách hoặc tài liệu riêng vào thử nghiệm khi chưa có quyền.

Nguồn: [Runway attribution](https://docs.dev.runwayml.com/usage/attribution/),
[Runway terms](https://runway.com/terms-of-use),
[Gemini API terms](https://ai.google.dev/gemini-api/terms).

## Tương thích xuất bản Page

Mục tiêu nội bộ: MP4 H.264/yuv420p, AAC nếu có âm thanh, 1280×720 hoặc
720×1280, clip 5–10 giây. Đây là profile đề xuất của dự án, chưa phải tuyên bố
mọi provider đều trả codec đó hoặc Meta đã nghiệm thu file.
G4 cần ffprobe kiểm tra MIME/container/codec/duration/dimensions, giới hạn
kích thước và checksum. Nếu cần chuyển mã, lưu cả nguồn lẫn bản đăng và phiên bản.
Sau duyệt mới đặt lịch; upload, processing và publication là trạng thái riêng.

Đã thử truy cập [Meta Video Publishing](https://developers.facebook.com/docs/video-api/publishing/)
nhưng tài liệu không truy cập được trong lượt khảo sát. Chưa chốt endpoint,
codec/limit hiện hành của Meta từ nguồn thứ cấp. HUY-API01 phải xác minh lại
tài liệu chính thức và thử upload có duyệt ở G4; không dùng API Reels thay thế
âm thầm vì Reels ngoài phạm vi đã chốt.

## Đề xuất để người dùng quyết định

Ưu tiên thử **Google Omni 1.2 Flash 720p, clip 5–10 giây** vì đang dùng hệ sinh
thái Gemini; đây là đề xuất, không phải xác nhận project hiện có quyền video.
Phương án thay thế: **Runway Gen-4 Turbo** nếu ưu tiên chuyển ảnh duyệt thành
chuyển động với chi phí niêm yết thấp hơn.

Đề xuất trần thử nghiệm **5 USD**, tối đa 3 tác vụ ban đầu, không auto-top-up,
không auto-regenerate. Sau mỗi tác vụ kiểm tra usage trước khi tạo tiếp; dừng
khi chưa đối soát được chi phí. Người dùng cần chọn provider/model/trần chi phí
và cấp credential riêng trước HOANG-API04/G4. Chưa mua hoặc tạo tác vụ trong G0.

Nghiệm thu khảo sát: đã đối chiếu tài liệu chính thức và tính lại giá mẫu;
đã ghi rõ phần chưa kiểm chứng (clip, độ trễ, watermark Runway, Meta upload).
Không coi báo cáo này là nghiệm thu video thật.
