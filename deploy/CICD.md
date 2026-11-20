# Tự cập nhật VPS khi main thay đổi

Hệ hiện tại: **webhook trên VPS** — GitHub báo sự kiện merge/push vào main,
VPS tự fetch, test, build image và deploy. Không dùng GitHub Actions
(workflow `.github/workflows/vps.yml` đã gỡ; lấy lại từ Git history nếu cần).
Repository: `quochuy06/comm-pr-auto`.
Production hiện tại: `https://top2lowcode.io.vn`, VPS `160.250.180.238`.

## Luồng webhook (không GitHub Actions)

1. Merge/push vào `main` → GitHub gửi `push` event có chữ ký HMAC
   (`X-Hub-Signature-256`) tới `commpr-cd-hook` (systemd service trên VPS).
2. Hook chỉ xác thực chữ ký, lọc sự kiện (`refs/heads/main`, không force/xóa,
   SHA hợp lệ, chống gửi trùng theo delivery id) rồi trả lời 202 ngay và
   xếp pipeline chạy nền trong systemd unit riêng — GitHub ngắt kết nối
   không ảnh hưởng deploy.
3. Pipeline (`commpr-cd-pipe`, `deploy/cd_pipeline.py`):
   - Fetch `origin/main` vào thư mục tạm; commit phải là tổ tiên của
     `origin/main`, checkout đúng SHA vừa merge.
   - **Chặn schema đổi**: fingerprint Prisma phải khớp baseline
     `/etc/commpr-cd.json`; migration mới phải qua `migrate_release.py`
     có duyệt trước.
   - Test: Python deployment safety (unittest như trước) + backend
     API/DB (node --test trên PostgreSQL ném đi, DB test không đụng
     production) + lint frontend (stage `lint` trong frontend.Dockerfile).
   - Build image `comm-pr-backend:<sha>`, `comm-pr-frontend:<sha>` có label
     revision đúng SHA, đóng gói release (images.tar + manifest.json).
   - Gọi `commpr-cd deploy <sha>`: **toàn bộ cơ chế cũ giữ nguyên** — khóa
     tuần tự, chờ job idle, sao lưu PostgreSQL, health check, tự quay lại
     image cũ nếu lỗi. Không tự restore DB.
4. Trạng thái: `GET /ci/status` của hook, hoặc
   `/opt/comm-pr-auto/cd/pipeline-state.json`, `current.json`.

## Cài một lần (bên cạnh install_cicd.py)

Trên máy cá nhân: chuẩn bị gói như mục dưới, hoặc copy trực tiếp
`deploy/cd_hook.py`, `deploy/cd_pipeline.py`, `deploy/install_cd_hook.py`
sang VPS. Trên terminal VPS (root):

```bash
python3 install_cd_hook.py --secret-file /root/webhook-secret.txt \
    [--repo-url git@github.com:quochuy06/comm-pr-auto.git --git-ssh-key /root/ci-read.key]
```

Khi không truyền `--secret-file`, installer sinh secret ngẫu nhiên và in ra
một lần (lưu lại ngay; không đưa vào Git/chat). Repo private thì dùng
`--repo-url` SSH + `--git-ssh-key` là deploy key **chỉ đọc** (cấp trong
GitHub → Settings → Deploy keys, không tick write). Config ghi vào
`/etc/commpr-cd.json` (0600 root): `webhookSecret`, `webhook.host/port`,
`repoUrl`, `gitSshKey`. Installer bật service `commpr-cd-hook`
(`systemctl status commpr-cd-hook`).

GitHub webhook: Settings → Webhooks → Add webhook:
- Payload URL: `http://<IP-VPS>:<PORT>/ci/webhook` (đặt TLS riêng qua
  `--tls-cert/--tls-key` hoặc reverse proxy; secret vẫn là lớp chính).
  Chọn cổng trống: nếu cổng mặc định 9443 đã bị dịch vụ khác chiếm
  (curl trả lời "Client sent an HTTP request to an HTTPS server" là bị
  chiếm), chạy lại installer với `--port <cổng khác>` (ví dụ 9455) rồi
  dùng đúng cổng đó trong firewall và Payload URL.
- Content type: `application/json`; Secret: giá trị đã lưu ở trên.
- Events: **Just the push event**.
- Mở firewall/security group cho cổng đó (hoặc để reverse proxy lo).

## Hành vi chung (giữ nguyên từ quy trình cũ)

- Pull request vào main: không deploy (hook chỉ nhận push vào main).
- VPS giữ nguyên Compose project, PostgreSQL volume, media, cấu hình
  HTTPS/cookie, Facebook token và n8n database/credentials. Không chạy
  seed, reset hay import workflow.
- Source Git không cần được clone sẵn trên VPS; pipeline fetch vào thư mục
  tạm và dọn sau khi xong. Image mới chứa code mới; thư mục snapshot cũ
  tiếp tục giữ dữ liệu/runtime.
- Schema hoặc migration thay đổi: chặn triển khai tự động trước khi đổi
  dịch vụ. Cần quy trình migration thủ công (`migrate_release.py`) và cập
  nhật baseline đã duyệt. Không dùng audit fix --force hoặc migrate reset
  để vượt kiểm tra.
- Thay đổi file cấu hình runtime/Compose/nginx/receiver/hook hoặc workflow
  n8n không được tự áp dụng chỉ bằng push. Đây là các cập nhật vận hành riêng.
- Main được tuần tự hóa (pipeline.lock + deployment.lock) và không hủy một
  deployment đang chạy.
- Nếu health lỗi, tự chuyển lại image trước đó. Không tự restore database
  cũ: việc quay lùi DB có thể làm gửi lại outbox đã gửi thành công. Rollback
  code không hoàn tác bài/phản hồi Facebook đã gửi.

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

