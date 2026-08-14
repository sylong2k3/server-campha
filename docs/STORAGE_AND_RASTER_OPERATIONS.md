# Vận hành Storage, MinIO và Raster

Cập nhật: **2026-08-14**.

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

Bucket Flood tùy chọn: `MINIO_BUCKET_FLOOD_RASTERS` (sản phẩm publish), `MINIO_BUCKET_FLOOD_CALIBRATION` (archive-only, không auto-publish theo §19).

Forest Classification đang là module runtime của Cẩm Phả. Module dùng route `/api/v1/forest-classification`, worker ingest raster và các bảng `forest.*`; không gỡ route, worker hoặc UI Forest khi vận hành kho raster chung.

Flood/Hydrology là module runtime song song với Forest, dùng route `/api/v1/flood` + `/api/v1/admin/flood`, các bảng `gis.flood_analysis_runs`, `gis.flood_artifacts`, `gis.flood_run_stage_events`, `gis.flood_run_audit` (migration 080 + 082). Không gỡ khi vận hành kho raster chung.

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

CMS Document/PDF Map và ảnh phản ánh đã duyệt dùng URL API ổn định:

```text
{API_BASE_URL}/api/v1/storage/objects/56/file
```

File `internal`, ảnh phản ánh chưa duyệt và owner preview dùng URL ticket ngắn hạn:

```text
{API_BASE_URL}/api/v1/storage/objects/56/file?ticket=<JWT-ngắn-hạn>
```

`API_BASE_URL` có thể là origin (`https://apicampha.tourismpj.pro.vn`) hoặc đã có `/api/v1`; service chuẩn hóa để không thiếu/double prefix. Không lưu URL ticket vào DB; chỉ lưu bucket, object key và `file_object_id`.

Quyền:

- Không ticket, không đăng nhập: chỉ stream file được CMS `public` hoặc phản ánh `approved`/`resolved` tham chiếu.
- Có ticket hợp lệ: chỉ stream file ID đã bind trong ticket.
- Không ticket, có đăng nhập: file phải thuộc owner hiện tại.
- File không `ready/clean`, ticket sai/hết hạn/sai ID: từ chối.

## 4. MinIO SigV4 proxy

Presigned upload và artifact chưa có `file_object_id` có thể đi qua origin API. Middleware chỉ proxy khi:

- Bucket nằm trong env đang cấu hình.
- Method là `GET`, `HEAD` hoặc `PUT`.
- Query có `X-Amz-Signature`.

`Host` upstream phải là `MINIO_ENDPOINT:MINIO_PORT` vì SigV4 ký header này. Middleware dùng `MINIO_USE_SSL`, timeout mặc định 120 giây (`MINIO_PROXY_TIMEOUT_MS`) và hủy upstream khi client ngắt. Không log query đầy đủ vì chứa chữ ký.

Khi API và MinIO cùng VPS, cấu hình `MINIO_ENDPOINT=127.0.0.1` (hoặc tên service trong private Docker network), bind MinIO API vào interface nội bộ và chặn cổng `9000/9001` từ Internet. `MINIO_PUBLIC_URL` chỉ là origin proxy cho presigned request; không lưu giá trị này hay presigned URL vào DB.

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

## 6.1. Chain raster Flood (GEE getDownloadURL → MinIO → GeoServer)

Flood M1..M5 dùng cùng pipeline với Forest Classification — không còn Google Cloud Storage trung gian. Chain thực thi trong [run-executor.service.js](../src/services/flood/run-executor.service.js) hàm `exportAndHarvest`:

```text
GEE compute (M1..M5 pipeline)
  → ee.Image.getDownloadURL({format:GEO_TIFF, scale, region, filePerBand:false})
  → signed GEE URL (~1h TTL, gắn với session GEE hiện tại)
  → rasterIngest.enqueue({ sourceKind:'gee_download_url', bucketCategory })
  → raster-ingest pipeline: download → SHA-256 → CRS check (EPSG:32648) → MinIO
  → GeoServer coverage store + layer (workspace GEOSERVER_WORKSPACE)
  → waitForIngestJob poll cho tới completed / dlq
```

Bucket đích chọn theo mode qua [configs/flood.js](../src/configs/flood.js) `bucketCategoryForMode`:

- `mode='product'` → `flood-rasters` (publish, WMS công khai theo `is_public`).
- `mode='calibration'` → `flood-calibration` (archive-only, không đăng ký GeoServer để phòng lộ số liệu chưa hiệu chỉnh).

Env bắt buộc khi bật flood pipeline:

- `GEE_KEY_PATH` hoặc `GOOGLE_APPLICATION_CREDENTIALS`: service key auth cho GEE (chỉ GEE, không cần Cloud Storage role).
- `MINIO_BUCKET_FLOOD_RASTERS`, `MINIO_BUCKET_FLOOD_CALIBRATION`: bucket đích. Nếu không cấu hình mà mode yêu cầu, ingest lỗi ngay lập tức với message "Storage category not configured" (fail-fast, không silent fallback).
- `RASTER_INGEST_ENABLED=true`: nếu tắt, URL GEE sinh xong sẽ nằm chờ → hết hạn ~1h → 401. LUÔN bật ở prod.

Env tuning tùy chọn:

- `FLOOD_INGEST_WAIT_TIMEOUT_MS` (mặc định 25 phút): thời gian tối đa `run-executor` chờ raster-ingest xử lý xong 1 artifact.
- `FLOOD_INGEST_POLL_INTERVAL_MS` (mặc định 2000): nhịp poll status ingest job.

Ràng buộc size: `getDownloadURL` giới hạn ~262MB tổng / 32MB/band (do GEE). Cẩm Phả × 30m × single-band binary/byte/float chưa vướng giới hạn này với mọi artifact hiện có (M1-M5). Nếu một module tương lai emit output lớn hơn, xử lý case-by-case (đổi scale coarser hoặc chuyển riêng artifact đó sang Export.image.toDrive), KHÔNG re-introduce GCS bucket cho toàn pipeline.

Env cũ đã BỎ (không còn đọc): `FLOOD_GCS_BUCKET`, `FLOOD_GCS_SIGNED_URL_SECONDS`. Cột `gcs_bucket`/`gcs_object` trong `gis.flood_artifacts` giữ ở schema nhưng không được ghi.

M5 trend cron ([jobs/flood-trend.job.js](../src/jobs/flood-trend.job.js)) mặc định TẮT (`FLOOD_TREND_ENABLED=false`). Bật khi ops muốn tự động tạo frequency map cho năm dương lịch vừa kết thúc. Cron mặc định `0 2 1 1,4,7,10 *` chạy 02:00 mùng 1 Jan/Apr/Jul/Oct; deduplicate qua `analysisKey` (SHA-256 config) trong bảng `gis.flood_analysis_runs` nên có chạy lại cùng năm cũng không tạo run trùng.

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
