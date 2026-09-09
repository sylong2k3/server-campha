# Tích hợp Kịch bản ngập trên Mobile

Cập nhật contract và kiểm tra Network: 2026-09-09.

Tài liệu liên quan:
- [GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md](GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md): Tích hợp GeoTIFF Time Series (ImageMosaic có tham số `time`).
- [LAYER_LEGEND_DEFAULT_ENABLE_MOBILE_INTEGRATION.md](LAYER_LEGEND_DEFAULT_ENABLE_MOBILE_INTEGRATION.md): Tích hợp chú giải (legend) và trạng thái bật mặc định (default enable).
- [FLOOD_CLASSIFICATION_LAYERS_MOBILE_INTEGRATION.md](FLOOD_CLASSIFICATION_LAYERS_MOBILE_INTEGRATION.md): Tích hợp lớp ngập lụt theo kỳ quan trắc và lớp phân loại đối tượng.
- [MOBILE_SERVER_HANDOFF.md](MOBILE_SERVER_HANDOFF.md): Quy ước API và bàn giao chung cho Mobile.

---

## 1. Mục tiêu và Kiến trúc tổng quan

Tài liệu này hướng dẫn đội phát triển ứng dụng Mobile (Flutter / Mapbox SDK) tích hợp tính năng **Kịch bản ngập (Flood Scenarios)** đồng bộ với phiên bản đã hoàn thiện trên WebGIS client (`FloodScenarioPanel.jsx`).

Luồng dữ liệu tổng thể:
```text
GET /api/v1/flood/scenarios?activeOnly=true&limit=100
  → Danh sách kịch bản ngập kèm layer bản đồ inline
  → Người dùng chọn tối đa 1 kịch bản tại 1 thời điểm (Single-selection)
  → Mobile dựng URL WMS bằng `scenario.layer.id`
  → Backend WMS Proxy xác thực quyền (ACL / Tile Ticket) và chuyển tiếp tới GeoServer
  → Mapbox RasterSource / RasterLayer render lớp ngập lên bản đồ
```

**Nguyên tắc kiến trúc bắt buộc:**
1. **Không gọi trực tiếp GeoServer hoặc MinIO:** Mọi yêu cầu bản đồ đi qua WMS Proxy của backend (`/api/v1/maps/layers/{layerId}/wms`).
2. **Không tự suy diễn layer từ ngưỡng mưa:** Mobile không tự tạo mã lớp hoặc tìm kiếm tên layer tương tự; liên kết lớp bản đồ bắt buộc đọc từ trường `scenario.layer` do server trả về.
3. **Kịch bản ngập KHÔNG gửi tham số WMS `time`:** Mỗi kịch bản liên kết tới một raster layer độc lập (standalone layer). Nếu gửi query `time`, proxy sẽ từ chối với lỗi HTTP `422 TIME_NOT_SUPPORTED`.

---

## 2. Trạng thái kiểm tra thực tế (Server & Network)

### 2.1 Đối chiếu mã nguồn Backend & WebGIS

Các tệp mã nguồn đã được đối chiếu:
- **Client WebGIS:** [`client/src/components/Map/Sidebar/elements/Datalyer/FloodScenarioPanel.jsx`](../../client/src/components/Map/Sidebar/elements/Datalyer/FloodScenarioPanel.jsx)
- **Public Routes:** [`server/src/routes/flood.routes.js`](../src/routes/flood.routes.js) (dùng `optionalAuth`)
- **Validator:** [`server/src/validators/flood.validator.js`](../src/validators/flood.validator.js) (`queryScenarioSchema`)
- **Repository:** [`server/src/repositories/flood-scenario.repository.js`](../src/repositories/flood-scenario.repository.js) (sắp xếp `min_rainfall ASC, id ASC`)
- **Service logic:** [`server/src/services/flood/analysis.service.js`](../src/services/flood/analysis.service.js) (`listScenarios`, `attachLayerToScenario`)
- **WMS Proxy:** [`server/src/routes/map-proxy.routes.js`](../src/routes/map-proxy.routes.js) và [`server/src/services/map-proxy.service.js`](../src/services/map-proxy.service.js)
- **Kiểm soát quyền:** [`server/src/middlewares/layer-access.middleware.js`](../src/middlewares/layer-access.middleware.js)

