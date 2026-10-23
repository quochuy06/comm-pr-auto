# Tự cập nhật VPS khi main thay đổi

Workflow: `.github/workflows/vps.yml`. Repository: `quochuy06/comm-pr-auto`.
Production hiện tại: `https://top2lowcode.io.vn`, VPS `160.250.180.238`.

## Hành vi

- Pull request vào main: chỉ chạy kiểm thử, không lấy SSH secrets hay triển khai.
- Push/merge main hoặc Run workflow trên main: kiểm thử PostgreSQL rỗng, backend/API, Python deployment tests, frontend lint/build; sau đó GitHub build Docker image và chuyển qua SSH.
- VPS giữ nguyên Compose project, PostgreSQL volume, media, cấu hình HTTPS/cookie, Facebook token và n8n database/credentials. Không chạy seed, reset hay import workflow.
- Source Git không cần được clone trên VPS. Image mới chứa code mới; thư mục snapshot cũ tiếp tục giữ dữ liệu/runtime.
- Schema hoặc migration thay đổi: chặn triển khai tự động trước khi đổi dịch vụ. Cần quy trình migration thủ công và cập nhật baseline đã duyệt. Không dùng audit fix --force hoặc migrate reset để vượt kiểm tra.
- Thay đổi file cấu hình runtime/Compose/nginx/receiver hoặc workflow n8n không được tự áp dụng chỉ bằng push. Đây là các cập nhật vận hành riêng.
- Main được tuần tự hóa và không hủy một deployment đang chạy. Receiver có thêm file lock.
- VPS đợi job/sending hoàn thành tối đa 2 phút, sao lưu PostgreSQL, giữ image cũ rồi cập nhật web/backend. Candidate backend được kiểm tra với worker tắt; chỉ bật lại theo cấu hình cũ khi health đạt.
- Nếu health lỗi, tự chuyển lại image trước đó. Không tự restore database cũ: việc quay lùi DB có thể làm gửi lại outbox đã gửi thành công. Rollback code không hoàn tác bài/phản hồi Facebook đã gửi.

## Cài một lần

Trên máy cá nhân:

```bash
cd /home/tranhoquochuy/ChuyenDe2/comm-pr-auto
python3 scripts/prepare-cicd.py
scp .local/cicd/setup.tar.gz root@160.250.180.238:/opt/comm-pr-auto/incoming/cicd-setup.tar.gz
```

Gói `setup.tar.gz` chỉ có code installer và **public key**. Private key giữ ở `.local/cicd/id_ed25519` (0600), không lên Git, không gửi chat/VPS. Script không ghi đè key đã tồn tại.

Trên terminal VPS đang đăng nhập root:

```bash
cd /opt/comm-pr-auto/incoming
mkdir -p cicd
chmod 700 cicd
tar --no-same-owner -xzf cicd-setup.tar.gz -C cicd
apt install -y sudo
python3 cicd/install_cicd.py --public-key cicd/ci-deploy.pub
```

Kết quả cần có `CI/CD RECEIVER READY`. Installer kiểm tra production rồi cài root-owned receiver tại `/usr/local/sbin/commpr-cd`, wrapper `/usr/local/bin/commpr-ci-ssh`, config riêng `/etc/commpr-cd.json` và user `commpr-deploy`. Không restart app/database/n8n.

Key đăng nhập `commpr-deploy` bị ép qua forced command: chỉ nhận `upload <40-character SHA>` hoặc `deploy <SHA>`. Không được mở shell/PTY/SFTP, forward port hoặc chạy sudo tùy ý. Vì đây là quyền cập nhật code production, giữ private key trong GitHub Secrets và hạn chế người có quyền push main.

## GitHub Secrets

Vào Repository → Settings → Secrets and variables → Actions. Hai Repository secrets:

| Secret | Giá trị |
|---|---|
| `VPS_DEPLOY_KEY` | Nội dung private key `.local/cicd/id_ed25519`, gồm dòng BEGIN/END; không đưa vào issue/chat |
| `VPS_KNOWN_HOSTS` | Host key đã xác minh cho VPS; installer ghi bản PUBLIC tại `cicd/VPS_KNOWN_HOSTS.txt` |

