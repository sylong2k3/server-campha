# Tích hợp GeoTIFF Time Series cho Web và Mobile

Cập nhật: 2026-08-29 (bổ sung kiến trúc tách 34 layer riêng)

## 1. Mục tiêu

Hiển thị chuỗi GeoTIFF theo thời gian bằng một lớp GeoServer duy nhất:

```text
GeoTIFF theo năm
  → GeoServer ImageMosaic + dimension TIME
  → API WMS proxy có ACL/tile ticket
  → Web/Mobile Mapbox raster source
  → slider đổi thời gian
```

Client không gọi trực tiếp GeoServer hoặc MinIO. Client chỉ gọi API backend.
GeoServer chọn ảnh tương ứng qua tham số WMS `TIME`.

### 1.1 Hai contract song song

| Chức năng | Endpoint | Kết quả |
| --- | --- | --- |
| Catalog bản đồ mặc định | `GET /api/v1/web-map/layers` | 34 ảnh lớp phủ dưới dạng 34 layer riêng; không chứa 3 layer Time Series |
| Tính năng Time Series | `GET /api/v1/web-map/time-series-layers` | 3 ImageMosaic collection với `values`, `defaultTime` và `members` cho slider |

Layer riêng gọi WMS không gửi `time`. Layer Time Series luôn gửi đúng chuỗi ISO
trong `timeSeries.values`. Web React có thể dùng cả hai endpoint; Mobile mặc định
chỉ cần catalog layer riêng, trừ khi ứng dụng cũng triển khai slider.

Ví dụ dữ liệu lớp phủ đô thị:

```text
Lop_phu_do_thi_Cam_Pha_2001_RGB.tif → 2001-01-01T00:00:00.000Z
Lop_phu_do_thi_Cam_Pha_2002_RGB.tif → 2002-01-01T00:00:00.000Z
...
Lop_phu_do_thi_Cam_Pha_2024_RGB.tif → 2024-01-01T00:00:00.000Z
```

## 2. Trạng thái triển khai

> [!IMPORTANT]
> Backend và pipeline GeoServer đã chạy trên production. Ngày 2026-08-29 đã
> publish 3 ImageMosaic và smoke test toàn bộ 34 mốc thời gian qua WMS proxy.
> Cùng ngày, backend được sửa để tách catalog mặc định (34 layer riêng) khỏi
> Time Series (endpoint riêng). Phần còn lại thuộc FE React, Mobile Flutter,
> publish 34 layer riêng trên production và xác minh cấu hình GWC.

| Thành phần                      | Trạng thái hiện tại | Ghi chú                                      |
| -------------------------------- | ------------------- | -------------------------------------------- |
| WMS proxy theo `layerId`        | Đã xác minh         | 34/34 mốc trả `200 image/png`                |
| ACL `view`                      | Đã có               | Không đổi                                    |
| Tile ticket cho raster private  | Đã có               | Ba layer production hiện là public           |
| WMS 1.3.0                       | Đã xác minh         | EPSG:4326 đã smoke test                      |
| GeoServer ImageMosaic           | Đã xác minh         | 3 store/layer publish thành công             |
| GeoServer dimension `TIME`      | Đã xác minh         | Bật và verify trong luồng publish            |
| Query API `time`                | Đã xác minh         | ISO UTC mili giây                            |
| Forward `time` thành WMS `TIME` | Đã xác minh         | 34 ảnh có 34 SHA-256 khác nhau               |
| Danh sách mốc thời gian         | Đã xác minh         | Catalog Time Series trả 5 + 5 + 24 mốc tăng dần |
| Lỗi thiếu/sai `time`            | Đã xác minh         | `TIME_REQUIRED` / `TIME_NOT_FOUND`, HTTP 422 |
| Cột `standalone_layer_id`       | Migration 116 đã chạy | Additive, không đổi `layer_id` hiện có     |
| `GET /web-map/layers` loại Time Series | Đã sửa code local | Có hiệu lực sau deploy/restart backend mới |
| `GET /web-map/time-series-layers` | Đã sửa code local | Route/controller/service/repository mới; có hiệu lực sau deploy |
| Publish 34 layer riêng trên production | Chưa chạy    | Chỉ chạy sau khi backend mới đã deploy      |
| GWC cache theo thời gian        | Chưa xác nhận       | Cần xác minh `TIME` parameter filter         |
| FE React / Mobile Flutter       | Chưa tích hợp       | React cần endpoint riêng; Mobile có thể giữ catalog mặc định |

