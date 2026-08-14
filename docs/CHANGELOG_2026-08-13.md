# Thay đổi vận hành 2026-08-13

## Domain

- Khôi phục và duy trì Forest Classification trong API, worker, service/repository và giao diện; module dùng hạ tầng raster chung nhưng có domain `forest.*` riêng.
- Giữ migration lịch sử; không rollback schema/data đã áp.
- Giữ Flood/Hydrology M1–M5.

## Storage và CMS

- Khôi phục `storage.controller.deleteObject`; route `DELETE /api/v1/storage/objects/:id` khởi động và enqueue durable cleanup.
- CMS Document/PDF repository trả nội bộ `file_object_id`, nên download dùng backend ticket thay vì direct MinIO URL.
- Chuẩn hóa `API_BASE_URL` dạng origin hoặc có `/api/v1`.
- Stream không-ticket dùng owner-scoped lookup; ticket bind đúng file ID.
- MinIO proxy dùng bucket env động, SigV4 signed-only, HTTP/HTTPS theo config, timeout và client-abort.
- PDF thật `saungap2024.pdf`, file ID `56`, PDF map ID `17` được dùng cho live read-only test.

## Raster, GDAL và mobile

- GeoTIFF mobile render qua GeoServer WMS + Mapbox raster source/layer; không dùng MVT cho raster.
- WMS ngoài extent trả PNG trong suốt thay vì tile error làm Mapbox treo.
- GDAL/OGR VPS Windows dùng OSGeo4W; Excel import smoke test đạt.
- Durable MinIO cleanup worker smoke test đạt.

## Dữ liệu tiếng Việt

- Chuẩn hóa tên `gis.layers` lớp phủ trước/sau ngập năm 2015–2024 thành Unicode tiếng Việt đúng.
- Ví dụ ID `3`: `Lớp phủ trước ngập Cẩm Phả năm 2015`.

## Postman

- Sửa presign Storage thành `201`, contract `data.id` + `data.uploadUrl`.
- Thêm CMS Document/PDF ticket extraction và stream verification.
- Thêm đủ 14 Flood request.
- Active collection khớp `152/152` route `/api/v1`; không có Forest request.
- 20 KTTV request không được mount chuyển sang `Legacy - KTTV (không được mount)`.

## Tài liệu liên quan

- [Vận hành Storage, MinIO và Raster](STORAGE_AND_RASTER_OPERATIONS.md)
- [Mobile Server Handoff](MOBILE_SERVER_HANDOFF.md)
- [Threat Model](THREAT_MODEL.md)
- [VPS Installation Checklist](VPS_INSTALLATION_CHECKLIST.md)
- [Postman collection](api/campha.postman_collection.json)
