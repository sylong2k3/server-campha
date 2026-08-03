# Sprint 4 — WebGIS front-end API (A.2-1)

> Sprint 4 chỉ làm server API theo ranh giới E.0. Không dựng SPA, Redis hoặc Docker.

## Sprint goal

Cung cấp API đọc bản đồ cho khách và năm role DB: catalog lớp theo ACL, thuộc tính đối tượng, tìm kiếm tên tiếng Việt, chú giải/zoom, basemap và terrain/DEM từ MinIO.

## Stories

| Story | Phạm vi | SP | Trạng thái |
|---|---|---:|---|
| US-4.1 | Catalog lớp public/role ACL | 8 | Done kỹ thuật + Supertest anonymous/5 role |
| US-4.2 | Thuộc tính theo `layerId + featureId` | 8 | Done kỹ thuật + PostGIS integration |
| US-4.3 | Tìm tên tiếng Việt `unaccent + pg_trgm` | 13 | Done kỹ thuật + PostGIS fixture |
| US-4.4 | Chú giải + min/max zoom | 5 | Done kỹ thuật + ACL HTTP test |
| US-4.5 | Catalog basemap | 8 | Done kỹ thuật; OSM enabled, keyed providers deferred |
| US-4.6 | Terrain/DEM catalog + MinIO presigned URL | 13 | Done code/unit; live DEM/MinIO/3D UAT deferred |

**Tổng: 55 SP provisional.** US-3.8 Planning Poker chưa hoàn tất; chưa coi đây là cam kết.

## Acceptance

### US-4.1 — Catalog lớp

- Given anonymous, when gọi catalog, then chỉ nhận `is_public=true` và published.
- Given user thuộc role có `can_view`, then nhận public + layer được cấp.
- Given role không có ACL, then private layer không xuất hiện.

### US-4.2 — Thuộc tính

- Given layer được xem và feature tồn tại, then chỉ trả `metadata.displayFields`; geometry chỉ trả khi yêu cầu.
- Given layer raster hoặc chưa cấu hình display fields, then trả lỗi có kiểm soát.
- Given anonymous/private hoặc role không ACL, then trả 404 để không lộ sự tồn tại layer.

### US-4.3 — Tìm kiếm

- Given `Cẩm Phả`, when tìm `cam pha`, then `unaccent + pg_trgm` trả kết quả từ `metadata.searchFields`.
- Query, bbox, limit sai bị 400; limit cứng tối đa 50.
- Anonymous/5 role chỉ tìm trong catalog được phép.

### US-4.4 — Chú giải và zoom

- Trả `legend_config`, `style_name`, `min_zoom`, `max_zoom` theo layer ACL.
- Layer không được xem trả 404.

### US-4.5 — Basemap

- Chỉ trả provider enabled và không yêu cầu API key.
- OSM có attribution bắt buộc.
- Google/Bing/Cục Đo đạc chỉ bật sau khi có URL/credential hợp lệ; không hardcode key.

### US-4.6 — Terrain/DEM

- Catalog chỉ trả `geotiff_minio` có object key và đúng layer ACL.
- URL tải là presigned, hết hạn 60–900 giây, response không lộ MinIO credential.
- Không có DEM thật: automated fixture được phép; visual 3D UAT giữ deferred.

## Carry-over Sprint 3 bắt buộc

- Import promote + job complete atomic và fenced bằng worker lease.
- Cleanup heartbeat; terminal layer status chỉ đổi nếu worker còn lease.
- Import validation errors thay thế theo attempt, không ghi trùng.

## Exit gates

- [x] Migration `009` idempotent và checksum OK trên `campha_test`.
- [x] Unit/validator/service: 135 passed; global branch 77.3%, `web-map.service` branch 80%.
- [x] Integration PostgreSQL/PostGIS + Supertest: 23 passed; anonymous + 5 role DB matrix.
- [x] Postman cập nhật, parse hợp lệ; OpenAPI lịch sử retired tại Sprint 6a.
- [x] Lint, npm production audit (`0 vulnerabilities`), runtime import, `git diff --check` xanh.
- [x] Không áp migration production `campha` trong development; production vẫn pending `007/008/009`.
- [ ] Live MinIO terrain/DEM + WebGIS/QGIS visual 3D UAT — deferred vì chưa có DEM thật.

## Trạng thái

Sprint 4 **Done kỹ thuật có điều kiện**. Còn gate ngoài code: backup/migrate production `007–009`, cấu hình provider có khóa nếu sử dụng, DEM thật, MinIO live và visual 3D UAT.
