# Mobile Server Handoff

Cập nhật: 2026-08-13
Nguồn máy đọc: [mobile-api-fixtures.json](api/mobile-api-fixtures.json)

## Mục tiêu

`seed:mobile-test` tạo hoặc dùng lại dữ liệu kiểm thử mobile qua HTTP API thật:

- 5 tài khoản nền, đủ 5 role.
- 22 tin public để kiểm tra trang 1/trang 2 và tìm kiếm.
- Bình luận `approved`, `pending`, `rejected`.
- Văn bản PDF public/internal và 3 bản đồ PDF public.
- 6 phản ánh, đủ 5 trạng thái, đủ số ảnh 0–5 và GeoJSON Point/LineString/Polygon.
- 3 mobile draft: Point, LineString, Polygon.
- Đo khoảng cách, diện tích, thời tiết.
- Mapbox Directions: `driving`, `walking`, `cycling`.
- Point layer cho catalog/feature/nearby.
- Editable LineString layer cho TNMT, history/restore và sync `applied`/`conflict`/`rejected`.
- Raster metadata nếu storage/raster service sẵn sàng.

KTTV không nằm trong contract hiện hành. Router KTTV đã bị gỡ; runner và manifest không gọi route KTTV.
Routing giữ endpoint nội bộ nhưng backend gọi Mapbox; không dựng pgRouting topology.

## Tài khoản nền

| Role           | Email                   |
| -------------- | ----------------------- |
| `system_admin` | `admin@campha.gov.vn`   |
| `ubnd_tp`      | `ubnd@campha.gov.vn`    |
| `so_tnmt`      | `tnmt@campha.gov.vn`    |
| `so_xd`        | `xaydung@campha.gov.vn` |
| `citizen`      | `citizen@campha.gov.vn` |

Mật khẩu không lưu trong repo, manifest hoặc tài liệu. Đặt mật khẩu bằng `API_TEST_PASSWORD` trong terminal hiện tại.
Runner chỉ giữ access/refresh token trong RAM. Manifest không chứa token, API key, presigned URL hoặc credential.

## Chạy seed và verify

Chạy từ backend:

```powershell
$env:API_BASE_URL='http://127.0.0.1:3006'
$env:API_TEST_PASSWORD='<secret nội bộ>'
npm run seed:mobile-test
npm run acceptance:verify
```

Chạy từ workspace mobile:

```powershell
$env:API_BASE_URL='http://127.0.0.1:3006'
$env:API_TEST_PASSWORD='<secret nội bộ>'
npm --prefix '..\server-campha' run seed:mobile-test
npm --prefix '..\server-campha' run acceptance:verify
```

Runner idempotent theo `API_FIXTURE_PREFIX`, mặc định `MOBACC`. Không dùng `reset-and-seed.js`; script đó xóa dữ liệu.

## Điều kiện dịch vụ

Manifest ghi từng module:

- `ready`: fixture đã tạo và read-back qua API.
- `conditional`: upstream hoặc worker chưa sẵn sàng; không tạo dữ liệu giả.
- `manual`: trạng thái nằm trên thiết bị, backend không thể seed.

| Module               | Điều kiện                                    |
| -------------------- | -------------------------------------------- |
| File/PDF/ảnh         | MinIO, file signature, commit và scan sạch   |
| Raster               | MinIO và raster service                      |
| GIS import           | `LAYER_WORKER_ENABLED`, GDAL, worker         |
| Map publish          | GeoServer datastore trỏ đúng DB              |
| Routing              | `MAPBOX_DIRECTIONS_TOKEN` và Mapbox online   |
| Weather              | OpenWeather config và upstream online        |
| Push                 | Firebase và khóa mã hóa device token         |
| Email xác minh/reset | SMTP và email nhận thật                      |
| Offline queue        | Tạo trong SQLite mobile khi thiết bị offline |

Lần chạy local 2026-08-13 dừng ở `documents` với `MALWARE_SCANNER_UNAVAILABLE`: không có `clamd`, `clamscan`, Docker hoặc listener `127.0.0.1:3310`. Bật ClamAV rồi chạy lại hai lệnh; không tắt cơ chế fail-closed. Manifest hiện giữ `auth`/`cmsNews` là `ready`, module phụ thuộc file là `conditional`.

ID có thể đổi giữa môi trường. Luôn đọc ID từ manifest sau bootstrap; không hardcode ID vào mobile production.

## Endpoint mobile chính

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
POST /api/v1/auth/forgot-password
POST /api/v1/auth/change-password