Có thể dùng host record từ `~/.ssh/known_hosts` đã được người dùng chấp nhận qua phiên SSH hiện tại. Không tắt StrictHostKeyChecking, không tạo niềm tin bằng ssh-keyscan chưa đối chiếu.

Nếu GitHub CLI đã được cấu hình bởi trợ lý, chỉ kiểm tra tên hai secrets đã có; không cần tạo lại. Không overwrite secret của hệ thống khác cùng tên mà chưa đối soát.

Variables tùy chọn: `VPS_HOST` (mặc định `160.250.180.238`), `VPS_PORT` (mặc định `22`). Environment `production` không đặt required reviewers nếu muốn main tự cập nhật sau test. Không dùng pull_request_target để triển khai.

## Đưa CI/CD lên Git và chạy lần đầu

Chỉ sau khi receiver và Secrets sẵn sàng, commit/push **toàn bộ file triển khai đã kiểm thử**, gồm Dockerfiles/standalone/runtime gate từ lần chuyển VPS, các script/kiểm thử CI/CD và workflow. Tách commit theo trách nhiệm Huy/Bảo đã thống nhất; `KE_HOACH_CUOI_KY.md`, `.local`, `deploy/runtime`, env và credentials vẫn bị ignore.

Push main sẽ tự khởi chạy. Vào Actions → Test and deploy VPS để theo dõi. Nếu main có branch protection, merge pull request sau khi `verify` đạt. Có thể Run workflow trên main để chạy lại mà không tạo commit giả.

Chỉ báo CI/CD đã hoạt động sau khi job verify/deploy đều xanh, log có `DEPLOYED <SHA>` và website/login/ảnh hoạt động. Secret đã cấu hình hoặc file workflow đã viết chưa phải bằng chứng deployment thành công.

## Sau này cập nhật code

1. Sửa và test local. Không bật backend/n8n local với dữ liệu production cùng lúc VPS đang xử lý Facebook.
2. Push nhánh tính năng/PR để test. Merge main khi đạt.
3. Actions build trên GitHub; VPS chỉ load image và restart web/backend. Có thể gián đoạn ngắn khi thay container; đây không phải blue-green zero-downtime.
4. PostgreSQL/media/token/n8n ở VPS không bị thay bằng snapshot local cũ.

Nếu backend bắt đầu dùng biến môi trường mới, cập nhật cấu hình production thủ công trước. Với schema/n8n/deploy config, báo thay đổi cụ thể để làm bước vận hành riêng.

## Xem trạng thái và lỗi trên VPS

```bash
cat /opt/comm-pr-auto/cd/current.json
df -h /
```

`current.json` chỉ chứa SHA/image/đường dẫn backup, không chứa credential. Backup riêng ở `/opt/comm-pr-auto/cd/backups/`, upload ở `cd/incoming/`. Receiver yêu cầu tối thiểu 6 GiB trống trước upload. Gói upload thành công được xóa sau khi deploy; image rollback và DB dump giữ lại, cần chính sách sao lưu ra ngoài máy và dọn bản cũ có kiểm soát.

Nếu deploy lỗi, dùng SHA 12 ký tự đầu trong Actions:

```bash
journalctl -u commpr-cd-12_KY_TU_DAU_SHA -n 80 --no-pager
```

Không dùng docker prune toàn máy hoặc down -v để xử lý lỗi. Nếu không rollback được, giữ nguyên DB và kiểm tra image/health thủ công. Không bật local để thay thế khi chưa dừng worker VPS và đối soát dữ liệu phát sinh mới.

## Thu hồi quyền CI

Xóa Repository Secret `VPS_DEPLOY_KEY` và bỏ public key trong `/home/commpr-deploy/.ssh/authorized_keys`. Web đang chạy không phụ thuộc vào SSH key CI. Không xóa runtime, PostgreSQL volume hoặc n8n-data.
