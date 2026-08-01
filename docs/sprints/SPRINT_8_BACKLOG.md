# Sprint 8 — Phản ánh cộng đồng và realtime (không GEE)

## Phạm vi
- US-8.1: gửi phản ánh, mô tả, tọa độ, tối đa 5 ảnh riêng tư.
- US-8.2: Point/LineString/Polygon đo đạc tương đối.
- US-8.3: PostgreSQL LISTEN/NOTIFY nối WebSocket `ws` hiện có.
- US-8.4: timeline thay đổi đã duyệt quanh vị trí, bán kính 10–500 m.
- US-8.5: `ST_ClusterDBSCAN`, đếm distinct sender, cửa sổ tối đa 366 ngày.
- US-8.6: duyệt bởi `ubnd_tp`, `so_tnmt`, `so_xd`; loại `system_admin`.
- US-8.7: FCM best-effort báo trạng thái cho người gửi.
- Xóa theo yêu cầu chủ thể dữ liệu: soft-delete report, xóa object ảnh best-effort.

## API Postman
- `GET /api/v1/field-reports/public`
- `GET /api/v1/field-reports/nearby`
- `GET /api/v1/field-reports/mine`
- `POST /api/v1/field-reports`
- `GET /api/v1/field-reports/:id`
- `DELETE /api/v1/field-reports/:id`
- `GET /api/v1/admin/field-reports`
- `GET /api/v1/admin/field-reports/clusters`
- `PATCH /api/v1/admin/field-reports/:id/review`
- `PUT|DELETE /api/v1/devices/push-token`

## Bảo mật và riêng tư
- Public chỉ thấy report `approved|resolved`; không sender ID/tên/email, ảnh URL, object key.
- Ảnh giữ private; URL 5 phút chỉ owner/reviewer. Presign/commit chỉ PNG/WebP signature.
- PNG/WebP vẫn có thể chứa metadata; không phát hành ảnh public cho tới khi có pipeline re-encode/strip metadata.
- FCM token AES-256-GCM với `DEVICE_TOKEN_ENCRYPTION_KEY`; hash SHA-256 unique.
- NOTIFY payload chỉ `reportId`, `event`, `status`.
- WebSocket chỉ subscribe self role channel hoặc `public:field-reports`.
- Tất cả spatial distance/cluster transform EPSG:5899.

## Không thuộc Sprint 8
- Google Earth Engine và hydraulic spike `SPIKE-8.8`.
- Redis, Docker, Socket.io, public photo publication.
- PDF/DOCX/XML/ODT thống kê Sprint 7.

## Cấu hình bổ sung
```env
DEVICE_TOKEN_ENCRYPTION_KEY=<64 hex characters>
```
Chỉ bắt buộc khi `PUSH_ENABLED=true`.