Lưu ý hệ webhook: pipeline chạy `commpr-cd deploy` trực tiếp trên VPS
(nội bộ root), **không cần SSH key CI**. User `commpr-deploy` và forced
command chỉ còn dùng khi muốn deploy thủ công từ máy ngoài qua SSH
(`upload <SHA>` / `deploy <SHA>`); có thể bỏ qua phần public key nếu không
dùng. Các nguyên tắc an toàn giữ nguyên: forced command chỉ nhận
`upload/deploy` + SHA 40 ký tự, không shell/PTY/SFTP.

## GitHub Secrets

Không cần. Hệ webhook không dùng GitHub Actions và không lấy SSH key từ
GitHub. Nếu còn secrets cũ (`VPS_DEPLOY_KEY`, `VPS_KNOWN_HOSTS`), hãy xóa
đi để thu hồi quyền deploy kiểu cũ.

## Đưa CI/CD lên Git và chạy lần đầu

Commit/push **toàn bộ file triển khai đã kiểm thử** qua PR: Dockerfiles,
runtime gate, `cd_hook.py`, `cd_pipeline.py`, `install_cd_hook.py`,
`test_cd_hook.py` và tài liệu này. Tách commit theo trách nhiệm
Huy/Bảo đã thống nhất; `KE_HOACH_CUOI_KY.md`, `.local`, `deploy/runtime`,
env và credentials vẫn bị ignore.

Cài `install_cd_hook.py` trên VPS và cấu hình GitHub webhook (mục trên) là
bước vận hành riêng, làm **trước** khi merge vào main. Merge đầu tiên sẽ
tự chạy pipeline. Theo dõi:

```bash
systemctl status commpr-cd-hook
curl -s http://127.0.0.1:9443/ci/status
journalctl -u 'commpr-cd-pipe-*' -n 80 --no-pager
```

Chỉ báo CI/CD đã hoạt động sau khi pipeline xanh, log có `DEPLOYED <SHA>`
và website/login/ảnh hoạt động. Cấu hình webhook hay file code đã viết chưa
phải bằng chứng deployment thành công.

## Sau này cập nhật code

1. Sửa và test local. Không bật backend/n8n local với dữ liệu production cùng lúc VPS đang xử lý Facebook.
2. Push nhánh tính năng/PR để test. Merge main khi đạt.
3. VPS tự fetch, test, build image và restart web/backend. Có thể gián đoạn ngắn khi thay container; đây không phải blue-green zero-downtime.
4. PostgreSQL/media/token/n8n ở VPS không bị thay bằng snapshot local cũ.

Nếu backend bắt đầu dùng biến môi trường mới, cập nhật cấu hình production thủ công trước. Với schema/n8n/deploy config, báo thay đổi cụ thể để làm bước vận hành riêng.

## Xem trạng thái và lỗi trên VPS

```bash
cat /opt/comm-pr-auto/cd/current.json
df -h /
```

`current.json` chỉ chứa SHA/image/đường dẫn backup, không chứa credential. Backup riêng ở `/opt/comm-pr-auto/cd/backups/`, upload ở `cd/incoming/`. Receiver yêu cầu tối thiểu 6 GiB trống trước upload. Gói upload thành công được xóa sau khi deploy; image rollback và DB dump giữ lại, cần chính sách sao lưu ra ngoài máy và dọn bản cũ có kiểm soát.

Nếu deploy lỗi, dùng SHA 12 ký tự đầu trong trạng thái pipeline:

```bash
journalctl -u commpr-cd-pipe-12_KY_TU_DAU_SHA -n 80 --no-pager
```

Không dùng docker prune toàn máy hoặc down -v để xử lý lỗi. Nếu không rollback được, giữ nguyên DB và kiểm tra image/health thủ công. Không bật local để thay thế khi chưa dừng worker VPS và đối soát dữ liệu phát sinh mới.

## Thu hồi quyền CI

Xóa webhook trong GitHub (Settings → Webhooks), dừng và disable service:
`systemctl disable --now commpr-cd-hook`. Nếu còn hệ SSH cũ, xóa Repository
Secret `VPS_DEPLOY_KEY` và bỏ public key trong
`/home/commpr-deploy/.ssh/authorized_keys`. Web đang chạy không phụ thuộc
vào webhook hay SSH key CI. Không xóa runtime, PostgreSQL volume hoặc
n8n-data.

## Cập nhật token Facebook riêng trên VPS

Deploy code không đồng bộ `.local/facebook.env` từ máy phát triển. Sau khi
xác minh token mới local, chuyển file bằng SSH riêng tới `/root/facebook-new.env`.
Root chạy `update_facebook_credentials.py` từ commit đã kiểm thử. Helper xác minh
Page token qua Meta trước khi ghi, yêu cầu cùng Page đang cấu hình, chờ job idle,
backup hai file cấu hình, chỉ cập nhật token và metadata thời hạn. Các biến token
đã có trong backend.env cũng được cập nhật để không ghi đè token mới trong file.
Không đổi App Secret, webhook verify token, DB hoặc công tắc/template tự động.

Helper recreate riêng backend, reload nginx để phân giải backend mới, kiểm tra
health và đọc lại danh tính qua cấu hình thực trong container. File chuyển tạm
ở /root bị xóa sau thành công. Backup riêng ở cd/backups/credentials-* có secret,
không đưa lên Git/chat. Nếu lỗi sau khi ghi, cần kiểm tra riêng backup và health;
không restore DB. Worker giữ cấu hình hiện có và tiếp tục xử lý bình thường sau
khi backend chạy lại; helper không chủ động gọi API gửi bài/tin.