### 2.2 Ghi nhận Network tab trên môi trường Production (2026-09-08 / 2026-09-09)

Request thực tế từ WebGIS local gọi API máy chủ:
```http
GET https://apicampha.tourismpj.pro.vn/api/v1/flood/scenarios?activeOnly=true&limit=100
Origin: http://localhost:5173
```

Kết quả phản hồi:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
```
```json
{
  "message": "Danh sách kịch bản ngập úng",
  "status": 200,
  "data": {
    "items": []
  },
  "metadata": {
    "page": 1,
    "limit": 100,
    "total": 0,
    "totalPages": 0
  }
}
```

> [!WARNING]
> Máy chủ trả về HTTP `200` nhưng danh sách `items: []` rỗng (`total: 0`). Do đó giao diện WebGIS hiển thị `0/0` kịch bản và không phát sinh request tải tile WMS.
> 
> **Lưu ý cho đội Mobile:** 
> - Contract API đã sẵn sàng trong source code, nhưng dữ liệu kịch bản đang chưa có bản ghi active trên môi trường kiểm tra.
> - Ứng dụng Mobile phải xử lý hiển thị trạng thái rỗng (empty-state: "Chưa có kịch bản ngập nào"), tuyệt đối không coi đây là lỗi kết nối và không tạo vòng lặp gửi lại request liên tục (retry loop).

---

## 3. Contract API Kịch bản ngập

### 3.1 Endpoint danh sách

```http
GET /api/v1/flood/scenarios?activeOnly=true&limit=100
Authorization: Bearer <access-token> # Tùy chọn (Public endpoint)
```

**Bảng tham số Query:**

| Query Param | Kiểu dữ liệu | Mặc định | Ý nghĩa & Quy ước Mobile |
| :--- | :--- | :--- | :--- |
| `activeOnly` | `boolean` | `false` | **Bắt buộc gửi `true`** để chỉ lấy kịch bản đang kích hoạt cho người dùng cuối |
| `limit` | `integer` | `20` | Khuyến nghị gửi `100` để lấy trọn vẹn kịch bản trong 1 trang |
| `page` | `integer` | `1` | Số trang (tối thiểu 1) |
| `search` | `string` | `null` | Tìm kiếm theo mã (`code`) hoặc tên (`name_vi`) |

### 3.2 Cấu trúc Envelope & DTO

Phản hồi chuẩn của API:
```json
{
  "message": "Danh sách kịch bản ngập úng",
  "status": 200,
  "data": {
    "items": [
      {
        "id": 5,
        "code": "scenario_extreme",
        "name_vi": "Kịch bản ngập cực đoan (Mưa >= 300mm hoặc triều cường)",
        "min_rainfall": "300.00",
        "max_rainfall": null,
        "min_tide": "2.00",
        "max_tide": null,
        "layer_code": "lop_phu_sau_ngap_2024",
        "description": "Kịch bản mưa cực đoan hoặc triều dâng cao",
        "is_active": true,
        "current_rainfall": "310.50",
        "rainfall_source": "MANUAL",
        "current_tide": "2.15",
        "tide_source": "AUTO",
        "created_at": "2026-08-20T04:12:00.000Z",
        "updated_at": "2026-09-01T08:30:00.000Z",
        "layer": {
          "id": 95,
          "code": "lop_phu_sau_ngap_2024",
          "nameVi": "Lớp phủ sau ngập năm 2024",
          "category": "lop-phu-sau-ngap",
          "categoryName": "Lớp phủ sau ngập",
          "geometryType": "RASTER",
          "storageKind": "geotiff_minio",
          "srid": 32648,
          "geoserverLayer": "campha:lop_phu_sau_ngap_2024",
          "styleName": null,
          "minZoom": 8,
          "maxZoom": 18,
          "legend": null,
          "defaultStyle": null,
          "isPublic": true,
          "isEnableDefault": true,
          "canEdit": false,
          "editableFields": []
        }
      }
    ]
  },
  "metadata": {
    "page": 1,
    "limit": 100,
    "total": 1,
    "totalPages": 1
  }
}
```

> [!IMPORTANT]
> **Đặc tả Naming Convention:**
> - Các trường của đối tượng Kịch bản (`scenario`) sử dụng định dạng **`snake_case`** (ví dụ: `name_vi`, `min_rainfall`, `layer_code`, `is_active`).
> - Đối tượng lớp bản đồ lồng bên trong (`scenario.layer`) sử dụng định dạng **`camelCase`** (ví dụ: `nameVi`, `geometryType`, `geoserverLayer`, `isPublic`).
> - Trường số thực từ PostgreSQL (`NUMERIC`) có thể được serialize thành chuỗi (`"300.00"`). Model Mobile bắt buộc parse an toàn nhận cả `num`, `String` và `null`.

### 3.3 Chi tiết các trường dữ liệu

| Trường | Kiểu | Mô tả & Quy tắc xử lý |
| :--- | :--- | :--- |
| `id` | `int` | ID kịch bản (dùng làm khóa UI và định danh source Mapbox) |
| `code` | `string` | Mã định danh nghiệp vụ kịch bản |
| `name_vi` | `string` | Tên hiển thị tiếng Việt của kịch bản |
| `min_rainfall` | `double` | Ngưỡng mưa tối thiểu (mm) |
| `max_rainfall` | `double?` | Ngưỡng mưa tối đa (mm). `null` biểu thị không giới hạn trên (≥ `min_rainfall`) |
| `min_tide` | `double?` | Ngưỡng triều tối thiểu (m). `null` biểu thị không áp dụng |
| `max_tide` | `double?` | Ngưỡng triều tối đa (m). `null` biểu thị không giới hạn trên |
| `is_active` | `bool` | Trạng thái kích hoạt trong hệ thống |
| `current_rainfall` | `double?` | Lượng mưa thực tế ghi nhận hiện tại (mm) |
| `rainfall_source` | `string` | Nguồn số liệu mưa: `"MANUAL"` (nhập tay) hoặc `"AUTO"` (trạm đo tự động) |
| `current_tide` | `double?` | Mực triều thực tế ghi nhận hiện tại (m) |
| `tide_source` | `string` | Nguồn số liệu triều: `"MANUAL"` hoặc `"AUTO"` |
| `layer` | `object?` | Metadata lớp bản đồ tương ứng. **Có thể là `null`** nếu `layer_code` chưa được import/publish vào bảng `gis.layers` |

### 3.4 Quy tắc xử lý khi `layer: null`

Nếu `scenario.layer == null`:
- Kịch bản chưa có dữ liệu lớp bản đồ tương ứng trong hệ thống.
- Mobile vẫn hiển thị kịch bản trong danh sách nhưng **vô hiệu hóa (disable) ô checkbox / nút chọn**.
- Hiển thị nhãn cảnh báo: *"Chưa có lớp bản đồ"*.
- Tuyệt đối không gửi request tạo tile WMS khi người dùng bấm vào kịch bản này.

---

## 4. Quy tắc nghiệp vụ & Quản lý State trên Mobile

### 4.1 Cơ chế Chọn đơn nhất (Single-selection)

Khác với danh sách lớp bản đồ nền cho phép bật nhiều lớp cùng lúc, kịch bản ngập tuân theo quy tắc chọn đơn nhất:
1. **Bật mới:** Chọn kịch bản B khi chưa có kịch bản nào → Dựng lớp ngập B lên bản đồ.
2. **Chuyển đổi:** Đang bật kịch bản A, người dùng chọn kịch bản B → Gỡ bỏ ngay lớp A trên bản đồ, sau đó dựng lớp B.
3. **Tắt:** Đang bật kịch bản A, người dùng bấm lại vào kịch bản A (hoặc bấm icon tắt kịch bản) → Gỡ bỏ lớp A, đưa state về `null`.

### 4.2 Tách biệt hoàn toàn với Lớp dữ liệu thường

- Thao tác *"Bật tất cả lớp"* hoặc *"Tắt tất cả lớp"* trong Layer Selection **không được can thiệp** vào kịch bản ngập.
- Kịch bản ngập có nguồn dữ liệu Mapbox Source ID riêng:
  ```text
  Source ID: flood-scenario-{scenarioId}
  Layer ID:  flood-scenario-{scenarioId}-raster
  ```

### 4.3 Quy tắc Tự động kích hoạt (Auto-activate)

Theo logic WebGIS, khi danh sách kịch bản tải thành công lần đầu tiên trong phiên:
1. Lọc các kịch bản thỏa mãn: `scenario.is_active == true` VÀ `scenario.layer != null`.
2. Nếu danh sách thỏa mãn có dữ liệu, tự động chọn kịch bản có **`min_rainfall` lớn nhất**.
3. Logic auto-activate chỉ chạy **đúng 1 lần duy nhất** khi màn hình khởi tạo; không tự động kích hoạt lại nếu người dùng đã chủ động tắt kịch bản.

### 4.4 Định dạng hiển thị ngưỡng điều kiện

- **Khoảng mưa:**
  - Nếu `max_rainfall == null`: `≥ {min_rainfall} mm`
  - Nếu có `max_rainfall`: `{min_rainfall} – {max_rainfall} mm`
- **Khoảng triều:**
  - Nếu cả `min_tide` và `max_tide` đều `null`: Ẩn thông tin triều.
  - Nếu chỉ có `max_tide`: `≤ {max_tide} m`
  - Nếu chỉ có `min_tide`: `≥ {min_tide} m`
  - Nếu có cả hai: `{min_tide} – {max_tide} m`
- **Thông số hiện tại (Current conditions):**
  - Hiển thị thanh thông tin khi có ít nhất một trong hai giá trị `current_rainfall` hoặc `current_tide`.
  - Hiển thị kèm nguồn: `Thủ công` cho `MANUAL`, `Tự động từ trạm` cho `AUTO`.

---

## 5. Dựng WMS Raster Tile URL & Quyền truy cập

### 5.1 Cấu trúc URL WMS qua Proxy

Tile URL được dựng tới endpoint proxy backend:
```text
GET {apiBase}/api/v1/maps/layers/{layerId}/wms?{queryParameters}
```

> [!IMPORTANT]
> `layerId` trong URL là **`scenario.layer.id`** (kiểu số, ví dụ `95`), KHÔNG ĐƯỢC dùng `scenario.id` (ID kịch bản) hay `scenario.layer_code`.

**Chi tiết Query Parameters:**

| Tham số | Giá trị chuẩn | Ghi chú |
| :--- | :--- | :--- |
| `request` | `GetMap` | Bắt buộc |
| `version` | `1.3.0` | Phiên bản chuẩn OGC WMS |
| `bbox` | `{bbox-epsg-3857}` | **Giữ nguyên chuỗi literal** để SDK Mapbox tự thế tọa độ tile |
| `width` | `256` | Kích thước tile (khớp với `tileSize=256` của Mapbox) |
| `height` | `256` | Kích thước tile |
| `crs` | `EPSG:3857` | Web Mercator (bắt buộc dùng `crs`, không gửi `srs`) |
| `format` | `image/png` | Định dạng ảnh trong suốt |
| `transparent` | `true` | Bật kênh alpha |
| `ticket` | `<jwt_token>` | **Chỉ gửi khi lớp bản đồ là private (`isPublic == false`)** |

**Các tham số TUYỆT ĐỐI KHÔNG GỬI:**
- `layers`: Backend tự động đọc và gắn tên GeoServer layer từ DB.
- `time`: Lớp kịch bản ngập là raster độc lập, nếu gửi sẽ bị lỗi `422 TIME_NOT_SUPPORTED`.
- `styles`, `service`: Backend tự quản lý.

### 5.2 Cơ chế Vé truy cập (Tile Ticket) cho lớp Private

Do Mapbox `RasterSource` gọi HTTP request dạng tile template và không thể gắn header `Authorization: Bearer <token>`, backend hỗ trợ cơ chế cấp vé ngắn hạn (Tile Ticket):
- Nếu `scenario.layer.isPublic == true`: Gọi thẳng URL WMS, không cần ticket.
- Nếu `scenario.layer.isPublic == false`:
  1. Mobile gọi API lấy vé:
     ```http
     GET /api/v1/maps/layers/{layerId}/tile-ticket?access=view
     Authorization: Bearer <user_access_token>
     ```
  2. Phản hồi:
     ```json
     {
       "status": 200,
       "message": "Đã cấp vé truy cập bản đồ",
       "data": {
         "ticket": "eyJhbGciOiJIUzI1NiIsIn...",
         "expiresAt": "2026-09-09T09:15:00.000Z"
       }
     }
     ```
  3. Gắn tham số `&ticket={encoded_ticket}` vào URL WMS.
  4. Ticket có thời hạn mặc định 15 phút. Mobile lưu tạm trong RAM và chủ động làm mới khi vé còn dưới 60 giây.

---

## 6. Triển khai mẫu trên Mobile (Dart / Flutter)

### 6.1 Model dữ liệu

```dart
double? _parseDouble(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

class FloodScenarioLayer {
  final int id;
  final String code;
  final String nameVi;
  final String geometryType;
  final String geoserverLayer;
  final bool isPublic;
  final double? minZoom;
  final double? maxZoom;

  FloodScenarioLayer({
    required this.id,
    required this.code,
    required this.nameVi,
    required this.geometryType,
    required this.geoserverLayer,
    required this.isPublic,
    this.minZoom,
    this.maxZoom,
  });

  factory FloodScenarioLayer.fromJson(Map<String, dynamic> json) {
    return FloodScenarioLayer(
      id: json['id'] as int,
      code: json['code'] as String? ?? '',
      nameVi: json['nameVi'] as String? ?? '',
      geometryType: json['geometryType'] as String? ?? 'RASTER',
      geoserverLayer: json['geoserverLayer'] as String? ?? '',
      isPublic: json['isPublic'] as bool? ?? true,
      minZoom: _parseDouble(json['minZoom']),
      maxZoom: _parseDouble(json['maxZoom']),
    );
  }
}

class FloodScenario {
  final int id;
  final String code;
  final String nameVi;
  final double minRainfall;
  final double? maxRainfall;
  final double? minTide;
  final double? maxTide;
  final String layerCode;
  final bool isActive;
  final double? currentRainfall;
  final String rainfallSource;
  final double? currentTide;
  final String tideSource;
  final FloodScenarioLayer? layer;

  FloodScenario({
    required this.id,
    required this.code,
    required this.nameVi,
    required this.minRainfall,
    this.maxRainfall,
    this.minTide,
    this.maxTide,
    required this.layerCode,
    required this.isActive,
    this.currentRainfall,
    required this.rainfallSource,
    this.currentTide,
    required this.tideSource,
    this.layer,
  });

  factory FloodScenario.fromJson(Map<String, dynamic> json) {
    return FloodScenario(
      id: json['id'] as int,
      code: json['code'] as String? ?? '',
      nameVi: json['name_vi'] as String? ?? '',
      minRainfall: _parseDouble(json['min_rainfall']) ?? 0.0,
      maxRainfall: _parseDouble(json['max_rainfall']),
      minTide: _parseDouble(json['min_tide']),
      maxTide: _parseDouble(json['max_tide']),
      layerCode: json['layer_code'] as String? ?? '',
      isActive: json['is_active'] as bool? ?? true,
      currentRainfall: _parseDouble(json['current_rainfall']),
      rainfallSource: json['rainfall_source'] as String? ?? 'MANUAL',
      currentTide: _parseDouble(json['current_tide']),
      tideSource: json['tide_source'] as String? ?? 'MANUAL',
      layer: json['layer'] != null
          ? FloodScenarioLayer.fromJson(json['layer'] as Map<String, dynamic>)
          : null,
    );
  }
}
```

### 6.2 URL Builder

```dart
class FloodWmsUrlBuilder {
  static String buildTileUrl({
    required String apiBaseUrl,
    required int layerId,
    String? ticket,
  }) {
    final cleanBase = apiBaseUrl.replaceAll(RegExp(r'/+$'), '');
    final params = <String>[
      'request=GetMap',
      'version=1.3.0',
      'bbox={bbox-epsg-3857}',
      'width=256',
      'height=256',
      'crs=EPSG%3A3857',
      'format=image%2Fpng',
      'transparent=true',
    ];

    if (ticket != null && ticket.isNotEmpty) {
      params.add('ticket=${Uri.encodeComponent(ticket)}');
    }

    return '$cleanBase/api/v1/maps/layers/$layerId/wms?${params.join('&')}';
  }
}
```

### 6.3 Quản lý Mapbox Layer & Concurrency Guard

Để tránh lỗi chồng chéo layer khi người dùng chuyển đổi kịch bản nhanh (race-condition), sử dụng `generation counter`:

```dart
class FloodScenarioController {
  final MapboxMap mapboxMap;
  final String apiBaseUrl;
  final Future<String?> Function(int layerId) ticketProvider;

  FloodScenario? _activeScenario;
  int _renderGeneration = 0;

  FloodScenarioController({
    required this.mapboxMap,
    required this.apiBaseUrl,
    required this.ticketProvider,
  });

  FloodScenario? get activeScenario => _activeScenario;

  Future<void> toggleScenario(FloodScenario scenario) async {
    if (scenario.layer == null) return;

    // Nếu bấm lại kịch bản đang bật -> Tắt
    if (_activeScenario?.id == scenario.id) {
      await deactivate();
      return;
    }

    final currentGen = ++_renderGeneration;

    // 1. Gỡ bỏ kịch bản cũ nếu có
    if (_activeScenario != null) {
      await _removeScenarioLayer(_activeScenario!.id);
    }

    _activeScenario = scenario;
    final layer = scenario.layer!;

    // 2. Lấy ticket nếu lớp là private
    String? ticket;
    if (!layer.isPublic) {
      ticket = await ticketProvider(layer.id);
    }

    // Kiểm tra race-condition nếu người dùng đã bấm thao tác khác
    if (currentGen != _renderGeneration) return;

    // 3. Tạo URL và mount lên Mapbox
    final tileUrl = FloodWmsUrlBuilder.buildTileUrl(
      apiBaseUrl: apiBaseUrl,
      layerId: layer.id,
      ticket: ticket,
    );

    await _mountScenarioLayer(scenario.id, tileUrl, layer);
  }

  Future<void> deactivate() async {
    _renderGeneration++;
    if (_activeScenario != null) {
      await _removeScenarioLayer(_activeScenario!.id);
      _activeScenario = null;
    }
  }

  Future<void> _mountScenarioLayer(int scenarioId, String tileUrl, FloodScenarioLayer layer) async {
    final sourceId = 'flood-scenario-$scenarioId';
    final layerId = 'flood-scenario-$scenarioId-raster';

    // Thêm RasterSource
    await mapboxMap.style.addSource(
      RasterSource(
        id: sourceId,
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: layer.minZoom ?? 0,
        maxzoom: layer.maxZoom ?? 22,
      ),
    );

    // Thêm RasterLayer
    await mapboxMap.style.addLayer(
      RasterLayer(
        id: layerId,
        sourceId: sourceId,
        rasterOpacity: 0.85,
      ),
    );
  }

  Future<void> _removeScenarioLayer(int scenarioId) async {
    final sourceId = 'flood-scenario-$scenarioId';
    final layerId = 'flood-scenario-$scenarioId-raster';

    try {
      if (await mapboxMap.style.styleLayerExists(layerId)) {
        await mapboxMap.style.removeStyleLayer(layerId);
      }
      if (await mapboxMap.style.styleSourceExists(sourceId)) {
        await mapboxMap.style.removeStyleSource(sourceId);
      }
    } catch (_) {
      // Ignored
    }
  }
}
```

---

## 7. Quản lý vòng đời (App Lifecycle)

1. **Ứng dụng Resume từ Background:**
   - Kiểm tra kịch bản đang bật: nếu là lớp private và ticket hết hạn (hoặc còn dưới 60 giây), tiến hành lấy ticket mới và cập nhật lại source tiles.
2. **Thay đổi Bản đồ nền (Style Reload):**
   - Khi người dùng đổi style bản đồ (ví dụ từ Đường phố sang Vệ tinh), toàn bộ custom layers sẽ bị Mapbox xóa.
   - Lắng nghe sự kiện `onStyleLoaded`: Dựng lại lớp kịch bản ngập đang active (nếu có).
3. **Đăng xuất / Chuyển tài khoản:**
   - Hủy bỏ kịch bản ngập đang bật khỏi bản đồ.
   - Xóa cache ticket trong bộ nhớ RAM.
4. **Hủy màn hình (Dispose):**
   - Hủy bỏ các listener và đảm bảo không emit state sau khi view model đã unmount.

---

## 8. Xử lý lỗi (Error Handling)

| Mã lỗi HTTP / Tình huống | Nguyên nhân | Cách xử lý trên Mobile |
| :--- | :--- | :--- |
| `200` và `items: []` | Chưa có kịch bản nào được active | Hiển thị thông báo rỗng; không gọi WMS; không retry liên tục |
| `200` và `layer: null` | Kịch bản chưa gán lớp bản đồ hợp lệ | Disable item; hiển thị nhãn "Chưa có lớp bản đồ" |
| `401 Unauthorized` | Lớp private nhưng chưa đăng nhập | Yêu cầu người dùng đăng nhập tài khoản |
| `403 Forbidden` | Thiếu quyền xem hoặc ticket hết hạn | Tự động làm mới ticket 1 lần; nếu vẫn 403 thì thông báo không đủ quyền |
| `404 Not Found` | Lớp bản đồ bị xóa khỏi hệ thống | Gỡ lớp khỏi bản đồ, thông báo lớp không còn tồn tại |
| `422 TIME_NOT_SUPPORTED` | Mobile gửi query `time` tới lớp kịch bản | Bỏ tham số `time` khỏi URL WMS |
| `429 Too Many Requests` | Vượt ngưỡng rate limit | Tạm dừng gửi request; áp dụng exponential backoff |
| Tile hiển thị trong suốt | Không có vùng ngập trong khu vực viewport | Bình thường (GeoServer trả tile trong suốt khi không có pixel dữ liệu) |

---

## 9. Checklist kiểm thử & Tiêu chí nghiệm thu (Acceptance Criteria)

### 9.1 Kiểm thử Network (Network Tab Inspector)
- [ ] Endpoint lấy danh sách gọi đúng: `GET /api/v1/flood/scenarios?activeOnly=true&limit=100`.
- [ ] Header không chứa thông tin credential không cần thiết trên public route.
- [ ] Khi chọn kịch bản, URL WMS gọi tới `/api/v1/maps/layers/{layer.id}/wms`.
- [ ] Tham số `bbox={bbox-epsg-3857}` được giữ nguyên chuỗi format trong cấu hình Source.
- [ ] KHÔNG có tham số `time` trong URL WMS của kịch bản ngập.
- [ ] Lớp public không phát sinh request lấy `tile-ticket`.
- [ ] Lớp private phát sinh request `/tile-ticket?access=view` thành công trước khi tải tile.

### 9.2 Tiêu chí nghiệm thu chức năng
- [ ] Chỉ cho phép bật tối đa 1 kịch bản tại 1 thời điểm; chuyển đổi kịch bản mượt mà, không bị nhấp nháy hoặc chồng lấn 2 lớp.
- [ ] Bấm lại kịch bản đang chọn sẽ tắt kịch bản và gỡ layer khỏi bản đồ.
- [ ] Bật/tắt các lớp dữ liệu thường không làm tắt hoặc ảnh hưởng đến kịch bản ngập đang hiển thị.
- [ ] Kịch bản có `layer: null` bị disable, không thể bấm chọn.
- [ ] Auto-activate tự động chọn kịch bản có lượng mưa cao nhất trong lần đầu mở màn hình.
- [ ] Chuyển đổi bản đồ nền (đổi style) vẫn giữ nguyên lớp ngập đang active.
