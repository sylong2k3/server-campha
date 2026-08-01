# Sprint 7 — Phân tích không gian và thống kê độc lập GEE

## Sprint goal

Tính và so sánh diện tích từ các lớp polygon PostGIS đã publish, không gọi hoặc phụ thuộc Google Earth Engine.

## Ownership boundary

- Sprint 6a/6b và toàn bộ Google Earth Engine: cộng sự phụ trách.
- Sprint 7 chỉ nhận `gis.layers` PostGIS có ACL và metadata do quản trị đăng ký.
- Không chỉnh sửa mã nguồn/config/worker/migration GEE.

## Stories

| Story | Phạm vi | Trạng thái |
|---|---|---|
| US-7.1 | Diện tích ngập từ polygon PostGIS | Done kỹ thuật |
| US-7.2 | Diện tích khu dân cư từ polygon PostGIS | Done kỹ thuật |
| US-7.3 | So sánh tăng/giảm/không đổi giữa hai thời điểm | Done kỹ thuật |
| US-7.4 | Chuỗi diện tích theo năm, phường/xã | Done kỹ thuật |
| US-7.5 | Nguồn `infrastructure` theo năm/đơn vị hành chính | Done nền API |
| US-7.7 | Bảng tổng hợp + transactional refresh/advisory lock | Done kỹ thuật |
| US-7.6 | PDF/DOCX/XML/ODT | Deferred — làm riêng sau khi schema thống kê ổn định |

## Postman-only API

- `GET /api/v1/statistics/sources`
- `GET /api/v1/statistics/areas`
- `GET /api/v1/statistics/timeseries`
- `GET /api/v1/statistics/compare`
- `POST /api/v1/admin/statistics/sources`
- `PATCH /api/v1/admin/statistics/sources/:id`
- `POST /api/v1/admin/statistics/sources/:id/refresh`

## Security

- Read yêu cầu `stats.view`; create/update/refresh/compare yêu cầu `spatial.analyze`.
- Layer ACL `can_view` được kiểm tra theo role, không `system_admin` bypass.
- Table/column identifier lấy từ registry server-side, strict allowlist + SQL quoting.
- Giá trị input parameterized; unknown fields bị từ chối.
- Nguồn phải là polygon PostGIS published, geometry hợp lệ, đồng nhất SRID.
- Refresh dùng advisory transaction lock và statement timeout 120 giây.
- Compare chỉ cùng `source_type`; response geometry simplify trước khi trả.

## Evidence

```text
campha_test migrations 021–022: applied/checksum OK
Sprint 7 unit: 13 passed
Sprint 7 focused integration: 12 passed
Full integration: 44 passed
Exact area fixture: 10,000 m²
Exact delta fixture: 5,000 m²
Anonymous read: 401
Citizen read: 200
Citizen create: 403
Citizen DB permissions: `stats.view=true`, không `stats.export`, không `spatial.analyze`
4 manager roles: `stats.view`, `stats.export`, `spatial.analyze`
Unsafe identifier: 400
```

## Deferred UAT

- Cần lớp ngập/dân cư/hạ tầng/ranh giới thật trong PostGIS.
- Đối chiếu diện tích và geometry compare bằng QGIS.
- Production `campha` chưa áp migration Sprint 7.