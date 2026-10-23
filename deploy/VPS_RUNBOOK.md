# Triển khai VPS 160.250.180.238 — chưa có tên miền

Máy cá nhân: `/home/tranhoquochuy/ChuyenDe2/comm-pr-auto`.
VPS Ubuntu 24.04 đã cài Docker/Compose và swap 2 GB.

## Cách hoạt động

Gói chuyển riêng chứa source hiện tại (kể cả chưa commit), PostgreSQL dump, ảnh, backend config, Facebook config và toàn bộ n8n/khóa giải mã. Không dùng seed/reset. Không chuyển file kế hoạch cuối kỳ lên Git hay vào gói.

`deploy/vps.py` chỉ khôi phục vào thư mục release/database mới; không ghi đè database đã có. Ghim đúng image PostgreSQL/n8n trong manifest. Đổi callback ở cả workflow hiện tại và lịch sử published sang `http://backend:5000`. Giữ IDs và credentials.

Mặc định web chỉ lắng nghe **127.0.0.1:8080** trên VPS; n8n editor **127.0.0.1:5678**. Không mở PostgreSQL/backend ra Internet. Mở web qua SSH tunnel trong giai đoạn chưa có HTTPS để tránh đưa mật khẩu đăng nhập qua HTTP công khai. Việc mua tên miền không cần thiết để chuyển dữ liệu và kiểm tra VPS.

## 1. Chuẩn bị trên VPS — terminal root@vpsre

```bash
mkdir -p /opt/comm-pr-auto/incoming
chmod 700 /opt/comm-pr-auto /opt/comm-pr-auto/incoming
apt update
apt install -y python3
docker compose version
```

Giữ cửa sổ SSH này. Không cần cài Node.js/PostgreSQL trực tiếp lên VPS: chúng chạy trong Docker.

## 2. Chuyển chính thức — terminal MÁY CÁ NHÂN

Chỉ làm bước này khi sẵn sàng dừng bản local. Không thao tác tạo bài/bình luận trong lúc chuyển.

```bash
cd /home/tranhoquochuy/ChuyenDe2/comm-pr-auto
python3 scripts/quiesce-for-vps.py --stop-source
python3 scripts/prepare-vps.py --final
```

Script đầu chỉ tìm tiến trình `node src/server.js` có cwd đúng thư mục backend này rồi gửi SIGTERM và dừng container `n8n`. Không dừng/xóa PostgreSQL. Nếu backend chạy qua trình quản lý khác, script sẽ yêu cầu dừng thủ công thay vì giết nhầm. Lệnh snapshot `--final` từ chối nếu backend/n8n vẫn chạy.

Nếu snapshot chưa báo `READY`, chưa upload. Nếu cần bản chuẩn bị khi local vẫn chạy, dùng `python3 scripts/prepare-vps.py` không có `--final`; bản này chỉ được kiểm tra, không thể kích hoạt tự động hóa trên VPS.

Tải lên bằng SSH:

```bash
scp .local/vps-transfer/latest.tar.gz .local/vps-transfer/latest.sha256 deploy/vps.py root@160.250.180.238:/opt/comm-pr-auto/incoming/
```

Tự nhập mật khẩu VPS khi được hỏi. Không gửi mật khẩu hoặc nội dung gói vào chat/Git. Nếu cổng SSH khác 22, thêm `-P PORT` cho scp. Giữ local backend/n8n tắt sau snapshot cuối.

## 3. Khôi phục trên VPS — terminal root@vpsre

```bash
cd /opt/comm-pr-auto/incoming
chmod 600 latest.tar.gz latest.sha256 vps.py
sha256sum -c latest.sha256
python3 vps.py restore --archive latest.tar.gz
```

Phải thấy checksum `OK` trước khi tiếp tục. Restore sẽ build lần lượt backend/frontend, tạo PostgreSQL riêng, phục hồi dump bằng một transaction, kiểm tra số lượng bản ghi, áp dụng migration bổ sung nếu cần, rồi chạy web ở chế độ **automation OFF**. Lần đầu phải tải image và npm nên có thể mất nhiều phút tùy đường truyền.

