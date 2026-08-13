# Checklist cài đặt VPS — Cam Pha WebGIS API

Dùng cho **Ubuntu 24.04 LTS**, triển khai native: **không Docker**, **không Redis**, dùng `systemd` thay PM2. Dịch vụ đã chạy tốt thì chỉ kiểm tra cấu hình, không cài lại.

## 1. Gói bắt buộc

```bash
sudo apt update
sudo apt install -y \
  ca-certificates curl jq git unzip libarchive-tools \
  build-essential python3 nginx certbot python3-certbot-nginx \
  postgresql-client-16 gdal-bin proj-bin libgeos-dev \
  clamav clamav-daemon clamav-freshclam
```

Cài **Node.js 24 LTS** từ repository chính thức đã xác minh.

```bash
node --version
npm --version
psql --version
pg_dump --version
ogr2ogr --version
projinfo EPSG:5899
clamscan --version
nginx -v
```

> Nếu Ubuntu repository chưa có `postgresql-client-16`, thêm PostgreSQL APT repository chính thức. Client nên cùng major version 16 với server.

## 2. User và thư mục dịch vụ

Không chạy API bằng `root`.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin campha-api
sudo mkdir -p /opt/campha/server /etc/campha/secrets /var/lib/campha/backups /var/log/campha
sudo chown -R campha-api:campha-api /opt/campha /var/lib/campha /var/log/campha
sudo chown root:campha-api /etc/campha/secrets
sudo chmod 750 /etc/campha/secrets
```

Secret files dự kiến:

```text
/etc/campha/secrets/minio-access-key
/etc/campha/secrets/minio-secret-key
/etc/campha/secrets/geoserver-password
/etc/campha/secrets/firebase-service-account.json
/etc/campha/secrets/gge-service-account.json
```

```bash
sudo chown root:campha-api /etc/campha/secrets/*
sudo chmod 640 /etc/campha/secrets/*
```

Không đưa secret vào Git, shell history, log hoặc chat.

## 3. Deploy Node API

```bash
sudo -u campha-api git clone <REPOSITORY_URL> /opt/campha/server
cd /opt/campha/server
sudo -u campha-api npm ci --omit=dev
sudo -u campha-api npm run migrate:status
sudo -u campha-api npm run security:audit
```

Không chạy seed production. Năm seed account cũ đã bị vô hiệu hóa; tạo/rotate admin thật theo quy trình riêng.

Tạo `/etc/campha/api.env`, owner `root:campha-api`, quyền `640`:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3006
TRUST_PROXY=1

CLAMAV_ENABLED=true
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310

GOOGLE_CALLBACK_URL=https://api.example.vn/api/v1/auth/google/callback
FRONTEND_URL=https://app.example.vn
API_BASE_URL=https://api.example.vn
MINIO_PROXY_TIMEOUT_MS=120000
```

Bổ sung biến DB, JWT, SMTP, MinIO, GeoServer, Firebase, GEE và OpenWeather từ secret store.

## 4. Systemd cho API

Tạo `/etc/systemd/system/campha-api.service`:

```ini
[Unit]
Description=Cam Pha WebGIS API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=campha-api
Group=campha-api
WorkingDirectory=/opt/campha/server
EnvironmentFile=/etc/campha/api.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/campha /var/log/campha
UMask=0027
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Xác nhận đường dẫn Node bằng `command -v node`, rồi:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now campha-api
sudo systemctl status campha-api --no-pager
sudo journalctl -u campha-api -n 100 --no-pager
```

## 5. ClamAV

```bash
sudo freshclam
sudo systemctl enable --now clamav-freshclam
sudo systemctl enable --now clamav-daemon
```

Trong `/etc/clamav/clamd.conf`:

```text
TCPSocket 3310
TCPAddr 127.0.0.1
StreamMaxLength 2G
```

```bash
sudo systemctl restart clamav-daemon
printf 'zPING\0' | nc 127.0.0.1 3310
```

Kết quả phải là `PONG`.

UAT bắt buộc qua API:

```text
Clean PDF → ready / clean / có SHA-256
EICAR → HTTP 422 / rejected / infected
Dừng clamd → HTTP 503 / không promote
Khởi động clamd → retry thành công
```

## 6. PostgreSQL/PostGIS

Nếu DB nằm VPS khác: chỉ cần client 16 và private route. Nếu cùng VPS, cài thêm:

```text
postgresql-16
postgresql-16-postgis-3
postgresql-16-postgis-3-scripts
```

Không public `5432`.

Trước migration:

```bash
pg_dump --format=custom --compress=9 \
  --file=/var/lib/campha/backups/campha-$(date +%F-%H%M%S).dump \
  "$DATABASE_URL"
pg_restore --list /var/lib/campha/backups/campha-*.dump >/dev/null
sha256sum /var/lib/campha/backups/campha-*.dump
```

Sau backup:

```bash
cd /opt/campha/server
sudo -u campha-api npm run migrate
sudo -u campha-api npm run migrate:status
```

## 7. GDAL/OGR, PROJ, GEOS — Sprint 3

```bash
ogrinfo --formats | grep -E 'PostgreSQL|ESRI Shapefile|GeoJSON'
projinfo EPSG:5899
```

Bắt buộc:

```text
gdal-bin
proj-bin
GEOS
unzip
libarchive-tools
```

QGIS không cần cài trên VPS; dùng tại máy quản trị/UAT.

## 8. MinIO

Nếu đã chạy tốt: không cài lại. Khuyến nghị cài MinIO client `mc`.

Năm bucket private:

```text
campha-layers
campha-raster
campha-documents
campha-field-photos
campha-quarantine
```

Kiểm tra:

```text
Anonymous access: 403
Quarantine expiration: 1 ngày
Multipart dở: abort sau 1 ngày
API chỉ proxy bucket cấu hình khi URL có X-Amz-Signature
GET/HEAD/PUT dùng MINIO_USE_SSL và timeout; client abort hủy upstream
```

Download tệp có `core.file_objects.id` dùng backend ticket, không dùng direct bucket URL. Xem `docs/STORAGE_AND_RASTER_OPERATIONS.md`.

## 9. GeoServer

Nếu đã chạy tốt: không cài lại. Cài mới cần:

```text
OpenJDK 21 JRE
GeoServer
PostGIS extension/plugin
ImageMosaic extension
```

Kiểm tra:

```text
REST health
Workspace + PostGIS datastore
WMS GetMap
WFS GetFeature
SLD styles
ImageMosaic
Không dùng WFS-T
```

## 10. Xác thực người dùng

Sản phẩm dùng email/password nội bộ và Google OAuth.

Kiểm soát bắt buộc gồm rate limit, khóa lũy tiến, JWT access ngắn hạn, refresh rotation/replay detection, RBAC PostgreSQL và email verification.

## 11. Google OAuth, Firebase, GEE, OpenWeather

Không cần package OS riêng. Cần:

```text
Google OAuth client ID/secret
Firebase service-account JSON
GEE service-account JSON
OpenWeather API key
```

Google Cloud Console phải có callback production đúng tuyệt đối:

```text
https://api.example.vn/api/v1/auth/google/callback
```

Không dùng callback `localhost` trên production.

## 12. Nginx và HTTPS

Tạo `/etc/nginx/sites-available/campha-api`:

```nginx
server {
    listen 80;
    server_name api.example.vn;
    client_max_body_size 2g;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/campha-api /etc/nginx/sites-enabled/campha-api
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d api.example.vn
sudo certbot renew --dry-run
```

Thay domain ví dụ bằng domain thật. `proxy_read_timeout` phải lớn hơn thời gian stream tệp lớn dự kiến; Node/MinIO proxy vẫn giữ timeout riêng. Không thêm Nginx `location` public trỏ thẳng `:9000`: API xử lý ticket/SigV4 proxy.

## 13. Firewall

Chỉ public:

```text
22/tcp  SSH — giới hạn IP nếu có thể
80/tcp  HTTP redirect
443/tcp HTTPS
```

Private/loopback:

```text
3006 Node API
3310 ClamAV
5432 PostgreSQL
9000 MinIO API
9001 MinIO Console
GeoServer port
```

Ví dụ UFW:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose
```

> Không bật UFW qua SSH trước khi xác nhận rule `OpenSSH`. MinIO/GeoServer public ports chỉ là residual risk tạm thời; đóng `9000/9001` trước production vì backend ticket/SigV4 proxy đã thay ingress trực tiếp.

## 14. Backup và giám sát

Cần:

```text
systemd timer/cron cho pg_dump
MinIO backup hoặc replication
Backup GeoServer data directory
Backup mã hóa env/secret
logrotate
HTTPS health check
Restore test định kỳ
```

Backup phải được đồng bộ ra nơi độc lập với VPS. Phải test restore, không chỉ kiểm tra file tồn tại.

## 15. Checklist nghiệm thu

```text
[ ] Node.js 24 + npm
[ ] Git, curl, jq, ca-certificates
[ ] Nginx + HTTPS + Certbot renewal
[ ] systemd `campha-api` chạy non-root
[ ] PostgreSQL client 16 + pg_dump/pg_restore
[ ] PostgreSQL/PostGIS nếu DB cùng VPS
[ ] GDAL/OGR + PROJ + GEOS + unzip/libarchive
[ ] ClamAV + FreshClam + clean/EICAR/down UAT
[ ] MinIO + 5 private buckets + lifecycle
[ ] GeoServer + PostGIS + ImageMosaic + read-only WMS/WFS UAT
[ ] Google OAuth production callback UAT
[ ] Firebase/GEE/OpenWeather secrets
[ ] Firewall chỉ public 22/80/443
[ ] Backup + checksum + restore test theo `docs/BACKUP_RESTORE_RUNBOOK.md`
[ ] WAL archive/base backup/PITR drill trên instance biệt lập
[ ] Prometheus + Grafana native systemd, bind private/local
[ ] `METRICS_ENABLED=true`, token file mode `0600`, `/metrics` không public qua Nginx
[ ] Alert HTTP 5xx/p95, DB pool, layer job failed/stuck
[ ] Server timeout env: request 30s, headers 15s, keep-alive 5s, shutdown 10s
[ ] k6 500 VU chỉ staging; p95 < 800 ms, lỗi < 1%
[ ] Logrotate + health monitoring
[ ] `npm ci --omit=dev`
[ ] `npm run migrate:status`
[ ] `npm run security:audit` → 0 production vulnerabilities
[ ] `API_BASE_URL` sinh URL `/api/v1/storage/objects/:id/file?ticket=...`
[ ] CMS PDF download: 200, `application/pdf`, magic `%PDF-`; ticket sai trả 403
[ ] Postman active route audit: 152/152; KTTV chỉ nằm folder Legacy
```

Không cài:

```text
Redis
Docker
PM2 nếu dùng systemd
QGIS trên VPS
```
