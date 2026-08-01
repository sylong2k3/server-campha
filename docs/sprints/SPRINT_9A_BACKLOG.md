# Sprint 9a — Mobile GIS backend

## Phạm vi

- MVT PostGIS bằng `ST_AsMVT`/`ST_AsMVTGeom`, chỉ từ layer registry và ACL.
- Đọc thuộc tính và nearby GPS theo layer ACL.
- Đo LineString/Polygon bằng EPSG:5899.
- Lưu Point/LineString/Polygon vào `gis.mobile_drafts`; không sửa dữ liệu gốc.
- Draft chỉ owner đọc/xóa; optimistic locking bằng `updated_at`.
- Weather current qua `openweather.client.js`; không lộ API key.
- Flutter/UI, routing, sửa dữ liệu gốc và offline sync thuộc Sprint 9b hoặc client.

## API

```text
GET    /api/v1/mobile/layers/:layerId/tiles/:z/:x/:y.mvt
GET    /api/v1/mobile/layers/:layerId/features/:featureId
GET    /api/v1/mobile/layers/:layerId/nearby
POST   /api/v1/mobile/measure
POST   /api/v1/mobile/drafts
GET    /api/v1/mobile/drafts
GET    /api/v1/mobile/drafts/:id
DELETE /api/v1/mobile/drafts/:id
GET    /api/v1/mobile/weather/current
```

## Giới hạn an toàn

- Tọa độ: longitude 107–108, latitude 20.7–21.3.
- Zoom 0–22; tile tối đa 5.000 features.
- Nearby 10–2.000 m; tối đa 100 features.
- Geometry tối đa 500 điểm/ring, 10 rings.
- MVT anonymous chỉ layer public; authenticated vẫn qua role ACL.
- Weather thiếu key/upstream lỗi trả 503 operational.

## Nghiệm thu

- Postman folder `Sprint 9a - Mobile GIS`.
- QGIS mở URL MVT khi có layer thật và `mobileLayerId` phù hợp.
- Test DB bắt buộc `campha_test`.