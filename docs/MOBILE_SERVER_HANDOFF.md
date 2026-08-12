# Mobile Server Handoff

Cập nhật: 2026-08-08  
Môi trường nghiệm thu: `campha_mobile_acceptance`  
API local đã nghiệm thu: `http://127.0.0.1:3018/api/v1`

## Kết luận

**GO cho phát triển mobile** với auth, CMS, văn bản/PDF, raster catalog, phản ánh hiện trường,
weather, draft/measure, bản đồ điểm/MVT/nearby/feature, KTTV manual/automatic, API registry,
offline sync, feature edit/history/restore và Mapbox Directions qua backend proxy.

> Routing pgRouting/topology nghiệm thu trước đây đã bị thay thế ngày 2026-08-11.
> Mobile giữ endpoint nội bộ; backend gọi Mapbox và giữ token Directions trong `.env`.

GEE không thuộc gate mobile này. Server đã chạy degraded khi GEE unavailable.

## Fixture manifest

Nguồn máy đọc: [mobile-api-fixtures.json](./api/mobile-api-fixtures.json).

| Fixture             | Giá trị ổn định                           |
| ------------------- | ----------------------------------------- |
| Prefix              | `MOBACC`                                  |
| News                | ID `1`                                    |
| Document            | ID `1`, code `MOBACC-DOC-001`             |
| PDF map             | ID `1`                                    |
| Raster              | ID `1`, scene `MOBACC-S2-20260808`        |
| Field report        | ID `1`, `CP-2026-00000001`                |
| Mobile draft        | ID `1`                                    |
| KTTV station        | `MOBACC01`                                |
| Scenarios           | `MOBACC_RAIN_NORMAL`, `MOBACC_RAIN_HEAVY` |
| Published GIS layer | ID `1`, code `mobacc_mobile_points`       |
| Feature test        | ID `2`                                    |
| API registry        | ID `1`, slug `mobacc-mobile-points`       |

ID chính xác phải đọc lại từ manifest sau mỗi lần bootstrap; không hardcode ID ở mobile production.

## Tài khoản nền

| Role           | Email                   |
| -------------- | ----------------------- |
| `system_admin` | `admin@campha.gov.vn`   |
| `ubnd_tp`      | `ubnd@campha.gov.vn`    |
| `so_tnmt`      | `tnmt@campha.gov.vn`    |
| `so_xd`        | `xaydung@campha.gov.vn` |
| `citizen`      | `citizen@campha.gov.vn` |

Mật khẩu không lưu trong repo/manifest. Nhận qua kênh secret nội bộ rồi đặt `API_TEST_PASSWORD`.
Token login, refresh token và API share key chỉ giữ trong RAM; bootstrap không ghi chúng ra file.

## Chạy lại acceptance

```powershell
$env:API_BASE_URL='http://127.0.0.1:3018'
$env:API_TEST_PASSWORD='<secret>'
npm run acceptance:bootstrap
npm run acceptance:verify
```

`acceptance:bootstrap` idempotent theo prefix. Runner:

- Login 5 role.
- Tạo hoặc reuse fixture qua HTTP API.
- Upload qua presign URL, MinIO quarantine, file signature và ClamAV.
- Read-back mọi fixture qua API.
- Không gọi repository/SQL để dựng dữ liệu nghiệp vụ.
- Ghi manifest không chứa secret.

`acceptance:verify` login mới và chạy 30 kiểm tra HTTP độc lập, gồm RBAC âm.

## Endpoint mobile chính

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/auth/me

GET  /api/v1/cms/news
GET  /api/v1/cms/news/:id
GET  /api/v1/cms/documents
GET  /api/v1/cms/pdf-maps

GET  /api/v1/field-reports/public
GET  /api/v1/field-reports/nearby
POST /api/v1/field-reports
PUT  /api/v1/devices/push-token

POST /api/v1/mobile/measure
GET  /api/v1/mobile/drafts
POST /api/v1/mobile/drafts
GET  /api/v1/mobile/weather/current
GET  /api/v1/mobile/layers/:layerId/tiles/:z/:x/:y.mvt
GET  /api/v1/mobile/layers/:layerId/features/:featureId
GET  /api/v1/mobile/layers/:layerId/nearby
POST /api/v1/mobile/routes/shortest

