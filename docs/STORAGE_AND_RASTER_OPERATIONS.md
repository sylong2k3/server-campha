# Vận hành Storage, MinIO và Raster

Cập nhật: **2026-08-13**.

## 1. Kiến trúc file

```text
Client
  ├─ upload trực tiếp API hoặc presigned PUT
  ▼
MinIO quarantine → kiểm tra size/magic bytes → ClamAV → SHA-256 → bucket chính
  ├─ documents / field photos: backend download ticket
  ├─ artifact không có file ID: MinIO SigV4 proxy
  └─ GeoTIFF: raster ingest → GeoServer → WMS cho Web/Mobile
```

Bucket bắt buộc: `MINIO_BUCKET_LAYERS`, `MINIO_BUCKET_RASTER`, `MINIO_BUCKET_DOCUMENTS`, `MINIO_BUCKET_FIELD_PHOTOS`, `MINIO_BUCKET_QUARANTINE`.

Bucket Flood tùy chọn: `MINIO_BUCKET_FLOOD_RASTERS`, `MINIO_BUCKET_FLOOD_CALIBRATION`.

Forest Classification đã bị loại khỏi runtime Cẩm Phả. Không tạo bucket, cron, route hoặc worker Forest mới.

## 2. Upload

### Upload trực tiếp

```http
POST /api/v1/storage/uploads
Authorization: Bearer <token>
Content-Type: application/pdf
X-File-Category: documents
X-File-Name: report.pdf
```

Response thành công: `201`; file đã ở trạng thái `ready/clean`.

### Presigned upload

```http
POST /api/v1/storage/uploads/presign
```

Contract:

```json
{
  "success": true,
  "data": {
    "id": 56,
    "uploadUrl": "https://...",
    "expiresAt": "2026-08-13T05:00:00.000Z"
  }
}
```

Sau PUT vào `uploadUrl`, gọi `POST /api/v1/storage/uploads/56/commit`. Không dùng `objectId`; khóa đúng là `id`.

## 3. Download ticket

Tệp có record `core.file_objects` phải dùng backend ticket:

```http
GET /api/v1/storage/objects/56/download-url?expireSeconds=300
```

CMS Document/PDF Map cũng trả cùng dạng URL:

```text
{API_BASE_URL}/api/v1/storage/objects/56/file?ticket=<JWT-ngắn-hạn>
```

`API_BASE_URL` có thể là origin (`https://apicampha.tourismpj.pro.vn`) hoặc đã có `/api/v1`; service chuẩn hóa để không thiếu/double prefix.

Quyền:

- Có ticket hợp lệ: chỉ stream file ID đã bind trong ticket.
- Không ticket: phải có Bearer token và file phải thuộc owner hiện tại.
- File không `ready`, ticket sai/hết hạn/sai ID: từ chối.

## 4. MinIO SigV4 proxy

Presigned upload và artifact chưa có `file_object_id` có thể đi qua origin API. Middleware chỉ proxy khi:

- Bucket nằm trong env đang cấu hình.
- Method là `GET`, `HEAD` hoặc `PUT`.
- Query có `X-Amz-Signature`.

`Host` upstream phải là `MINIO_ENDPOINT:MINIO_PORT` vì SigV4 ký header này. Middleware dùng `MINIO_USE_SSL`, timeout mặc định 120 giây (`MINIO_PROXY_TIMEOUT_MS`) và hủy upstream khi client ngắt. Không log query đầy đủ vì chứa chữ ký.

## 5. Xóa file bền vững

`DELETE /api/v1/storage/objects/:id` không xóa MinIO đồng bộ. Repository:

1. Kiểm tra owner và active references.
2. Trả `409 FILE_STILL_IN_USE` nếu còn tham chiếu.
3. Enqueue cleanup transactionally.
4. Worker xóa object MinIO, rồi hoàn tất lifecycle.

CMS/field report hỗ trợ `deleteFiles=true`; cùng guard active references.

## 6. GeoTIFF, GDAL và GeoServer

VPS Windows hiện dùng:

```env
GDAL_OGR2OGR_PATH=C:/OSGeo4W/bin/ogr2ogr.exe
GDAL_OGRINFO_PATH=C:/OSGeo4W/bin/ogrinfo.exe
PROJ_DATA_PATH=C:/OSGeo4W/share/proj
GDAL_DATA_PATH=C:/OSGeo4W/share/gdal
```

Luồng raster:

```text
GeoTIFF → MinIO raster/flood bucket → validate CRS/COG/checksum
→ filesystem mirror GeoServer → coverage store → gis.layers
```

Web/Mobile Mapbox phải dùng GeoServer WMS (qua proxy `/api/v1/maps/layers/:id/wms`) cho GeoTIFF:

```text
service=WMS
request=GetMap
crs=EPSG:3857
bbox={bbox-epsg-3857}
format=image/png
transparent=true
```

Tham số đúng là `crs` (WMS 1.3.0), không phải `srs` (WMS 1.1.1) — validator Joi strip field lạ nên gửi nhầm `srs=` sẽ âm thầm fallback `EPSG:4326` mà không báo lỗi. Không dùng MVT cho GeoTIFF. WMS trả PNG trong/ngoài extent, tránh tile 400 làm Mapbox treo.

**Auth cho tile URL template (thêm 2026-08-13):** `Mapbox RasterSource` tự gọi URL template, không gắn được header `Authorization`. Layer không `is_public` phải lấy vé trước: `GET /maps/layers/:id/tile-ticket?access=view` (Bearer bình thường) → `{ ticket, expiresAt }`, sau đó nhúng `&ticket=<value>` vào URL WMS/WFS thay header. Vé hết hạn ~15 phút (`MAP_TILE_TICKET_TTL`), bind cứng `layerId` + `access` (`view` cho WMS, `export` cho WFS). Layer `is_public=true` không cần vé.

## 7. Smoke test PDF

Dữ liệu xác minh ngày 2026-08-13:

- `cms.pdf_maps.id=17`
- `core.file_objects.id=56`
- `saungap2024.pdf`
- `application/pdf`
- `2.362.302` byte
- magic `%PDF-`

Kiểm tra:

```powershell
pnpm run lint
pnpm run format:check
pnpm test -- --runInBand
```

Qua API:

1. Login và lấy Bearer token.
2. Gọi `GET /api/v1/cms/pdf-maps/17/download-url?expireSeconds=300`.
3. URL phải chứa `/api/v1/storage/objects/56/file?ticket=`.
4. GET URL: `200`, `Content-Type: application/pdf`, body bắt đầu `%PDF-`.
5. Sửa một ký tự ticket: phải `403`.
6. Production chỉ PASS sau deploy/restart; local PASS không thay production PASS.

Collection kiểm thử: [campha.postman_collection.json](api/campha.postman_collection.json).
