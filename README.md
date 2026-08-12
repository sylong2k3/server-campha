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

## Flood/Hydrology M1–M5

- M1: ngập sự kiện Sentinel-1, tách sản phẩm chính khỏi lớp QA thủy triều/khai thác.
- M2: kịch bản HAND và độ sâu tương đối.
- M3: điểm nguy cơ mưa tổng hợp, **không phải xác suất** (`PROBABILITY_CALIBRATED=false`).
- M4: dân số, đất xây dựng, cây trồng và lớp phủ bị ảnh hưởng.
- M5: tần suất, ngập mới/thường xuyên, ao sang xây dựng, nhạy cảm thoát nước và kiểm định S2/MNDWI.

Luồng artifact: `GEE → GCS → kiểm tra GeoTIFF/CRS/COG/checksum → MinIO → GeoServer → gis.layers → WebGIS`. API công khai nằm tại `/api/v1/flood`; API quản trị có RBAC tại `/api/v1/admin/flood`.

## Forest Classification được giữ ACTIVE

- API: `/api/v1/forest-classification` (latest/query/snapshot/published history, admin refresh/publish và ground truth).
- Mô hình: giữ taxonomy 13 lớp và chuỗi Random Forest v5.3; không đổi thành mô hình Flood.
- Runtime: dùng queue GEE concurrency 1, child process riêng, cron tháng trên singleton worker và district raster export.
- Publication: bucket MinIO riêng, GeoServer verify, `gis.layers` và back-link district fail-closed; snapshot chỉ published khi đủ tập district cấu hình.
- RBAC: `system_admin`/`so_tnmt` quản lý và nhập ground truth; các vai trò còn lại đọc kết quả đã công bố.

## Cấu hình

Tạo `.env` và khai báo tối thiểu:

- `DB_*`, `JWT_SECRET*`, `SMTP_*`, `GOOGLE_*`
- `MINIO_*`, `GEOSERVER_*`, `OPENWEATHER_API_KEY`
- `GEE_KEY_PATH`: đường dẫn secret mount, không đưa JSON khóa vào repository.
- `FLOOD_GCS_BUCKET`, `FLOOD_GCS_SIGNED_URL_SECONDS`
- `FLOOD_INGEST_WAIT_TIMEOUT_MS`, `FLOOD_INGEST_POLL_INTERVAL_MS`
- `MINIO_BUCKET_FLOOD_RASTERS`, `MINIO_BUCKET_FLOOD_CALIBRATION`
- `MINIO_BUCKET_FOREST_CLASSIFICATION`
- `FC_ENABLED=true`, `FC_CRON`, `FC_CRON_TZ`
- `FC_BOUNDARY_GEOJSON`, `FC_DISTRICTS_GEOJSON`: ranh giới Cẩm Phả/đơn vị hành chính chính thức được mount ngoài source.
- `FC_EXPECTED_DISTRICT_COUNT`, `FC_AOI_TOTAL_HA`: phải được data owner chốt trước UAT production.
- `RASTER_INGEST_ENABLED`, `RASTER_INGEST_WORKER_POLL_CRON`
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
- [Kiến trúc tích hợp GEE Flood](../docs/GEE_FLOOD_INTEGRATION_ARCHITECTURE.md)
- [Nguồn gốc và giấy phép dữ liệu](../docs/FLOOD_DATA_PROVENANCE.md)
- [Ma trận thay thế Fire Risk](../docs/FIRE_RISK_TO_FLOOD_REPLACEMENT_MATRIX.md)
- [Kết quả triển khai Fire Risk → Flood/Hydrology](../docs/FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md)
