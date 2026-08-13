# Mobile Server Handoff

Cập nhật: 2026-08-08  
Môi trường nghiệm thu: `campha_mobile_acceptance`  
API local đã nghiệm thu: `http://127.0.0.1:3018/api/v1`

## Kết luận

**GO cho phát triển mobile** với auth, CMS, văn bản/PDF, raster catalog, phản ánh hiện trường,
weather, draft/measure, bản đồ điểm/MVT/nearby/feature, API registry, offline sync,
feature edit/history/restore và Mapbox Directions qua backend proxy. KTTV không nằm trong
contract mobile hiện hành vì router không được mount.

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
GET  /api/v1/cms/documents/:id/download-url
GET  /api/v1/cms/pdf-maps
GET  /api/v1/cms/pdf-maps/:id/download-url
GET  /api/v1/storage/objects/:fileObjectId/file?ticket=:ticket

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

KTTV chỉ còn request lịch sử trong folder Postman `Legacy - KTTV (không được mount)`. Source hiện tại không mount `/api/v1/admin/kttv`; mobile không gọi các URL này.

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
- CMS Document/PDF download trả backend ticket URL ngắn hạn; mobile fetch URL đó, không ghép path MinIO.
- GeoTIFF là raster: render qua GeoServer WMS + Mapbox `RasterSource`/`RasterLayer`; không dùng MVT.
- WMS template giữ literal `{bbox-epsg-3857}`, `srs=EPSG:3857`, `format=image/png`, `transparent=true`.
- Forest Classification đã bị loại khỏi runtime/API/worker ngày 2026-08-13.
- API không coi HTTP `200` là đủ: mobile phải kiểm tra `data`, trạng thái nghiệp vụ và lỗi RBAC.

## Kết quả nghiệm thu lịch sử

Các số bên dưới thuộc acceptance ngày 2026-08-08, trước khi bỏ KTTV/Forest và thêm Flood/Storage ticket. Không dùng chúng làm inventory hiện tại. Inventory source/Postman hiện hành ngày 2026-08-13: **152/152 route `/api/v1` active có request Postman**, KTTV nằm ngoài active audit.

Chi tiết test server mới nhất và live PDF/WMS nằm trong walkthrough ngày 2026-08-13. Chạy lại acceptance mobile trước staging; không kế thừa PASS lịch sử cho route đã thay đổi.

## Gate ngoài local acceptance

Trước staging/production cần làm riêng:

1. Thay secret acceptance bằng secret quản lý tập trung.
2. Chạy UAT trên Android/iOS thật và mạng yếu.
3. Cấp token Mapbox production riêng, quyền tối thiểu; duyệt quota, billing và coverage.
4. Chạy ClamAV, MinIO, GeoServer, PostGIS bằng dịch vụ production có monitoring.
5. Chạy k6 staging, restore drill, alerting và pentest Sprint 14.
6. Đối chiếu QGIS và dữ liệu nền/DEM/polygon nghiệp vụ thật.
