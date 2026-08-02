# Sprint 13 — Registry API lớp PostGIS

## Phạm vi

- Registry quản trị lớp PostGIS đã publish.
- Share JWT tách user-session JWT, scope theo CRUD, expiry, revoke/rotate tức thời.
- Hạn mức fixed-window atomic bằng PostgreSQL; không Redis.
- GET detail/list, search, pagination, limit, sort; POST/PUT/DELETE có allowlist.
- PUT/DELETE dùng `baseVersion`, stale trả 409; không last-write-wins.
- Call log, key event, create/delete mutation audit bất biến; update nối `gis.feature_versions.api_key_id`.
- Write scope chỉ `so_tnmt` có `api_registry:grant` phê duyệt.

## Contract

Postman duy nhất: `docs/api/campha.postman_collection.json`, folder `Sprint 13 - Registry API lop`.

## Security acceptance

- Không lưu plaintext JWT; chỉ trả lúc issue/rotate.
- Mỗi request lookup key/registry/layer trong DB.
- Dynamic identifier chỉ lấy từ registry + `gis.layers.metadata`, qua strict quoting.
- `POST` yêu cầu `featureId`; ID đã xóa không tái dùng.
- Geometry WGS84 giới hạn khu vực Cẩm Phả, PostGIS validate rồi transform.
- Không triển khai OpenAPI, Redis, KTTV, GEE.

## UAT

1. Chọn lớp PostGIS thật; cấu hình `idField`, `displayFields`, `searchFields`, `editableFields`.
2. Chạy folder Postman bằng tài khoản TNMT.
3. Xác minh rotate/revoke khiến token cũ trả 401 ngay.
4. Xác minh quota trả 429 kèm `RateLimit-*`.
5. Đối chiếu feature và lịch sử bằng QGIS.