Ba layer Time Series production hiện tại (sẽ bị loại khỏi catalog mặc định sau khi backend mới deploy):

| ID | Code | GeoServer layer | Số mốc | Khoảng thời gian |
| ---: | --- | --- | ---: | --- |
| 172 | `lop_phu_truoc_ngap_ts` | `campha:lop_phu_truoc_ngap_ts` | 5 | 2015–2024 |
| 173 | `lop_phu_sau_ngap_ts` | `campha:lop_phu_sau_ngap_ts` | 5 | 2015–2024 |
| 174 | `lop_phu_do_thi_ts` | `campha:lop_phu_do_thi_ts` | 24 | 2001–2024 |

Code backend hiện liên quan:

- [map-proxy.routes.js](../src/routes/map-proxy.routes.js)
- [map-proxy.validator.js](../src/validators/map-proxy.validator.js)
- [map-proxy.service.js](../src/services/map-proxy.service.js)
- [layer-access.middleware.js](../src/middlewares/layer-access.middleware.js)
- [map-tile-ticket.util.js](../src/utils/map-tile-ticket.util.js)
- [web-map.routes.js](../src/routes/web-map.routes.js)
- [web-map.controller.js](../src/controllers/web-map.controller.js)
- [web-map.service.js](../src/services/web-map.service.js)
- [web-map.repository.js](../src/repositories/web-map.repository.js)
- [remote-sensing.repository.js](../src/repositories/remote-sensing.repository.js)
- [116_standalone_satellite_layer.sql](../src/database/migrations/116_standalone_satellite_layer.sql)

### 2.1 Vì sao tách catalog và Time Series

Trước đây, publish theo collection gán mọi ảnh cùng `coverage_key` vào **một**
`layer_id` Time Series duy nhất, nên `GET /web-map/layers` chỉ còn 3 layer thay
vì 34. Cách khắc phục không phải nhồi 34 ảnh vào field `members` của 3 layer,
mà tách hẳn hai đường publish:

```text
satellite_images.layer_id
    → layer ImageMosaic Time Series (172/173/174), publish qua
      POST /admin/remote-sensing/collections/:coverageKey/publish

satellite_images.standalone_layer_id
    → layer GeoTIFF riêng cho từng ảnh, publish qua
      POST /admin/remote-sensing/images/:id/publish
```

`GET /web-map/layers` chỉ trả layer có
`metadata.timeSeries.enabled <> true`, tức 34 layer riêng cộng các layer khác
không phải Time Series. `GET /web-map/time-series-layers` chỉ trả layer có
`metadata.timeSeries.enabled = true`, tức đúng 3 collection.

> [!WARNING]
> Không gọi `POST /admin/remote-sensing/images/:id/publish` cho ảnh đang thuộc
> collection Time Series trên code production cũ (trước migration 116/backend
> mới) — code cũ ghi đè `layer_id` và có thể phá ImageMosaic. Trên code mới,
> publish riêng chỉ ghi `standalone_layer_id`, không đụng `layer_id`.

### 2.2 Publish một layer ảnh riêng

```http
POST /api/v1/admin/remote-sensing/images/{imageId}/publish
Authorization: Bearer <access-token>
Content-Type: application/json
```

Ví dụ ảnh trước ngập năm 2015:

