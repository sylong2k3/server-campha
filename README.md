# Server Cẩm Phả HydroMap

Server API cho hệ thống WebGIS & MobileGIS Cẩm Phả HydroMap (thành phố Cẩm Phả).

## Nền tảng hiện có

- Express 5: middleware bảo mật, CORS, rate limit, nén và graceful shutdown.
- Auth/RBAC: JWT access/refresh token, xác minh email, quên mật khẩu, Google OAuth.
- 5 vai trò đăng nhập: `system_admin`, `ubnd_tp`, `so_tnmt`, `so_xd`, `citizen`.
  Khách dùng endpoint công khai; GEE dùng service account.
- Đa tổ chức qua `auth.organizations` và `auth.users.org_id`.
- Nền ACL lớp qua `gis.layers` và `gis.layer_permissions`.
- PostgreSQL/PostGIS, MinIO, GeoServer, Google Earth Engine, Firebase, SMTP,
  OpenWeather và Open-Meteo.

## Cấu hình

Tạo `.env` và khai báo tối thiểu:

- `DB_*`, `JWT_SECRET*`, `SMTP_*`, `GOOGLE_*`
- `MINIO_*`, `GEOSERVER_*`, `OPENWEATHER_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT*`
- `KTTV_CREDENTIAL_ENCRYPTION_KEY`: 64 ký tự hex, dùng riêng từng môi trường.
- `KTTV_ALLOWED_SOURCE_HOSTS`: allowlist host Weather API, phân tách bằng dấu phẩy.
- `KTTV_COLLECTION_ENABLED=true`: bật scheduler REST/JSON; mặc định `false`.
- `KTTV_SCHEDULE_SYNC_CRON`: lịch đồng bộ cấu hình nguồn, mặc định `*/5 * * * *`.

Scheduler KTTV chỉ chạy trên singleton worker (`CLUSTER_WORKER_ID=0` hoặc tiến trình không cluster).
Với nhiều replica độc lập, chỉ đặt `KTTV_COLLECTION_ENABLED=true` trên một replica/worker.
Secret dịch vụ phải nằm ngoài mã nguồn và không dùng chung giữa các môi trường.

## Chạy dự án

```bash
npm install
npm run migrate
npm run seed:users
npm run dev
```

`seed:users` chỉ dành cho local/dev. Production phải cấp tài khoản và mật khẩu qua quy trình quản trị an toàn.

## Tài liệu

- [Kế hoạch xây dựng hệ thống](docs/KE_HOACH_XAY_DUNG_HE_THONG.md)
- [Ma trận phân quyền](docs/MA_TRAN_PHAN_QUYEN.csv)
