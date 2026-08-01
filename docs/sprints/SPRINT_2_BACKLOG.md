# Sprint 2 — Hạ tầng dữ liệu không gian

## Sprint Goal

Thiết lập storage quarantine, GeoServer lifecycle, VN-2000 EPSG:5899 và WMS/WFS proxy có ACL; không Docker, Redis.

## Commitment

| Story | Phạm vi | SP | Trạng thái |
|---|---|---:|---|
| US-2.1 | MinIO multi-bucket, streaming/presigned, quarantine | 8 | Done kỹ thuật + live MinIO |
| US-2.2 | Extension + magic bytes + ClamAV fail-closed | 8 | Done code/test; live `clamd` UAT deferred |
| US-2.3 | GeoServer REST workspace/datastore/layer/style lifecycle | 8 | Done code/test + live read health |
| US-2.4 | VN-2000 `EPSG:5899` + transform utility | 5 | Done DB integration |
| US-2.5 | `gis.layers` ACL hardening | 5 | Done |
| US-2.6 | WMS `GetMap`/WFS `GetFeature` proxy có ACL | 8 | Done code/test |
| US-2.7 | COG/GeoTIFF MinIO → GeoServer spike | 3 | Spike kết luận filesystem fallback |

## Delivered

- 5 bucket private: `campha-layers`, `campha-raster`, `campha-documents`, `campha-field-photos`, `campha-quarantine`.
- Presigned PUT chỉ vào quarantine; owner/category/RBAC cố định từ server.
- Commit kiểm tra size, extension, magic bytes, ClamAV INSTREAM, SHA-256; scanner lỗi trả 503, không promote.
- Migration `006` tạo `core.file_objects`; PostGIS phải cung cấp EPSG:5899 chuẩn.
- GeoServer URL chỉ từ server config; secret file; identifier validation; redirect denial; sanitized errors.
- WMS chỉ `GetMap`; WFS chỉ `GetFeature`; layer name ép từ `gis.layers.geoserver_layer`.
- OpenAPI và `.env.example` đồng bộ.

## Acceptance Evidence

```text
ESLint:                 passed
Unit:                   127/127 passed
Coverage branches:      76.02% >= 75%
DB integration:         8/8 passed on campha_test
Migration 006:          checksum OK
EPSG round-trip:        4326 -> 5899 -> 4326 passed
MinIO live:             5/5 buckets healthy; anonymous 403
MinIO service:          upload/stat/range-read/delete passed
GeoServer live:         workspace/datastore/WMS/WFS 200
OpenAPI YAML:           valid
High/Critical audit:    0
```

## Deferred / Not Done

- `CLAMAV_ENABLED=false`: chưa có native `clamd`; malware live UAT chưa chạy. Commit API cố ý fail closed.
- GeoServer/MinIO network ports và WMS/WFS direct access: người vận hành chấp nhận tạm thời, sẽ đóng sau.
- COG S3 plugin không được phát hiện trên GeoServer 3.0.0; chưa đủ điều kiện chọn direct S3.
- QGIS visual UAT chưa chạy vì chưa có layer nghiệp vụ Sprint 3.
- Production DB `campha` chưa áp migration 006.

## COG Spike Decision

GeoServer live có ImageMosaic nhưng manifest không xác nhận S3 GeoTIFF plugin. Chọn **filesystem sync fallback** cho Sprint 3: object sạch nằm MinIO; worker đồng bộ GeoTIFF vào private `GEOSERVER_DATA_DIR`; publish bằng `publishFsGeoTiffLayer`. Chỉ chuyển sang direct S3 khi plugin tương thích GeoServer 3.0.0 được cài, test range-read COG đạt, rollback được diễn tập.

## Exit Gate

Sprint 2 **Done kỹ thuật có điều kiện**. Không gọi production-ready trước khi: cài/UAT ClamAV, đóng cổng trực tiếp, tắt WFS-T/direct WFS, migration production, QGIS UAT.