```json
{
    "code": "cp_truoc_ngap_2015",
    "nameVi": "Lớp phủ trước ngập Cẩm Phả năm 2015",
    "category": "lop-phu",
    "srid": 32648,
    "minZoom": 8,
    "maxZoom": 18,
    "isPublic": true
}
```

Quy ước code lấy từ `scene_code`, đổi về chữ thường và thay ký tự không hợp lệ
bằng `_`: `CP-DO-THI-2024` thành `cp_do_thi_2024`. Validator chỉ nhận pattern
`^[a-z][a-z0-9_]{0,62}$`, vì vậy không dùng dấu gạch ngang trong `code`.

Publish lại cùng ảnh dùng `standalone_layer_id` đã có và cùng code; không tạo thêm
layer Time Series. Script bulk phải chạy tuần tự, dừng ngay ở lỗi đầu tiên. Luôn
publish thử một ảnh, gọi WMS không có `time`, rồi mới chạy 33 ảnh còn lại.

### 2.3 Thứ tự rollout production

1. Chạy migration `116_standalone_satellite_layer.sql`.
2. Deploy backend mới và restart PM2.
3. Xác minh `GET /web-map/time-series-layers` trả 3 layer.
4. Xác minh `GET /web-map/layers` không còn IDs `172`, `173`, `174`.
5. Publish thử một ảnh qua API individual publish.
6. Gọi WMS của layer mới **không có** query `time`; yêu cầu `200 image/png`.
7. Publish tuần tự 33 ảnh còn lại.
8. Đếm 34 layer bằng metadata `satelliteImageId` hoặc code; không dùng tổng độ dài
   catalog vì response còn chứa các layer nghiệp vụ khác.
9. Smoke test ba ImageMosaic cũ với `time` để bảo đảm Time Series không bị đổi.

> [!IMPORTANT]
> Migration 116 đã chạy trên DB production. Backend mới và 34 lần individual
> publish vẫn phải hoàn tất theo đúng thứ tự trên. Không publish 34 ảnh khi PM2
> còn chạy code cũ.

## 3. Contract layer Time Series

### 3.1 Lấy catalog Time Series riêng

```http
GET /api/v1/web-map/time-series-layers
Authorization: Bearer <access-token>
```

Authorization là tuỳ chọn với layer public. Layer private chỉ xuất hiện khi role
có `can_view`. Endpoint này chỉ lấy layer có
`metadata.timeSeries.enabled === true`; không dùng `category`/`search` của
catalog mặc định.

`GET /api/v1/web-map/layers` không trả các layer này. Endpoint mặc định dành cho
34 layer riêng và các layer bản đồ thông thường khác.

Backend trả `timeSeries` khi layer ImageMosaic còn dữ liệu. Ví dụ production:

```json
{
    "id": "172",
    "code": "lop_phu_truoc_ngap_ts",
    "nameVi": "Lớp phủ trước ngập Cẩm Phả (2015-2024)",
    "geometryType": "RASTER",
    "storageKind": "geotiff_minio",
    "srid": 32648,
    "geoserverLayer": "campha:lop_phu_truoc_ngap_ts",
    "minZoom": 8,
    "maxZoom": 18,
    "isPublic": true,
    "timeSeries": {
        "enabled": true,
        "mode": "discrete",
        "defaultTime": "2024-01-01T00:00:00.000Z",
        "values": [
            "2015-01-01T00:00:00.000Z",
            "2018-01-01T00:00:00.000Z",
            "2020-01-01T00:00:00.000Z",
            "2022-01-01T00:00:00.000Z",
            "2024-01-01T00:00:00.000Z"
        ],
        "members": [
            {
                "imageId": "12",
                "sceneCode": "CP-TRUOC-NGAP-2015",
                "acquiredAt": "2015-01-01T00:00:00.000Z",
                "fileObjectId": "<uuid>"
            }
        ]
    }
}
```

Quy tắc client:

- Chỉ hiện slider khi `timeSeries.enabled === true`.
- Chỉ gửi giá trị nằm trong `timeSeries.values`.
- Không tự sinh năm dựa trên `min/max`; dữ liệu có thể thiếu mốc.
- Mặc định chọn `defaultTime`, fallback phần tử cuối `values`.
- ID thay đổi theo môi trường; không hardcode `layerId`.

> [!IMPORTANT]
> `timeSeries` là field **tuỳ chọn**. Backend chỉ phát field này khi layer vừa bật
> `metadata.timeSeries.enabled` vừa còn ít nhất một ảnh chưa bị xoá. Nếu field
> vắng mặt trong response endpoint Time Series, client phải ẩn slider và không
> gửi `time`. Layer có metadata Time Series vẫn không quay lại catalog mặc định.

> [!NOTE]
> `storageKind` do DB quyết định và có thể là `geotiff_minio`. Đừng phân nhánh
> theo `storageKind`; luôn dựa vào sự hiện diện của `timeSeries`.

`values` đã được backend sắp xếp tăng dần theo thời gian chụp. Client dùng trực
tiếp làm thứ tự slider, không cần sort lại.

### 3.2 Lấy tile ticket

Layer private cần ticket vì Mapbox raster source không gắn Bearer header vào
mỗi tile request:

```http
GET /api/v1/maps/layers/{layerId}/tile-ticket?access=view
Authorization: Bearer <access-token>
```

Response:

```json
{
    "message": "Đã cấp vé truy cập bản đồ",
    "status": 200,
    "data": {
        "ticket": "<short-lived-jwt>",
        "expiresAt": "2026-08-28T06:15:00.000Z"
    }
}
```

Ticket:

- Mặc định sống khoảng 15 phút theo `MAP_TILE_TICKET_TTL`.
- Khóa theo `layerId` và `access=view`.
- Không dùng ticket của layer này cho layer khác.
- Không dùng ticket `view` cho WFS/WCS `export`.
- Không ghi ticket vào log, analytics hoặc crash report.
- Cache trong RAM; refresh trước hạn khoảng 60 giây.
- Layer public không cần ticket.

### 3.3 WMS Time Series tile URL

Contract đang chạy:

```http
GET /api/v1/maps/layers/{layerId}/wms
    ?request=GetMap
    &version=1.3.0
    &bbox={bbox-epsg-3857}
    &width=512
    &height=512
    &crs=EPSG:3857
    &format=image/png
    &transparent=true
    &time=2002-01-01T00%3A00%3A00.000Z
    &ticket=<url-encoded-ticket>
```

Backend nhận query public `time`, validate ISO UTC rồi chuyển thành WMS
`TIME` khi gọi GeoServer:

```text
Client query:      time=2002-01-01T00:00:00.000Z
GeoServer request: TIME=2002-01-01T00:00:00.000Z
```

Thông số bắt buộc:

| Query             | Giá trị                                        |
| ----------------- | ---------------------------------------------- |
| `request`         | `GetMap`                                       |
| `version`         | `1.3.0`                                        |
| `bbox`            | literal `{bbox-epsg-3857}` trong tile template |
| `width`, `height` | `512` khuyến nghị                              |
| `crs`             | `EPSG:3857`                                    |
| `format`          | `image/png`                                    |
| `transparent`     | `true`                                         |
| `time`            | ISO-8601 UTC từ `timeSeries.values`            |
| `ticket`          | Bắt buộc với layer private                     |

Không gửi:

- `layers`: backend ép layer từ DB, client không được chọn tên GeoServer.
- `service`: backend tự đặt `WMS`.
- `srs`: proxy dùng WMS 1.3.0 và field đúng là `crs`.
- URL GeoServer hoặc MinIO trực tiếp.

## 4. Helper URL dùng chung

Dùng cùng quy tắc cho FE và Mobile:

```js
export function buildTimeSeriesTileUrl({ apiBase, layerId, time, ticket }) {
    const bboxToken = '{bbox-epsg-3857}';
    const query = [
        'request=GetMap',
        'version=1.3.0',
        `bbox=${bboxToken}`,
        'width=512',
        'height=512',
        'crs=EPSG%3A3857',
        'format=image%2Fpng',
        'transparent=true',
    ];
    // Bỏ hẳn query khi layer không phải Time Series. Gửi `time` cho layer thường
    // bị 422 TIME_NOT_SUPPORTED.
    if (time) {
        query.push(`time=${encodeURIComponent(time)}`);
    }
    if (ticket) {
        query.push(`ticket=${encodeURIComponent(ticket)}`);
    }
    return `${apiBase}/api/v1/maps/layers/${layerId}/wms?${query.join('&')}`;
}
```

Không đưa `bboxToken` qua `encodeURIComponent`. Mapbox phải nhìn thấy literal
`{bbox-epsg-3857}` để thay bbox từng tile.

## 5. Tích hợp FE Web (React + Mapbox GL JS)

### 5.0 Hook đọc catalog

Time Series UI phải gọi endpoint riêng, không đọc slider data từ catalog mặc định:

```js
const response = await fetch(`${apiBase}/api/v1/web-map/time-series-layers`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
});
const payload = await response.json();
const timeSeriesLayers = payload.data;
```

Không hardcode ba ID production. Dùng item user chọn từ `timeSeriesLayers`:

```jsx
export function useTimeSeriesLayer(layer) {
    // Chỉ field này quyết định layer có phải Time Series hay không.
    const ts = layer?.timeSeries;
    const values = ts?.enabled ? ts.values : null;

    const [selectedTime, setSelectedTime] = useState(
        () => ts?.defaultTime ?? values?.at(-1) ?? null,
    );

    // Layer có thể mất mốc thời gian sau khi admin xoá ảnh. Reset về mốc hợp lệ
    // để không gửi giá trị cũ và nhận 422 TIME_NOT_FOUND.
    useEffect(() => {
        if (values && !values.includes(selectedTime)) {
            setSelectedTime(ts.defaultTime ?? values.at(-1));
        }
    }, [values, selectedTime, ts]);

    return { isTimeSeries: Boolean(values), values, selectedTime, setSelectedTime };
}
```

### 5.1 Tạo raster source/layer

```js
const SOURCE_ID = 'urban-cover-timeseries-source';
const LAYER_ID = 'urban-cover-timeseries-layer';

export function mountTimeSeriesLayer(map, tileUrl, { minZoom = 8, maxZoom = 18 } = {}) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: [tileUrl],
            tileSize: 512,
            minzoom: minZoom,
            maxzoom: maxZoom,
        });
    }
    if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            paint: {
                'raster-opacity': 1,
                'raster-fade-duration': 150,
            },
        });
    }
}
```

### 5.2 Đổi năm

```js
export function setTimeSeriesTime(map, tileUrl) {
    const source = map.getSource(SOURCE_ID);
    if (!source) {
        throw new Error('Time Series raster source is not mounted');
    }
    source.setTiles([tileUrl]);
}
```

Flow slider:

```jsx
function TimeSlider({ layer, map, apiBase }) {
    const { isTimeSeries, values, selectedTime, setSelectedTime } = useTimeSeriesLayer(layer);
    const ticket = useTileTicket(layer);

    useEffect(() => {
        if (!map) return;
        const tileUrl = buildTimeSeriesTileUrl({
            apiBase,
            layerId: layer.id,
            // Layer thường phải gửi time=undefined; gửi time cho layer không phải
            // Time Series sẽ bị 422 TIME_NOT_SUPPORTED.
            time: isTimeSeries ? selectedTime : undefined,
            ticket,
        });
        map.getSource(SOURCE_ID)?.setTiles([tileUrl]);
    }, [map, apiBase, layer.id, isTimeSeries, selectedTime, ticket]);

    if (!isTimeSeries) return null;

    return (
        <input
            type="range"
            min={0}
            max={values.length - 1}
            step={1}
            value={values.indexOf(selectedTime)}
            onChange={(e) => setSelectedTime(values[Number(e.target.value)])}
            aria-label={`Mốc thời gian: ${new Date(selectedTime).getUTCFullYear()}`}
        />
    );
}
```

