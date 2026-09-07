# FE Admin: quản lý và publish GeoTIFF Time Series

Cập nhật: 2026-09-07. Contract sau bản sửa Đợt 1; **chưa xác nhận deploy hoặc DB production**.

## 1. Sửa đúng lỗi 409 khi thêm ảnh

`POST /api/v1/admin/remote-sensing/images/53/publish` tạo **lớp riêng**.
Cùng `coverageKey` không biến request đó thành thao tác thêm mốc Time Series.

| Ý định                | Request                                                              | Quy tắc `code`                           |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| Upload vào kho        | Upload, commit, tạo ảnh                                              | Chưa có mã lớp                           |
| Publish một ảnh riêng | `POST /api/v1/admin/remote-sensing/images/:id/publish`               | Mã riêng, ví dụ `test_2018`              |
| Tạo chuỗi lần đầu     | `POST /api/v1/admin/remote-sensing/collections/:coverageKey/publish` | Mã collection chưa dùng, ví dụ `test_ts` |
| Thêm mốc vào chuỗi    | Tạo ảnh cùng coverage, publish lại collection                        | Giữ **đúng mã collection hiện có**       |
| Tạo lại sau khi xóa   | Chờ cleanup hoàn tất, publish collection                             | Mã mới, ví dụ `test_ts_v2`               |

Không bắt buộc publish từng ảnh trước khi tạo chuỗi. Một ảnh được phép có cả lớp riêng
và lớp Time Series; hai lớp phải có ID, mã và store độc lập.

Với tình huống ảnh 53:

1. Đọc coverage thật từ `GET /api/v1/remote-sensing/images/53`.
2. Tra collection theo mục 6; không mặc định `test` là mã collection.
3. Có collection active thì giữ mã đó; chưa có thì chọn mã mới chưa dùng.
4. Gọi endpoint collection với coverage thật, không gọi publish ảnh để thêm mốc.
5. Đọc lại catalog Time Series sau khi thành công.

Lỗi ban đầu chưa được truy tới constraint/bản ghi DB thật. Không kết luận trạng thái
các lớp `test`, `test123`, `test12`, `test1` từ riêng response 409.

## 2. ID, khóa nhóm và response

| Giá trị                        | Nguồn / công dụng                                              |
| ------------------------------ | -------------------------------------------------------------- |
| `fileObjectId`                 | `data.id` của upload/commit; dùng tạo ảnh                      |
| Image ID                       | `data.id` của tạo ảnh; dùng detail, publish riêng, xóa ảnh     |
| `coverageKey` / `coverage_key` | Form / response ảnh; gom toàn bộ ảnh hợp lệ cùng nhóm          |
| `sceneCode` / `scene_code`     | Mã ảnh; unique trong ảnh active, không phân biệt hoa thường    |
| `acquiredAt` / `acquired_at`   | Thời điểm thu nhận, không phải thời điểm upload                |
| `code`                         | Mã lớp unique toàn DB, kể cả lớp đã soft-delete                |
| `layer_id` trên ảnh            | ID collection Time Series                                      |
| `standalone_layer_id` trên ảnh | ID lớp riêng của ảnh                                           |
| `layer.id`                     | Response publish; ID dùng trong API lớp và WMS                 |
| `geoserverLayer`               | Backend tự trả; không dùng thay ID hoặc gửi trong body publish |

ID là số nguyên dương; response có thể là chuỗi số (`"53"`) hoặc số (`53`), không phải UUID.
Chuẩn hóa ID thành chuỗi khi so sánh/làm key. Chuyển thành Number để gửi body phải kiểm tra
`Number.isSafeInteger`; không ép ID vượt giới hạn số an toàn.

- Thành công: `{ "message": "...", "status": 200, "data": ... }`.
- Tạo upload/ảnh: HTTP 201, `status: 201`.
- Không có `success: true`; dùng HTTP status.
- Lỗi: `{ "success": false, "message": "...", "errors": ["CODE"] }`.
- Kiểm tra `errors.includes(code)`, không giả định array chỉ có một phần tử.
- Request camelCase; ảnh/lớp Admin snake_case; catalog map camelCase.

Danh sách ảnh/lớp Admin phân trang:

```json
{
    "message": "Danh sách",
    "status": 200,
    "data": { "items": [] },
    "metadata": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Catalog Time Series trả **mảng tại `data`**, không phải `data.items`.
Đọc ảnh có hai ID liên kết nhưng không trả `file_object_id` hoặc object key.
Giữ file ID từ upload nếu UI cần.

## 3. Quyền và xác thực

Gửi `Authorization: Bearer <access-token>` tới API cần đăng nhập.
Tài khoản bị yêu cầu đổi mật khẩu phải hoàn thành bước đó trước khi dùng Admin.

| Thao tác                          | Điều kiện chính                                         |
| --------------------------------- | ------------------------------------------------------- |
| Upload raster, tạo ảnh            | `raster.create`                                         |
| Danh sách ảnh Admin               | `raster.read`                                           |
| Publish riêng / collection        | **Cả** `raster.create` và `layers.create`               |
| Tra lớp Admin                     | `layers.read`                                           |
| Xóa lớp / xóa ảnh / phân loại ảnh | `layers.delete` / `raster.delete` / `raster.categorize` |
| Catalog map khi đăng nhập         | `map.view`, cộng ACL layer                              |
| Tile private                      | Quyền xem layer; Bearer hoặc ticket đúng layer/access   |

`isPublic` mặc định **false**. Collection private cấp `can_view` cho role người publish,
không cấp cho mọi role. Standalone vẫn theo ACL layer hiện hành.
Không tự chuyển public để né 403.

> [!WARNING]
> Không gửi access token tới URL upload đã ký. URL ký/tile ticket là thông tin nhạy cảm:
> không log, không lưu localStorage, không đưa vào telemetry hoặc chia sẻ công khai.

## 4. Upload và tạo bản ghi ảnh

### 4.1 Xin URL upload

```http
POST /api/v1/storage/uploads/presign
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
    "category": "raster",
    "originalName": "Lop_phu_Cam_Pha_sau_ngap_2018_RGB.tif",
    "contentType": "image/tiff",
    "expireSeconds": 900
}
```

HTTP 201: `data.id`, `data.uploadUrl`, `data.expiresAt`.
ExpireSeconds 60–3600, mặc định 900.

### 4.2 PUT file nguyên bản

Gọi PUT tới nguyên uploadUrl, body là file nhị phân. Không JSON/base64/FormData,
không sửa query ký, không dùng interceptor Bearer của API. Kiểm tra HTTP thành công.
URL khác origin cần CORS upload ở hạ tầng.

### 4.3 Commit

```http
POST /api/v1/storage/uploads/321/commit
Authorization: Bearer <access-token>
```

Không cần body. `321` minh họa, dùng ID presign thật. Commit kiểm tra file,
quét mã độc, chuyển sang ready. HTTP 200 trả bản ghi file; phần trích `data`:

```json
{
    "id": "321",
    "lifecycle_status": "ready",
    "scan_status": "clean",
    "detected_mime": "image/tiff"
}
```

Chỉ tạo ảnh sau commit thành công. Commit không idempotent: gọi lại có thể 409
`UPLOAD_NOT_PENDING_OR_EXPIRED`. Timeout không chứng minh thất bại; không lặp vô hạn
hoặc tự xóa file. Luồng này chưa có endpoint polling upload-status.

### 4.4 Tạo ảnh

```http
POST /api/v1/admin/remote-sensing/images
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
    "sceneCode": "CP-SAU-NGAP-2018-RGB",
    "title": "Lớp phủ Cẩm Phả sau ngập 2018",
    "platform": "sentinel-2",
    "thematicGroup": "lop-phu",
    "coverageKey": "cam-pha-sau-ngap",
    "acquiredAt": "2018-01-01T00:00:00.000Z",
    "resolutionM": 10,
    "fileObjectId": 321
}
```

Platform, độ phân giải, ngày chỉ minh họa; dùng metadata thật.
HTTP 201 trả ảnh tại data; lưu image ID, không tự publish riêng sau bước này.

| Field                               | Ràng buộc                                              |
| ----------------------------------- | ------------------------------------------------------ |
| `sceneCode` / `title`               | Bắt buộc, tối đa 150 / 300 ký tự                       |
| `platform`                          | Bắt buộc; sentinel-1, sentinel-2, landsat-7, landsat-8 |
| `coverageKey`                       | Bắt buộc; `^[a-z0-9][a-z0-9_-]{1,119}$`, dài 2–120     |
| `acquiredAt`                        | Bắt buộc ISO date; nên gửi UTC đủ mili giây            |
| `fileObjectId`                      | Bắt buộc, số nguyên dương                              |
| `thematicGroup` / `productLevel`    | Tối đa 80 / 50; có thể bỏ, null hoặc rỗng              |
| `resolutionM`                       | Số dương, tối đa 999999                                |
| `cloudCoverPercent` / `orbitNumber` | 0–100 / số nguyên dương                                |
| `description`                       | Tối đa 5000; có thể bỏ, null hoặc rỗng                 |

File phải thuộc người tạo ảnh, category raster, ready, clean, MIME image/tiff,
đuôi .tif/.tiff. Một file chỉ liên kết một bản ghi ảnh. Không gửi owner ID,
object key, bucket hoặc upload URL trong body tạo ảnh.

Cùng coverage không được trùng thời điểm lúc publish. Tạo ảnh có thể nhận mốc trùng
nhưng publish collection sẽ chặn. `2018-01-01T07:00:00+07:00` và
`2018-01-01T00:00:00.000Z` là cùng mốc. Không lấy giờ upload làm acquiredAt;
ngày suy từ tên file phải được người dùng xác nhận.

Đổi nhóm chuỗi thời gian: `PATCH /api/v1/admin/remote-sensing/images/:id/coverage-key` với `{ "coverageKey": "..." }`.
Đổi chủ đề hiển thị: `PATCH /api/v1/admin/remote-sensing/images/:id/category` với `thematicGroup` và `expectedUpdatedAt`.
Gộp nhóm ảnh: `POST /api/v1/admin/remote-sensing/collections/merge`.
Không tự xóa ảnh đang phục vụ bản đồ để sửa metadata sai.

## 5. Publish collection hoặc standalone

### 5.1 Body chung

```json
{
    "code": "cam_pha_sau_ngap_ts",
    "nameVi": "Lớp phủ Cẩm Phả sau ngập theo thời gian",
    "category": "lop-phu",
    "srid": 32648,
    "minZoom": 0,
    "maxZoom": 22,
    "legendConfig": {},
    "metadata": { "source": "admin_geotiff_upload" },
    "isPublic": true
}
```

Ví dụ giả định EPSG:32648. **Không mặc định 4326/32648 cho mọi file**.
SRID phản ánh CRS thật, không phải yêu cầu chuyển CRS.

| Field                       | Ràng buộc                                                      |
| --------------------------- | -------------------------------------------------------------- |
| `code`                      | Bắt buộc; `^[a-z][a-z0-9_]{0,62}$`, dài 1–63; không gạch ngang |
| `nameVi` / `category`       | Bắt buộc; 1–200 / 1–50                                         |
| `srid`                      | Bắt buộc, số nguyên 1–999999                                   |
| `minZoom`, `maxZoom`        | Số nguyên 0–24, có thể null/bỏ; min không lớn hơn max          |
| `legendConfig` / `metadata` | Object tối đa 30 / 50 key, mặc định {}                         |
| `isPublic`                  | Boolean, mặc định false                                        |

Không gửi imageIds/fileObjectIds/coverageKey/timeSeries ở top level.
Coverage lấy từ URL; backend chọn toàn bộ thành viên hợp lệ. Field lạ trả HTTP 400.

Key metadata nội bộ bị bỏ qua rồi backend tự quản lý: `timeSeries`, `geoserverStore`,
`geoserverStoreKind`, `geoserverLayer`, `geoserverPublishCategory`, `rasterIngestJobId`.
Không copy nguyên metadata Admin vào form; chỉ gửi metadata nghiệp vụ.

### 5.2 Tạo/cập nhật collection

```http
POST /api/v1/admin/remote-sensing/collections/cam-pha-sau-ngap/publish
Authorization: Bearer <access-token>
Content-Type: application/json
```

Dùng body trên. HTTP 200, ví dụ rút gọn field lớp:

```json
{
    "message": "Xuất bản bộ GeoTIFF Time Series thành công",
    "status": 200,
    "data": {
        "coverageKey": "cam-pha-sau-ngap",
        "layer": {
            "id": "220",
            "code": "cam_pha_sau_ngap_ts",
            "name_vi": "Lớp phủ Cẩm Phả sau ngập theo thời gian",
            "publish_status": "published",
            "metadata": {
                "geoserverStore": "cam_pha_sau_ngap_ts",
                "geoserverStoreKind": "imagemosaic_upload",
                "timeSeries": {
                    "enabled": true,
                    "mode": "discrete",
                    "coverageKey": "cam-pha-sau-ngap",
                    "storeUploaded": true
                }
            }
        },
        "geoserverLayer": "campha:cam_pha_sau_ngap_ts",
        "memberCount": 2,
        "imageIds": ["52", "53"],
        "fileObjectIds": ["320", "321"],
        "timeSeries": {
            "enabled": true,
            "mode": "discrete",
            "defaultTime": "2018-01-01T00:00:00.000Z",
            "values": ["2015-01-01T00:00:00.000Z", "2018-01-01T00:00:00.000Z"]
        }
    }
}
```

ID/store chỉ minh họa. `data.layer` là lớp Admin, không phải catalog map.
Response publish có imageIds/fileObjectIds, không có timeSeries.members.

Backend khóa ảnh, kiểm tra mốc, chuẩn bị lớp, dựng ZIP toàn bộ ảnh hợp lệ,
upload mosaic, bật/kiểm tra TIME rồi đặt published. Request **đồng bộ**,
không trả job ID/progress. FE khóa submit trong lúc chờ; không hiển thị phần trăm giả.

Publish lại đúng coverage/mã dựng lại toàn bộ mosaic, không append riêng ảnh mới.
Values tăng dần theo acquired_at/id; default là mốc cuối, không theo upload.
Lỗi sau chuẩn bị có thể để lớp failed, ảnh vẫn có layer_id. Không bảo đảm rollback
GeoServer hoặc giữ mosaic cũ không gián đoạn. Sau timeout tra Admin trước retry;
hủy fetch không hủy xử lý server. Không publish đồng thời cùng nhóm.

### 5.3 Publish standalone

```http
POST /api/v1/admin/remote-sensing/images/53/publish
```

Body chung nhưng mã riêng, ví dụ `cam_pha_sau_ngap_2018`.
HTTP 200: data gồm imageId, layer, geoserverLayer. Collection không đổi; WMS không gửi time.

- Standalone active đã liên kết: publish lại giữ đúng mã; không đổi tên mã/store bằng publish.
- Chặn mã collection, vector, ingest hoặc standalone của ảnh active khác.
- Vẫn hỗ trợ thay nguồn standalone tương thích không còn ảnh active khác giữ liên kết,
  có bằng chứng nguồn ảnh trong DB. Không phải cơ chế FE nhận lớp bất kỳ khi trùng mã;
  mặc định yêu cầu mã mới khi tạo lớp riêng mới.

## 6. Tra collection, kho ảnh nguồn và trạng thái Admin

### 6.1 Tra danh sách nhóm chuỗi thời gian (Collections)

```http
GET /api/v1/admin/remote-sensing/collections?page=1&limit=20&sort=latestAcquiredAt:desc
Authorization: Bearer <access-token>
```

- Query: `q` (tìm theo `coverageKey` hoặc `thematicGroup`), `page`, `limit` (1–100, mặc định 20), `sort` (`latestAcquiredAt:desc`, `latestAcquiredAt:asc`, `totalImages:desc`, `totalImages:asc`).
- Trả về danh sách nhóm với tổng hợp cấp cơ sở dữ liệu:
  - `coverageKey`: Khóa nhóm chuỗi.
  - `thematicGroup`: Nhóm chủ đề.
  - `totalImages`: Tổng số lượng ảnh thuộc nhóm.
  - `uniqueDates`: Số mốc thời gian phân biệt.
  - `earliestAcquiredAt` / `latestAcquiredAt`: Mốc thu nhận đầu tiên và gần nhất.
  - `hasDuplicateDates`: `true` nếu có từ 2 ảnh cùng mốc thu nhận.
  - `duplicateDateCount`: Số lượng ảnh bị thừa do trùng mốc.
  - `isPublishable`: `true` nếu nhóm có từ 2 ảnh trở lên và không có mốc trùng lặp.
  - `collectionLayer`: Thông tin lớp chuỗi thời gian đang liên kết (`id`, `code`, `nameVi`, `publishStatus`, `cleanupStatus`, `deletedAt`).

### 6.2 Tra danh sách ảnh nguồn (Admin Remote Sensing Images)

```http
GET /api/v1/admin/remote-sensing/images?page=1&limit=20&coverageKey=cam-pha-sau-ngap&status=all
Authorization: Bearer <access-token>
```

- Query: `q` (tìm title/scene_code), `coverageKey`, `platform`, `thematicGroup`, `status`, `from`, `to`, `page`, `limit`, `sort`.
- Filter `status` bao gồm:
  - `all`: Toàn bộ ảnh nguồn còn hiệu lực.
  - `in_use`: Ảnh đang được sử dụng bởi ít nhất một lớp (độc lập hoặc chuỗi).
  - `unpublished`: Ảnh lưu kho chưa có lớp sử dụng hoặc lớp đã bị xóa.
  - `standalone`: Ảnh đang thuộc lớp bản đồ độc lập đang hoạt động.
  - `time_series`: Ảnh đang thuộc lớp chuỗi thời gian đang hoạt động.
  - `cleanup_pending`: Ảnh có lớp liên quan đang trong hàng đợi dọn dẹp GeoServer.
  - `cleanup_failed`: Ảnh có lớp liên quan gặp lỗi trong quá trình dọn dẹp GeoServer.
- Trả kèm trường lifecycle: `standaloneLayer` và `timeSeriesLayer` (gồm `id`, `code`, `deletedAt`, `cleanupStatus`).

### 6.3 Đổi nhóm chuỗi thời gian và gộp nhóm ảnh

1. **Đổi khóa nhóm của một ảnh**:
   ```http
   PATCH /api/v1/admin/remote-sensing/images/:id/coverage-key
   Authorization: Bearer <access-token>
   Content-Type: application/json

   { "coverageKey": "cam-pha-do-thi-2024" }
   ```
   - Chặn nếu ảnh đang là thành viên của một lớp chuỗi thời gian đang hoạt động (`409 TIME_SERIES_MEMBER`).
   - Tự động gỡ liên kết lớp chuỗi cũ nếu lớp đó đã bị xóa và hoàn tất dọn dẹp. Lớp độc lập (`standalone_layer_id`) vẫn được giữ nguyên.

2. **Gộp nhiều nhóm chuỗi vào nhóm đích**:
   ```http
   POST /api/v1/admin/remote-sensing/collections/merge
   Authorization: Bearer <access-token>
   Content-Type: application/json

   {
     "sourceCoverageKeys": ["nhom_cu_1", "nhom_cu_2"],
     "targetCoverageKey": "nhom_dich"
   }
   ```
   - Khóa giao dịch phân tán bằng advisory lock PostgreSQL (`pg_advisory_xact_lock(hashtext(k))`).
   - Chặn nếu phát hiện trùng mốc thời gian (`409 DUPLICATE_COLLECTION_TIME`) hoặc ảnh nguồn đang thuộc lớp chuỗi thời gian active (`409 COLLECTION_MEMBER_CONFLICT`).

### 6.4 Theo dõi tiến trình dọn dẹp và thử lại (Cleanup)

- Tra trạng thái job dọn dẹp: `GET /api/v1/map-layers/:id/cleanup`
- Thử lại dọn dẹp nếu thất bại: `POST /api/v1/map-layers/:id/cleanup/retry`

### 6.5 Quản lý kho ảnh nguồn sau khi xóa lớp bản đồ

- Khi quản trị viên xóa lớp bản đồ GeoTIFF (độc lập hoặc chuỗi), hệ thống chỉ đánh dấu xóa lớp (`deleted_at = NOW()`) và đẩy yêu cầu dọn dẹp GeoServer vào hàng đợi nền.
- Tệp ảnh GeoTIFF và bản ghi ảnh gốc **không bị xóa** mà được bảo toàn trong **Kho ảnh nguồn GeoTIFF** (`/map-layers/source-images`).
- Tại Kho ảnh nguồn, quản trị viên có thể:
  1. Công bố lại thành một lớp bản đồ độc lập mới với mã lớp mới.
  2. Đổi nhóm chuỗi thời gian để đưa ảnh vào một chuỗi thời gian khác.
  3. Theo dõi trạng thái giải phóng tài nguyên GeoServer của các lớp cũ đã xóa.
  4. Xóa vĩnh viễn bản ghi ảnh và yêu cầu dọn dẹp tệp vật lý trên lưu trữ MinIO (`deleteFiles=true`).

| Trạng thái              | UI                                                                |
| ----------------------- | ----------------------------------------------------------------- |
| Chưa có ảnh             | Upload, tạo ảnh                                                   |
| Có ảnh, chưa collection | Tạo chuỗi; cho sửa mã đề xuất                                     |
| Published               | Thêm mốc/cập nhật; giữ mã                                         |
| Request đang chạy       | Khóa submit, giữ form, hiển thị đang xử lý                        |
| Pending/failed sau lỗi  | Tra trạng thái, retry đúng endpoint/mã sau khi request cũ đã dừng |
| Cleanup pending         | Chờ/làm mới, theo dõi chi tiết qua dialog cleanup                 |
| Cleanup thất bại        | Bấm nút "Thử lại dọn dẹp" tại Kho ảnh nguồn                       |

Tách nút Publish lớp riêng/Publish chuỗi. Hiện cả hai ID. Hậu tố _ts chỉ gợi ý,
không bảo đảm unique. Category/thematicGroup không quyết định membership.

## 7. Catalog, slider và WMS

```http
GET /api/v1/web-map/time-series-layers
```

Đọc array data. Lớp camelCase có id, code, nameVi, isPublic, srid, storageKind;
khi có mốc hợp lệ có object timeSeries:

```json
{
    "enabled": true,
    "mode": "discrete",
    "defaultTime": "2018-01-01T00:00:00.000Z",
    "values": ["2015-01-01T00:00:00.000Z", "2018-01-01T00:00:00.000Z"],
    "members": [
        {
            "imageId": "52",
            "sceneCode": "CP-SAU-NGAP-2015",
            "acquiredAt": "2015-01-01T00:00:00.000Z",
            "fileObjectId": "320"
        },
        {
            "imageId": "53",
            "sceneCode": "CP-SAU-NGAP-2018-RGB",
            "acquiredAt": "2018-01-01T00:00:00.000Z",
            "fileObjectId": "321"
        }
    ]
}
```

Catalog không serialize timeSeries.coverageKey; tra nhóm bằng metadata Admin/image ID.
Slider chỉ hiện nếu enabled true và values không rỗng, không chỉ dựa storageKind.
Dùng index values, không tự sinh năm giữa min/max. Default lấy defaultTime nếu thuộc values,
fallback phần tử cuối. Nhãn định dạng UTC; query giữ nguyên ISO đủ mili giây.
Không dùng geoserverLayer/image ID/file ID thay layer ID.
`GET /api/v1/web-map/layers` loại Time Series, dùng cho lớp riêng/bản đồ thường.

```http
GET /api/v1/maps/layers/220/wms?request=GetMap&version=1.3.0&crs=EPSG%3A3857&bbox=11970000,2320000,12010000,2360000&width=512&height=512&format=image%2Fpng&transparent=true&time=2018-01-01T00%3A00%3A00.000Z
```

Bbox minh họa; dùng bbox tile thật minX,minY,maxX,maxY. Không thêm layers/service/srs.
EPSG:4326 với WMS 1.3.0 có trục lat/lon; Mapbox nên dùng EPSG:3857.
Time đúng YYYY-MM-DDTHH:mm:ss.SSSZ và thuộc values.

### Mapbox raster source

apiBase là base backend tin cậy kết thúc /api/v1; selectedTime từ catalog.
Ticket chỉ cần cho private nếu tile không gửi Bearer. Chạy sau map style load.

```javascript
const params = new URLSearchParams({
    request: 'GetMap',
    version: '1.3.0',
    crs: 'EPSG:3857',
    width: '512',
    height: '512',
    format: 'image/png',
    transparent: 'true',
    time: selectedTime,
});
if (ticket) params.set('ticket', ticket);
const tileUrl = `${apiBase}/maps/layers/${encodeURIComponent(layer.id)}/wms?${params}&bbox={bbox-epsg-3857}`;
const sourceId = `time-series-${layer.id}`;
const mapLayerId = `time-series-raster-${layer.id}`;
if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'raster', tiles: [tileUrl], tileSize: 512 });
    map.addLayer({ id: mapLayerId, type: 'raster', source: sourceId });
} else {
    map.getSource(sourceId).setTiles([tileUrl]);
}
```

Giữ `{bbox-epsg-3857}` nguyên văn; không đưa placeholder vào URLSearchParams vì bị encode.
Width/height/tileSize cùng 512. Đổi slider cập nhật tiles, không tạo source mỗi mốc.
Style reload cần khôi phục source/layer. Debounce kéo nhanh, loại response ticket cũ.
Loading ứng với lựa chọn hiện tại. Slider có label/thao tác bàn phím; lỗi không chỉ dùng màu.

### Tile private

```http
GET /api/v1/maps/layers/220/tile-ticket?access=view
Authorization: Bearer <access-token>
```

HTTP 200: data.ticket, data.expiresAt. Thêm ticket vào WMS. Đúng layer/access,
không dùng ticket export cho view. TTL mặc định 15 phút, có thể cấu hình.
Cache RAM theo user/layer/access, refresh trước expiry, clear khi logout/đổi tài khoản.
Public không cần ticket. WMS Cache-Control private,max-age=60; TIME phải có trong cache key.
PNG 200 trong suốt không chứng minh render đúng; kiểm tra bbox/NoData/CRS/ACL/GeoServer.

## 8. Ma trận lỗi FE

| HTTP / mã                                                  | Xử lý                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 400 validation                                             | Sửa field lạ/regex/ISO/zoom; không retry payload sai              |
| 401/403                                                    | Đăng nhập/quyền/ACL; không đổi public                             |
| 404 ảnh                                                    | Không có ảnh active/ready tương ứng                               |
| 409 SATELLITE_CONFLICT                                     | Trùng scene/file đã có ảnh; tra lại                               |
| 422 INVALID_RASTER_FILE                                    | Kiểm tra owner/category/ready/scan/MIME/extension                 |
| 409 RASTER_LAYER_CONFLICT                                  | Nhóm lỗi publish riêng; xem mã chi tiết                           |
| 409 RASTER_LAYER_TARGET_CONFLICT                           | Sai loại/nguồn/mã standalone liên kết hoặc ảnh khác giữ lớp       |
| 409 COLLECTION_LAYER_CONFLICT                              | Đích collection thuộc tài nguyên khác/mã trùng                    |
| 409 COLLECTION_MEMBER_CONFLICT                             | Thành viên thuộc collection active khác; tra đúng mã, không tự gỡ |
| 409 LAYER_CODE_RETIRED                                     | Mã đã soft-delete vẫn bị giữ; mã mới sau cleanup                  |
| 409 LAYER_CLEANUP_PENDING                                  | Chờ cleanup, không đổi mã để vượt chặn                            |
| 409 LAYER_CLEANUP_REQUIRED                                 | Cleanup lỗi/thiếu bằng chứng; vận hành kiểm tra                   |
| 409 EMPTY_COLLECTION                                       | Không có thành viên hợp lệ trong coverage                         |
| 409 DUPLICATE_COLLECTION_TIME                              | Trùng thời điểm tuyệt đối; sửa dữ liệu có kiểm soát               |
| 409 COLLECTION_STATE_CONFLICT                              | Trạng thái đổi giữa publish; đọc lại Admin                        |
| 422 INCOMPATIBLE_RASTERS                                   | Chuẩn hóa CRS/band count/type/NoData/color interpretation         |
| 422 COLLECTION_ENTRY_LIMIT                                 | Quá ZIP entries, gồm hai cấu hình                                 |
| 422 COLLECTION_ENTRY_TOO_LARGE / COLLECTION_EXPANDED_LIMIT | File/tổng ảnh quá giới hạn                                        |
| 422 INVALID_FILE_SIZE / FILE_SIZE_MISMATCH                 | Size không hợp lệ/không khớp DB                                   |
| 422 TIME_REQUIRED                                          | Collection thiếu time                                             |
| 422 TIME_NOT_FOUND                                         | ISO ngoài values; tải lại catalog                                 |
| 422 TIME_NOT_SUPPORTED                                     | Bỏ time khi dùng standalone                                       |
| 409 TIME_SERIES_MEMBER / LAYER_PUBLISHED                   | Xóa ảnh bị chặn bởi lớp đang dùng                                 |
| 409 FILE_STILL_IN_USE                                      | File còn được dùng; giữ file                                      |
| 409 OPTIMISTIC_LOCK_CONFLICT                               | UpdatedAt cũ; tải lại và xác nhận lại                             |
| 5xx/mất mạng                                               | Giữ form, kiểm tra trạng thái trước retry                         |

```json
{
    "success": false,
    "message": "Lớp cũ đang được dọn; hãy chờ cleanup hoàn tất",
    "errors": ["RASTER_LAYER_CONFLICT", "LAYER_CLEANUP_PENDING"]
}
```

Ưu tiên mã chi tiết, fallback generic. Không nhận raw SQL/constraint trong response.
Giới hạn mặc định (có thể đổi cấu hình): upload 2048 MiB/file (STORAGE_MAX_RASTER_MB),
mosaic 64 ZIP entries gồm 2 cấu hình nên tối đa 62 ảnh (LAYER_ZIP_MAX_ENTRIES),
512 MiB/file (LAYER_ZIP_MAX_ENTRY_MB), tổng 1024 MiB gồm cấu hình (LAYER_ZIP_MAX_EXPANDED_MB).
Upload thành công không bảo đảm publish mosaic được.

## 9. Xóa, cleanup và tạo lại

> [!WARNING]
> Xóa collection là xóa cả lớp, không phải một mốc slider. Chỉ thử xóa trên dữ liệu
> thử được phép. Không xóa file nguồn để sửa lỗi 409.

Xóa lớp dùng JSON body, khác xóa ảnh dùng query:

```http
DELETE /api/v1/admin/layers/220
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{ "expectedUpdatedAt": "2026-09-07T00:00:00.000Z", "deleteFiles": false }
```

Timestamp lấy từ updated_at thật, không dùng giờ máy. Lớp rời catalog sau soft-delete;
cleanup GeoServer chạy nền. Giữ layer ID để vận hành đối chiếu.

| Thao tác                        | Liên kết/nguồn                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Xóa standalone, giữ file        | Gỡ standalone đúng lớp sau thành công; collection khác giữ nguyên                              |
| Xóa collection                  | Cleanup mosaic; gỡ collection ID khớp sau thành công; standalone khác giữ nguyên               |
| Cleanup queued/running/failed   | Không gỡ trước, giữ bằng chứng quyền sở hữu store                                              |
| Cleanup complete                | Tạo lại bằng mã mới; không tái dùng lớp/mã cũ                                                  |
| Liên kết cũ kẹt dù complete     | Publish xác minh lớp complete/job succeeded, thay quan hệ ảnh đang xử lý                       |
| deleteFiles=true khi xóa lớp    | Có thể 409 nếu ảnh dùng nguồn; collection không có source file đơn nên không xóa hàng loạt ảnh |
| Xóa ảnh trong collection active | 409 TIME_SERIES_MEMBER                                                                         |
| Xóa ảnh có standalone published | 409 LAYER_PUBLISHED                                                                            |

Xem/retry cleanup lớp đã xóa (Đợt 2):

```http
GET /api/v1/admin/layers/220/cleanup
Authorization: Bearer <access-token>
```

Yêu cầu quyền `layers.read`. 404 nếu lớp không tồn tại. Response:

```json
{
  "layerId": 220,
  "code": "test",
  "deletedAt": "2026-09-06T10:00:00.000Z",
  "cleanupStatus": "failed",
  "updatedAt": "2026-09-06T10:05:00.000Z",
  "canRetry": true,
  "job": {
    "id": 41,
    "status": "failed",
    "attempt": 5,
    "maxAttempts": 5,
    "nextAttemptAt": null,
    "startedAt": "2026-09-06T10:04:00.000Z",
    "finishedAt": "2026-09-06T10:04:30.000Z",
    "createdAt": "2026-09-06T10:00:01.000Z",
    "updatedAt": "2026-09-06T10:04:30.000Z"
  }
}
```

`job` chỉ có khi từng tạo cleanup job. `nextAttemptAt` chỉ hiển thị khi job đang
`queued`. `canRetry` chỉ true khi actor có quyền `layers.delete`, lớp đã xóa,
`cleanupStatus !== 'complete'` và job cuối `failed`.

```http
POST /api/v1/admin/layers/220/cleanup/retry
Authorization: Bearer <access-token>
Content-Type: application/json
```

Body rỗng (`{}`), bất kỳ field lạ đều bị 400. Yêu cầu quyền `layers.delete`.
404 nếu lớp không tồn tại. Thành công trả về `cleanupView` như trên với job mới
`queued`, có audit log `layer_cleanup_retried`. 409 với các mã:

| errors                        | Ý nghĩa                                              |
| ------------------------------ | ----------------------------------------------------- |
| `LAYER_NOT_DELETED`            | Lớp chưa bị soft-delete, không cần retry cleanup      |
| `LAYER_CLEANUP_ALREADY_ACTIVE` | Đã có job `queued`/`running`, đợi job hiện tại xong   |
| `LAYER_CLEANUP_NOT_RETRYABLE`  | Đã `complete` hoặc job cuối chưa `failed`, không retry |

Không coi 404 detail là complete. Tải lại ảnh; LAYER_CLEANUP_REQUIRED hoặc trạng thái
chưa rõ cần đưa ID cho vận hành kiểm tra job qua endpoint trên.

`POST /api/v1/admin/layers/:layerId/publish` chỉ retry vector PostGIS; raster trả
422 NOT_VECTOR_LAYER. Retry Time Series qua endpoint collection, standalone qua ảnh.
Retry cleanup là việc khác.

Xóa ảnh chỉ khi nghiệp vụ/lớp liên quan đã được xử lý:

```http
DELETE /api/v1/admin/remote-sensing/images/53?expectedUpdatedAt=2026-09-07T00%3A00%3A00.000Z&deleteFiles=false
```

Timestamp từ ảnh thật. Giữ file mặc định; không tự bật deleteFiles=true.

## 10. Checklist FE/staging

1. Upload hai GeoTIFF tương thích, tạo ảnh cùng coverage/khác mốc.
2. Tạo chuỗi trực tiếp không publish riêng; nhận một layer/hai values.
3. Upload mốc cũ hơn sau cùng; default vẫn acquiredAt mới nhất.
4. Publish riêng thành viên bằng mã khác; hai catalog tách đúng.
5. Dùng mã collection publish riêng: 409, DB/GeoServer collection không đổi.
6. Trùng acquiredAt dưới hai timezone bị chặn; FE không tự đổi ngày.
7. Đổi từng mốc: ISO đúng, tile trong phạm vi render đúng.
8. Private: thiếu quyền bị chặn; refresh ticket hết hạn, không lộ token.
9. Xóa standalone giữ file; collection còn render; publish riêng lại bằng mã mới sau cleanup.
10. Xóa collection: chặn khi cleanup; tạo lại mã mới khi xong, standalone còn render.
11. Cleanup lỗi ở staging: không tự gỡ quan hệ/nút retry API chưa có.
12. Refresh lúc pending/failed: tìm lại qua Admin, giữ đúng mã.
13. Kiểm tra phân trang, empty/error states, bàn phím slider và loading khi kéo nhanh.

Test mocked không thay thế xác minh SQL race, thứ tự DB, MinIO, GeoServer và render thật.

## Source đối chiếu

- [remote-sensing.routes.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/routes/remote-sensing.routes.js)
- [remote-sensing.validator.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/validators/remote-sensing.validator.js)
- [remote-sensing.repository.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/repositories/remote-sensing.repository.js)
- [remote-sensing.service.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/services/remote-sensing.service.js)
- [storage.service.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/services/storage.service.js)
- [web-map.service.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/services/web-map.service.js)
- [map-proxy.validator.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/validators/map-proxy.validator.js)
- [layer-job.repository.js](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/src/repositories/layer-job.repository.js)
- [GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/docs/GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md)
