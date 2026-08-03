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