Helper phải bỏ hẳn query `time` khi giá trị là `undefined`:

```js
if (time) {
    query.push(`time=${encodeURIComponent(time)}`);
}
```

UI:

- Hiển thị nhãn năm từ `new Date(value).getUTCFullYear()`.
- Slider index chạy từ `0` tới `values.length - 1`.
- Giá trị thật luôn lấy `values[index]`.
- Debounce 100–200 ms nếu slider phát sự kiện liên tục.
- Khi người dùng kéo nhanh, chỉ áp dụng giá trị cuối.
- Giữ source/layer ID ổn định; không tạo source mới cho từng năm.
- `time` nằm trong URL nên cache tile từng năm tách biệt.

## 6. Tích hợp Mobile

Mobile mặc định gọi `GET /api/v1/web-map/layers`, nhận 34 layer riêng và dựng WMS
như raster thường — **không gửi query `time`**. Không cần thêm state slider nếu
sản phẩm Mobile chỉ yêu cầu chọn từng layer riêng.

Nếu Mobile cũng cần tính năng Time Series, gọi riêng
`GET /api/v1/web-map/time-series-layers` và giữ cùng contract HTTP/URL builder
với ReactJS. SDK bản đồ chỉ cần adapter ba thao tác:

```text
upsertRasterSource(sourceId, tileUrl, tileSize=512)
ensureRasterLayer(layerId, sourceId)
replaceRasterSourceTiles(sourceId, [tileUrl])
```

Nếu SDK không hỗ trợ thay `tiles` tại runtime:

1. Gỡ raster layer.
2. Gỡ raster source.
3. Tạo lại source cùng ID với URL mới.
4. Tạo lại layer.

Pseudocode repository/view-model:

```text
openTimeSeries(layer):
  values = layer.timeSeries.values
  selectedTime = layer.timeSeries.defaultTime ?? values.last
  ticket = layer.isPublic ? null : MapRepository.validRasterTileTicket(layer.id)
  tileUrl = buildTimeSeriesTileUrl(layer.id, selectedTime, ticket)
  map.upsertRasterSource(SOURCE_ID, tileUrl, 512)
  map.ensureRasterLayer(RENDER_LAYER_ID, SOURCE_ID)

selectTime(value):
  reject value not in available values
  ticket = layer.isPublic ? null : MapRepository.validRasterTileTicket(layer.id)
  tileUrl = buildTimeSeriesTileUrl(layer.id, value, ticket)
  map.replaceRasterSourceTiles(SOURCE_ID, [tileUrl])

onAppResume():
  refresh ticket when expiresAt <= now + 60 seconds
  rebuild tile URL when ticket changed
```

Mobile lifecycle:

- Cache ticket trong RAM, không lưu plaintext lâu dài.
- Khi app resume, kiểm tra `expiresAt` trước khi map tải tile.
- Nếu tile nhận `401/403`, refresh ticket đúng một lần rồi rebuild URL.
- Khi đổi user/logout, xóa ticket cache và raster source private.
- Không tải trước cả 24 năm. Chỉ tải năm đang chọn; preload năm liền kề là tối ưu
  tùy chọn sau khi đo hiệu năng.
- Offline Time Series không tự có. Muốn offline phải thiết kế tile pack riêng theo
  từng mốc thời gian và quota thiết bị.

## 7. State đề xuất

FE/Mobile giữ state tối thiểu:

```ts
type TimeSeriesState = {
    layerId: number;
    values: string[];
    selectedTime: string;
    defaultTime: string | null;
    ticket: string | null;
    ticketExpiresAt: string | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
};
```

Không lưu URL tile hoàn chỉnh vào persistent storage vì URL có ticket.