GET  /api/v1/cms/news
GET  /api/v1/cms/news/:id
GET  /api/v1/cms/news/:id/comments
GET  /api/v1/cms/documents
GET  /api/v1/cms/documents/:id/download-url
GET  /api/v1/cms/pdf-maps
GET  /api/v1/cms/pdf-maps/:id/download-url

GET  /api/v1/field-reports/public
GET  /api/v1/field-reports/nearby
GET  /api/v1/field-reports/mine
GET  /api/v1/field-reports/:id
POST /api/v1/field-reports
PUT  /api/v1/devices/push-token

POST /api/v1/mobile/measure
GET  /api/v1/mobile/drafts
POST /api/v1/mobile/drafts
GET  /api/v1/mobile/weather/current
POST /api/v1/mobile/routes/shortest
GET  /api/v1/mobile/layers/:layerId/features/:featureId
PATCH /api/v1/mobile/layers/:layerId/features/:featureId
GET  /api/v1/mobile/layers/:layerId/features/:featureId/history
POST /api/v1/mobile/layers/:layerId/features/:featureId/restore/:version
POST /api/v1/mobile/sync
GET  /api/v1/mobile/layers/:layerId/nearby
GET  /api/v1/mobile/layers/:layerId/tiles/:z/:x/:y.mvt
GET  /api/v1/web-map/layers
```

## Contract quan trọng

- Response thường: `{ message, status, data }`.
- List phân trang: `{ data: { items }, metadata }`.
- Một số nearby trả `data` array trực tiếp.
- Role nằm ở `data.user.role.code`.
- GeoJSON dùng `[longitude, latitude]`.
- Measure trả `length_m` hoặc `area_m2`.
- Routing gửi `{ start, end, profile }`; profile gồm `driving`, `walking`, `cycling`.
- Routing trả `provider`, `profile`, `distance_m`, `duration_s`, `geometry`, `steps`, `snapped_start`, `snapped_end`.
- `MAPBOX_DIRECTIONS_TOKEN` chỉ nằm backend.
- Editable feature chỉ dành cho đúng role `so_tnmt` có `map_feature.update` và ACL `can_edit`.
- Optimistic update dùng `baseVersion`; field report/draft admin flow dùng `expectedUpdatedAt`.
- Download Document/PDF trả backend ticket URL ngắn hạn; mobile không ghép MinIO URL.
- File qua ticket có endpoint `GET /api/v1/storage/objects/:fileObjectId/file?ticket=:ticket`.
- GeoTIFF là raster: render qua GeoServer WMS + Mapbox `RasterSource`/`RasterLayer`; không dùng MVT.
- WMS 1.3.0 dùng `crs`, literal `{bbox-epsg-3857}`, `crs=EPSG:3857`, `format=image/png`, `transparent=true`. Không gửi `srs`; Joi có thể strip và fallback `EPSG:4326`, gây lệch ảnh không báo lỗi. Xem [wms-getmap.bru](api/bruno/Map-Proxy/wms-getmap.bru).
- Layer raster không public cần tile ticket vì `RasterSource` không gắn Bearer header lên từng tile: gọi `GET /maps/layers/:layerId/tile-ticket?access=view`, rồi nhúng `ticket` vào URL WMS. Ticket khoảng 15 phút theo `MAP_TILE_TICKET_TTL`, khóa theo `layerId` và `access`; ticket `view` không dùng cho WFS `export`. Xem [tile-ticket.bru](api/bruno/Map-Proxy/tile-ticket.bru).
- Mobile đã có cache/refresh ticket trong `MapRepository.validRasterTileTicket`; layer public không cần ticket.
- Forest Classification là module runtime/API/worker đang hỗ trợ; mobile dùng các endpoint `/forest-classification/*` theo RBAC hiện hành.
- HTTP `200` chưa đủ: mobile phải kiểm tra `data`, trạng thái nghiệp vụ và lỗi RBAC.

## Gate trước staging

1. Chạy seed và verifier trên đúng DB staging không chứa dữ liệu production.
2. Chạy Android/iOS thật, GPS/camera permission, mạng yếu, background/resume.
3. Test đăng ký, email xác minh, quên mật khẩu bằng email dùng một lần.
4. Test offline conflict bằng hai client hoặc sửa server sau khi client lưu offline.
5. Cấp token Mapbox/OpenWeather/Firebase production riêng, quyền tối thiểu.
6. Chạy monitoring, restore drill, load test và pentest riêng.