Chỉ khi kết thúc bằng `RESTORE OK. Automation is OFF.` mới coi bước khôi phục thành công. Đường dẫn app mới được ghi trong `DEPLOYED_APP.txt`; không tự giải nén đè lên release cũ.

Nếu thất bại: giữ nguyên file/dữ liệu, gửi dòng lỗi cuối (không gửi env/config). Không chạy `down -v`/reset. Một release bị lỗi sẽ không bị script ghi đè khi chạy lại. Có thể chọn thư mục release mới bằng `--releases /opt/comm-pr-auto/releases-retry1` sau khi đã xác định và dừng các container của lần thất bại để không trùng cổng.

## 4. Mở web qua SSH — terminal mới trên MÁY CÁ NHÂN

```bash
ssh -N -L 8080:127.0.0.1:8080 -L 15678:127.0.0.1:5678 root@160.250.180.238
```

Giữ terminal tunnel mở. Trình duyệt vào **http://localhost:8080**. Đăng nhập bằng tài khoản hiện tại, kiểm tra bài cũ/ảnh cũ và dashboard. Chưa bấm tạo AI, đăng bài hay gửi phản hồi ở bước preview.

Kiểm tra bằng script trên VPS:

```bash
cd /opt/comm-pr-auto/incoming
python3 vps.py check
python3 vps.py status
```

`/health` phải 200, `/api/auth/me` khi chưa đăng nhập phải 401, ảnh cũ tải được, callback nội bộ qua cổng web phải 404. n8n chưa khởi động và worker Facebook tắt.

## 5. Bật tự động hóa — terminal VPS

Chỉ sau khi kiểm tra preview đạt, xác nhận local backend/n8n vẫn tắt và gói được tạo bằng `--final`:

```bash
cd /opt/comm-pr-auto/incoming
python3 vps.py activate --source-stopped
python3 vps.py status
```

Script kiểm tra dấu snapshot cuối, bật n8n, chờ readiness rồi bật worker backend. Từ lúc này Page polling, mẫu phản hồi, lịch đăng và các tác vụ tuần chuyển sang VPS. Các điều kiện duyệt/rủi ro/khủng hoảng giữ nguyên.

Editor n8n qua tunnel ở **http://localhost:15678**. Tài khoản n8n cũ giữ nguyên. Backend gọi n8n qua service nội bộ `http://n8n:5678`; không dùng địa chỉ trình duyệt/tunnel làm callback giữa container.

## 6. Quay lại local nếu cần

**Dừng automation VPS trước**, trên VPS:

```bash
cd /opt/comm-pr-auto/incoming
python3 vps.py stop
```

Chỉ khi target backend/n8n đã dừng, trên máy cá nhân:

```bash
docker start n8n
cd /home/tranhoquochuy/ChuyenDe2/comm-pr-auto/backend
npm start
```

PostgreSQL local và snapshot gốc luôn giữ nguyên. Nếu VPS đã phát sinh dữ liệu mới/gửi bài/phản hồi, cần đối soát và chuyển dữ liệu mới về trước khi bật lại local; không bật cả hai bản trên các snapshot khác nhau.

## 7. Sau khi VPS ổn định

- Chuẩn bị tên miền/HTTPS trước khi mở đăng nhập công khai; sau đó cập nhật origin, cookie secure và URL n8n theo HTTPS.
- Đăng ký webhook Meta công khai cần HTTPS; hiện polling vẫn chạy sau activation. VPS hoạt động không tự xuất bản ứng dụng Meta.
- Tạo chính sách quyền riêng tư/hướng dẫn xóa dữ liệu phù hợp trước khi điền URL vào Meta; không dùng link Page thay thế.
- Cấu hình sao lưu định kỳ ra ngoài VPS, giám sát dung lượng/RAM/logs. Compose đã giới hạn log 10 MB × 3/service.
- Không đưa `deploy/runtime/`, `.local/`, env, dump, token hoặc `KE_HOACH_CUOI_KY.md` lên Git. Không dùng `docker compose down -v`, `prisma migrate reset` hoặc seed để khôi phục mật khẩu.