## 8. Error handling

| HTTP/trạng thái | Ý nghĩa                           | Client xử lý                                             |
| --------------- | --------------------------------- | -------------------------------------------------------- |
| `400`           | Query/bbox sai                    | Dừng request, báo lỗi contract                           |
| `401`           | Layer private chưa đăng nhập      | Yêu cầu đăng nhập                                        |
| `403`           | Thiếu ACL hoặc ticket sai/hết hạn | Refresh ticket một lần; còn lỗi thì báo quyền            |
| `404`           | Layer bị xoá/chưa publish         | Gỡ source/layer khỏi map                                 |
| `422`           | Tham số `time` sai hợp đồng      | Xem bảng mã lỗi bên dưới                                |
| `429`           | Vượt rate limit                   | Backoff, không retry liên tục                            |
| `5xx`           | Backend/GeoServer lỗi             | Giữ năm hiện tại, cho phép retry                         |
| Tile trong suốt | GeoServer trả blank tile          | Kiểm tra time có trong `values`, extent và publish state |

Mã lỗi `422` trong trường `errors`:

| Mã                   | Nguyên nhân                            | Cách sửa ở client                              |
| -------------------- | -------------------------------------- | ---------------------------------------------- |
| `TIME_REQUIRED`      | Layer Time Series nhưng thiếu `time`   | Đọc `timeSeries.defaultTime` rồi gửi lại      |
| `TIME_NOT_SUPPORTED` | Gửi `time` cho layer raster thường     | Bỏ query `time` khi catalog không có field     |
| `TIME_NOT_FOUND`     | `time` không nằm trong `values`        | Reload catalog, reset về `defaultTime`         |

> [!WARNING]
> Lỗi `422` trả về **JSON**, trong khi raster source mong đợi **ảnh**. Tham số
> `exceptions=application/vnd.ogc.se_blank` chỉ áp dụng cho lỗi phát sinh bên
> GeoServer, không áp dụng cho validate tại proxy. Mapbox sẽ báo tile hỏng mà
> không hiện message — khi debug phải mở Network tab đọc body để thấy mã lỗi.

Proxy yêu cầu GeoServer trả blank transparent tile khi render lỗi để Mapbox
không cố decode XML thành ảnh. Vì vậy HTTP `200` không đảm bảo có pixel dữ liệu.
UI phải giới hạn lựa chọn theo `timeSeries.values`.

## 9. Cache và hiệu năng

- Proxy hiện trả `Cache-Control: private, max-age=60`.
- Cache key phải gồm toàn bộ query, đặc biệt `layerId`, `time`, `bbox`, `ticket`.
- GWC phải cấu hình `TIME` làm parameter filter; nếu thiếu có thể trả tile sai năm.
- GeoServer nên dùng discrete values và tắt nearest-match nếu nghiệp vụ yêu cầu
  đúng năm tuyệt đối.
- `width=512`, `height=512`, `tileSize=512` phải đồng nhất.
- Slider không tạo request cho mỗi pixel di chuyển; chỉ theo discrete index.
- Không thêm cache-buster ngẫu nhiên. `time` đã tạo URL cache riêng.

## 10. Backend gate trước khi FE/Mobile bật tính năng

Đã xong:

1. ✅ GeoTIFF cùng collection được kiểm tra tương thích (CRS, số band, data type,
   NoData, color interpretation) —
   [geotiff-time-series.service.js](../src/services/geotiff-time-series.service.js).
2. ✅ GeoServer ImageMosaic publish thành một layer khi gọi `publishCollection`.
3. ✅ Dimension `TIME` bật qua `configureCoverageTime` và xác nhận bằng
   `verifyImageMosaicTime`.
4. ✅ [map-proxy.validator.js](../src/validators/map-proxy.validator.js) nhận `time`
   ISO UTC.
5. ✅ [map-proxy.service.js](../src/services/map-proxy.service.js) forward thành
   GeoServer `TIME`.
