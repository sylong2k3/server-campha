# Sprint 3 — Quản trị lớp dữ liệu

## Sprint Goal

Nhập Shapefile ZIP/Excel vào PostGIS, quản trị metadata/ACL/xóa nền, tìm kiếm phân trang; PostgreSQL durable queue, không Redis/Docker.

## Commitment

| Story | Phạm vi | SP | Trạng thái |
|---|---|---:|---|
| US-3.1 | Shapefile ZIP → PostGIS, CRS/encoding/topology/error dòng | 13 | Done kỹ thuật + GDAL/PostGIS fixture |
| US-3.2 | Excel tọa độ → POINT layer | 8 | Done kỹ thuật + GDAL/PostGIS fixture |
| US-3.3 | Layer update + optimistic lock | 5 | Done code/integration |
| US-3.4 | Soft-delete + cleanup GeoServer/PostGIS/MinIO nền | 8 | Done code/integration; live service UAT chờ VPS |
| US-3.5 | ACL lớp theo role; chỉ TNMT update/delete/grant | 5 | Done code/integration |
| US-3.6 | Search/pagination/page-size | 3 | Done code/integration |
| US-3.7 | Nạp 7 lớp nền Cẩm Phả thật | 8 | Deferred — chưa nhận dữ liệu nguồn |
| US-3.8 | Velocity/Planning Poker/roadmap recalibration | 3 | Deferred — cần Owner A + Owner B đồng thuận |

## Delivered

- Migration `007`: import jobs, row errors, cleanup jobs, lease/retry/index/constraints.
- Queue PostgreSQL `FOR UPDATE SKIP LOCKED`; child worker singleton; graceful bounded shutdown; concurrency mặc định 1.
- ZIP preflight: signature, EOCD/central/local headers, traversal, symlink, encryption, nested archive, ZIP64, collisions, bomb limits, đúng một bộ `.shp/.dbf/.shx/.prj`.
- Shapefile: CRS EPSG bắt buộc; `.cpg` hoặc encoding allowlist; GDAL argument array; password chỉ qua environment.
- Excel: sheet/cột X/Y/SRID bắt buộc; kiểm tra số hữu hạn/range; tạo `geometry(Point, SRID)`.
- Basic topology: null/empty/invalid/mixed/exact duplicate. Administrative profile: polygon, overlap, gap.
- Atomic staging → final table + `gis.layers` + default ACL; publish GeoServer có trạng thái retry.
- Soft-delete transactionally enqueues idempotent GeoServer/PostGIS/MinIO cleanup.
- Layer API: import async/status/error pagination, list/filter/sort/page-size, detail, patch optimistic lock, ACL replace, publish retry, delete.
- Role contract giữ migration `002`: `system_admin`/`so_xd` create/read; chỉ `so_tnmt` update/delete/grant.
- Strict body/query validation; generated SQL identifiers allowlisted; per-row errors giới hạn/paginated.

## Acceptance Evidence

```text
ESLint:                    passed
Unit:                      137/137 passed; 6 GDAL-local tests skipped in generic run
Focused Sprint 3 unit:     16/16 passed with QGIS GDAL environment
DB integration:            12/12 passed on campha_test
Migration 000-007:         checksum OK on campha_test
GDAL PostgreSQL driver:    1 feature / EPSG:4326 / ST_Point passed
Shapefile importer:        2 features / EPSG:4326 / MULTIPOINT passed
Excel importer:            2 rows / EPSG:4326 / POINT passed
Topology gap fixture:      POLYGON_GAP rejected
ZIP local-header mismatch: rejected
```

## Deferred / Not Done

- US-3.7: chưa có 7 lớp nền địa lý Cẩm Phả và ranh giới phường/xã có mã hành chính; không thể nghiệm thu dữ liệu thật.
- US-3.8: không tự bịa SP/deadline đồng thuận. Owner A và Owner B cần Planning Poker sau khi xem kết quả Sprint 3.
- Production DB `campha` chưa áp migration `007`; chỉ `campha_test` đã migrate.
- Worker live với MinIO + GeoServer trên VPS chưa bật; `.env` mặc định `LAYER_WORKER_ENABLED=false`.
- QGIS visual UAT chờ layer nghiệp vụ thật.

## Exit Gate

Sprint 3 **Done kỹ thuật có điều kiện**. Đóng hoàn toàn khi: áp migration `007` production sau backup, bật worker native VPS, UAT end-to-end MinIO → GDAL → PostGIS → GeoServer → QGIS, nạp dữ liệu thật US-3.7, hoàn tất Planning Poker US-3.8.
