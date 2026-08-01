# Sprint 6a — Kho ảnh vệ tinh và tra cứu

## Sprint goal

Duyệt, tìm kiếm, phân nhóm, so sánh và tải ảnh Sentinel/Landsat qua REST API; chưa chạy Google Earth Engine.

## Stories

| Story | Phạm vi | Trạng thái |
|---|---|---|
| US-6a.1 | Metadata Sentinel-1/2, Landsat-7/8; thêm/xóa | Done kỹ thuật |
| US-6a.2 | Phân nhóm chuyên đề | Done kỹ thuật |
| US-6a.3 | Tìm theo thời gian, platform, nhóm, tên/mã cảnh | Done kỹ thuật |
| US-6a.4 | Pagination 1–100, sort thời gian asc/desc | Done kỹ thuật |
| US-6a.5 | So sánh 2 thời điểm cùng `coverage_key` | Done kỹ thuật |
| US-6a.6 | Download login-only theo `raster.download` | Done kỹ thuật; live MinIO UAT deferred |

## API contract

Postman-only:

- `GET /api/v1/remote-sensing/images`
- `GET /api/v1/remote-sensing/images/:id`
- `GET /api/v1/remote-sensing/compare`
- `GET /api/v1/remote-sensing/images/:id/download-url`
- `GET/POST /api/v1/admin/remote-sensing/images`
- `PATCH /api/v1/admin/remote-sensing/images/:id/category`
- `DELETE /api/v1/admin/remote-sensing/images/:id`

Swagger/OpenAPI và `/api/docs` đã bị xóa theo quyết định sản phẩm.

## Security controls

- Tái sử dụng storage `presign → quarantine → magic-byte → ClamAV → SHA-256 → ready`.
- Create metadata chỉ nhận GeoTIFF owner-owned, ready, clean, category `raster`.
- Không serialize bucket/object key hoặc internal user/file IDs.
- Compare anonymous: presigned URL 60 giây; yêu cầu cùng coverage và đúng thứ tự thời gian.
- Download: JWT + `raster.download`; URL 60–900 giây; 20 request/15 phút/user.
- Admin create/delete/categorize/read lấy quyền từ DB; optimistic `updated_at`; audit mutations/download.

## Evidence

```text
Migration campha_test:       000–010 + 020 applied/checksum OK
ESLint:                     passed
Unit:                       150 passed; 6 GDAL-local skipped
Integration:                36 passed
Global branch coverage:     79.04%
Remote-sensing branches:    83.33%
Production npm audit:       0 vulnerabilities
Postman Sprint 6a:          11 requests; JSON/runtime/secret checks passed
Swagger/OpenAPI:            file/packages/runtime removed; /api/docs = 404
Git diff check:             passed
Production migration state: 000–006 applied; 007–010 + 020 pending
```

## Deferred

- Production `campha` chưa áp `007–010` và `020`.
- Live Postman UAT cần MinIO private, `clamd`, 3 GeoTIFF Sentinel/Landsat thật.
- QGIS kiểm chứng dữ liệu raster thật chưa chạy vì chưa có fixture ảnh.
- Sprint 6b GEE là checkpoint riêng sau Sprint 6a.