6. ✅ [web-map.service.js](../src/services/web-map.service.js) expose
   `timeSeries.enabled/mode/defaultTime/values`.
7. ✅ Test proxy khẳng định client không thể override `layers`, `TIME` được encode
   đúng, và layer hết ảnh suy biến về raster thường thay vì khoá cứng 422 —
   [map-proxy.service.test.js](../src/services/__tests__/map-proxy.service.test.js).

Production đã xác minh ngày 2026-08-29:

8. ✅ Ba ImageMosaic có `timeSeries.values` lần lượt 5, 5 và 24 mốc.
9. ✅ 34/34 mốc trả `200 image/png`; 34 nội dung ảnh có SHA-256 khác nhau.
10. ✅ Thiếu `time` trả `422 TIME_REQUIRED`.
11. ✅ Mốc ngoài danh sách trả `422 TIME_NOT_FOUND`.
12. ✅ Migration 116 thêm `standalone_layer_id` đã chạy.
13. ✅ Test backend liên quan pass: 4 suite, 22 test.
14. ⏳ Deploy backend mới và publish 34 standalone layer.
15. ⏳ GWC parameter filter theo `TIME` vẫn cần xác minh riêng.

## 11. Acceptance checklist FE/Mobile

- [ ] `GET /web-map/layers` có đủ 34 layer lớp phủ riêng sau publish.
- [ ] Catalog mặc định không chứa Time Series IDs `172`, `173`, `174`.
- [ ] `GET /web-map/time-series-layers` trả đúng 3 layer và 5 + 5 + 24 mốc.
- [ ] Mỗi standalone layer render WMS bình thường mà không gửi `time`.
- [ ] Gửi `time` cho standalone layer trả `422 TIME_NOT_SUPPORTED`.
- [ ] Default time hiển thị đúng ảnh trên ReactJS.
- [ ] Chọn năm đầu, giữa, cuối trả ba ảnh đúng trên ReactJS.
- [ ] Thiếu một năm không làm slider tự sinh mốc đó.
- [x] Layer public chạy không ticket.
- [ ] Layer private chạy với ticket `view`.
- [ ] Ticket của layer khác trả `403`.
- [ ] Ticket hết hạn được refresh một lần.
- [ ] Logout gỡ layer private và xóa ticket cache.
- [ ] App background quá TTL rồi resume vẫn render lại.
- [ ] Kéo slider nhanh không tạo nhiều source/layer rác.
- [ ] Mobile catalog mặc định hiển thị 34 layer riêng mà không cần slider.
- [x] Production WMS không cần client gọi trực tiếp GeoServer/MinIO.
- [ ] GWC không trả ảnh năm cũ khi đổi `time`.
- [ ] Mạng chậm/mất mạng giữ UI ổn định và cho retry.

## 12. Không dùng phương án này cho

- Vector Time Series: dùng vector tile/WFS contract riêng.
- So sánh hai năm đồng thời: tạo hai raster source riêng, mỗi source có `time`
  riêng, rồi điều khiển opacity/swipe.
- Animation tốc độ cao: WMS theo slider phù hợp duyệt mốc; animation cần preload,
  giới hạn frame và đo tải GeoServer trước.
- Offline toàn bộ chuỗi: cần thiết kế tile pack/quota riêng.

## 13. Ví dụ URL production

Layer đô thị public, mốc 2002:

```text
https://apicampha.tourismpj.pro.vn/api/v1/maps/layers/174/wms?request=GetMap&version=1.3.0&bbox=20.909%2C107.166%2C21.226%2C107.416&width=512&height=512&crs=EPSG%3A4326&format=image%2Fpng&transparent=true&time=2002-01-01T00%3A00%3A00.000Z
```

ID trên là production tại ngày cập nhật. Client Time Series phải lấy `layerId` từ
`GET /api/v1/web-map/time-series-layers`, không hardcode. Khi chuyển layer sang
private, thêm tile ticket đã URL-encode.