GET  /api/v1/web-map/layers
```

KTTV hiện là module admin:

```text
GET  /api/v1/admin/kttv/stations
GET  /api/v1/admin/kttv/scenarios
GET  /api/v1/admin/kttv/inputs
POST /api/v1/admin/kttv/inputs/manual
POST /api/v1/admin/kttv/sources/:id/collect
```

## Contract quan trọng

- Response thường: `{ message, status, data }`.
- List phân trang: `{ data: { items }, metadata }`.
- Một số nearby/list chuyên biệt trả `data` array trực tiếp.
- Auth user role nằm ở `data.user.role.code`.
- Geometry dùng GeoJSON, thứ tự tọa độ `[longitude, latitude]`.
- Measure trả `area_m2` hoặc `length_m`.
- Routing gửi `{ start, end, profile }`; `profile` là `driving`, `walking` hoặc `cycling`.
- Routing trả `provider`, `profile`, `distance_m`, `duration_s`, `geometry`, `snapped_start`, `snapped_end`.
- Token `MAPBOX_DIRECTIONS_TOKEN` chỉ nằm ở backend; không trả về response/log.
- Optimistic update gửi `expectedUpdatedAt` ISO từ `updated_at` read-back gần nhất.
- API không coi HTTP `200` là đủ: mobile phải kiểm tra `data`, trạng thái nghiệp vụ và lỗi RBAC.

## Kết quả nghiệm thu lưu tại thời điểm handoff

- Inventory tĩnh: **158 route handlers**.
- Live HTTP happy-path: **150/158 route**; tăng từ 72 lên 150.
- 8 route còn lại được phân loại, không giả PASS:
    - 7 auth route cần Google/email/OAuth account thật.
    - 1 terrain URL chưa có API ingest tạo `geotiff_minio` fixture.
- `/metrics` đã live 200, payload Prometheus 62.651 bytes; count reconciled ngoài parser `/api/v1`.
- GeoServer retry publish đã sửa exact `already exists`; `POST /admin/layers/1/publish` live 200.
- Registry delete live: temporary published layer, create 201, delete 200, read-back 404,
  layer cleanup; fixture registry `1` vẫn `GET`-only.
- Statistics create/update/refresh/compare đã live 200/201 trên hai polygon layer tạm.
- Routing lịch sử rebuild/topology/shortest đã live 200 trên LineString tạm; luồng này nay bị Mapbox backend proxy thay thế.
- Ba layer polygon/routing lịch sử đã soft-delete qua API; fixture chính vẫn nguyên.
- Lifecycle tạm đã dọn qua HTTP: users, sessions, storage, CMS, raster, field report,
  draft, shared feature/key, KTTV source/station, Shapefile layer.
- Bootstrap lần đầu: 96 request HTTP.
- Bootstrap rerun idempotent: đạt; không tạo lại manual fixture hoặc API key sau fix.
- Verify sau cleanup: 30/30; MVT đúng content type và body **150 bytes**.
- HTML acceptance console: 45 case; người dùng chạy browser và xác nhận xanh toàn bộ.
- Unit: 47 suites, 338 tests đạt; 1 suite/6 tests skip có chủ đích.
- Integration trên `campha_test`: 20/20 suites, 92/92 tests đạt.
- Coverage baseline: lines 38,50%, functions 31,46%, branches 30,42%.
- K6 local: 20 VU/15 giây, 1.500 request, 0% lỗi, p95 2,1 ms.
- ESLint: đạt.
- `git diff --check`: đạt; chỉ cảnh báo LF/CRLF.
- Production dependency audit: 0 vulnerabilities.
- Credential scan: 241 file; không phát hiện private key/JWT/AWS/Google API key.

## Gate ngoài local acceptance

Trước staging/production cần làm riêng:

1. Thay secret acceptance bằng secret quản lý tập trung.
2. Chạy UAT trên Android/iOS thật và mạng yếu.
3. Cấp token Mapbox production riêng, quyền tối thiểu; duyệt quota, billing và coverage.
4. Chạy ClamAV, MinIO, GeoServer, PostGIS bằng dịch vụ production có monitoring.
5. Chạy k6 staging, restore drill, alerting và pentest Sprint 14.
6. Đối chiếu QGIS và dữ liệu nền/DEM/polygon nghiệp vụ thật.
