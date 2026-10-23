# Chuẩn bị chuyển lên VPS — 23/10/2026

**Bộ cấu hình hoàn chỉnh và các bước chạy hiện tại:** [VPS_RUNBOOK.md](VPS_RUNBOOK.md). Dùng hướng dẫn này khi khôi phục/kích hoạt; các ghi chú dưới đây mô tả gói snapshot ban đầu.

VPS: `160.250.180.238`, Ubuntu 24.04 amd64, Docker đã kiểm tra bằng hello-world.
Chưa có tên miền. Chuẩn bị và tải gói lên trước, chưa kích hoạt bản sao nghiệp vụ.

## Gói riêng trên máy cá nhân

`scripts/prepare-vps.py` tạo snapshot vào `.local/vps-transfer/` (Git ignore):

- Mã nguồn hiện tại, gồm các thay đổi chưa commit; không mang `.git`, `node_modules`, `.next`.
- `app/backend/.env`, `app/.local/facebook.env` nếu tồn tại, và ảnh trong `app/backend/storage/`.
- `database.dump`: PostgreSQL custom archive, kiểm tra bằng `pg_restore --list`.
- `n8n-data/`: dữ liệu n8n và config; SQLite được thay bằng snapshot online đã kiểm tra integrity, không dùng bản sao WAL đang chạy.
- `n8n-runtime.private.json`: các biến môi trường liên quan n8n, có thể chứa encryption key.
- `manifest.json`: thời điểm, commit nguồn và image digest để tránh đổi phiên bản n8n khi chuyển máy.

Không dừng/xóa dữ liệu nguồn, không đăng bài, không gửi phản hồi, không upload. Gói chứa credential nên chỉ chuyển qua SSH vào VPS của chủ dự án, không đưa lên Git hay web. Đây là snapshot chuẩn bị; dữ liệu phát sinh sau snapshot cần được chụp lại khi chuyển chính thức.

Tạo lại khi cần, trên máy cá nhân:

```bash
cd /home/tranhoquochuy/ChuyenDe2/comm-pr-auto
python3 scripts/prepare-vps.py
```

Tên container mặc định: PostgreSQL `comm_pr_postgres`, n8n `n8n`; có thể đặt biến `PG_CONTAINER`/`N8N_CONTAINER` nếu thực tế khác. Cần quyền Docker. Không chạy với `sudo` toàn bộ script nếu không cần, tránh tệp riêng thành sở hữu root.

## Tải gói lên

Trong terminal SSH đang đăng nhập VPS:

```bash
mkdir -p /opt/comm-pr-auto/incoming
chmod 700 /opt/comm-pr-auto /opt/comm-pr-auto/incoming
```

Mở một terminal khác trên máy cá nhân (không ở dấu nhắc root của VPS):

```bash
cd /home/tranhoquochuy/ChuyenDe2/comm-pr-auto
scp .local/vps-transfer/latest.tar.gz .local/vps-transfer/latest.sha256 root@160.250.180.238:/opt/comm-pr-auto/incoming/
```

Tự nhập mật khẩu SSH, không gửi vào chat. Nếu cổng SSH khác 22, thêm `-P PORT` vào lệnh scp.

Quay lại terminal VPS:

```bash
cd /opt/comm-pr-auto/incoming
chmod 600 latest.tar.gz latest.sha256
sha256sum -c latest.sha256
ls -lh latest.tar.gz
```

Chỉ khi hiện `latest.tar.gz: OK` mới xác nhận upload đúng. Chưa giải nén đè lên dữ liệu đã có; chưa chạy `docker compose up` từ compose local.

## Bước tiếp theo sau upload

1. Chuẩn bị compose/runtime dành riêng VPS; giữ PostgreSQL và n8n ở mạng nội bộ/loopback, n8n editor truy cập bằng SSH tunnel.
2. Ghim n8n đúng image digest trong manifest, phục hồi dữ liệu và giữ encryption key. Đổi URL callback từ máy local sang backend trên VPS.
3. Đặt cấu hình môi trường theo IP, không giữ origin localhost. Web thử qua IP trước; chưa coi HTTP là hoàn tất HTTPS/webhook Meta.
4. Dừng worker/n8n nguồn và chụp snapshot cuối trước chuyển chính thức, tránh hai máy cùng gửi Facebook/Messenger hoặc cùng chạy lịch.
5. Phục hồi database vào database mới trên VPS; không seed lại mật khẩu hoặc xóa dữ liệu nguồn.
6. Xác minh login, ảnh cũ, số lượng dữ liệu, callback và lịch; chỉ bật worker sau khi khôi phục/kiểm tra xong.
7. Sau khi có tên miền và HTTPS: cấu hình cookie secure, các URL chính sách/xóa dữ liệu, đăng ký webhook Meta. Xuất bản ứng dụng Meta là bước riêng, không tự hoàn thành khi VPS hoạt động.

Không dùng `docker compose down -v`, `prisma migrate reset`, hoặc cài lại n8n lên dữ liệu gốc.
