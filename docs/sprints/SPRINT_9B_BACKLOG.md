# Sprint 9b — pgRouting, chỉnh sửa dữ liệu gốc và offline sync

## Phạm vi

- Graph định tuyến riêng: không thêm `source`/`target` vào bảng layer import.
- Topology evidence bằng PostGIS + `pgr_connectedComponents`; không dùng runtime contract `pgr_analyzeGraph` đã deprecated.
- Shortest path bằng `pgr_dijkstra`, khoảng cách EPSG:5899.
- Chỉ `so_tnmt` có `map_feature.update` và ACL layer `can_edit=true` được sửa dữ liệu gốc.
- Thuộc tính chỉ từ `layer.metadata.editableFields`.
- Before/after attributes + geometry lưu bất biến, cùng transaction với nguồn.
- Restore luôn tạo version mới.
- Offline sync tối đa 50 thay đổi; UUID idempotency theo user/client; stale `baseVersion` trả server snapshot, không last-write-wins.

## API

```text
POST  /api/v1/mobile/routes/shortest
POST  /api/v1/mobile/admin/routing-networks/:layerId/rebuild
GET   /api/v1/mobile/admin/routing-networks/:layerId/topology
PATCH /api/v1/mobile/layers/:layerId/features/:featureId
GET   /api/v1/mobile/layers/:layerId/features/:featureId/history
POST  /api/v1/mobile/layers/:layerId/features/:featureId/restore/:version
POST  /api/v1/mobile/sync
```

## Giới hạn an toàn

- Tọa độ Cẩm Phả: longitude 107–108, latitude 20.7–21.3.
- Snap route 10–500 m; route tối đa 100 km.
- Snap topology 0,01–20 m; rebuild timeout 30 giây.
- Geometry tối đa 500 điểm/ring, 10 rings; phải đúng geometry type layer.
- Attributes scalar, tối đa 30 trường; tên field phải là SQL identifier an toàn.
- Route anonymous chỉ layer public; user đăng nhập cần `map.route`.

## Nghiệm thu

- Migration `025_mobile_gis_routing_sync.sql` chỉ chạy trước trên `campha_test`.
- Fixture đường liên thông: 1 component, 0 isolated, 0 un-noded crossing, route không rỗng.
- Citizen/system admin sửa source trả 403; TNMT update/restore tạo lịch sử.
- Duplicate `clientChangeId` replay kết quả; stale version không ghi đè.
- UAT mạng đường thật/QGIS chờ import data giao thông thực tế.