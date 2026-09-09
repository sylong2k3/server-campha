# Tích hợp Lớp ngập lụt và Lớp phân loại đối tượng trên Mobile

Cập nhật: 2026-09-09.

Tài liệu liên quan:
- [FLOOD_SCENARIO_MOBILE_INTEGRATION.md](FLOOD_SCENARIO_MOBILE_INTEGRATION.md): Tích hợp Kịch bản ngập (Flood Scenarios).
- [LAYER_LEGEND_DEFAULT_ENABLE_MOBILE_INTEGRATION.md](LAYER_LEGEND_DEFAULT_ENABLE_MOBILE_INTEGRATION.md): Tích hợp chú giải (legend) và trạng thái bật mặc định (default enable).
- [GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md](GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md): Tích hợp GeoTIFF Time Series.
- [MOBILE_SERVER_HANDOFF.md](MOBILE_SERVER_HANDOFF.md): Bàn giao API Mobile.

---

## 1. Mục tiêu và So sánh Kiến trúc

Tài liệu này hướng dẫn đội phát triển Mobile tích hợp hai phân hệ bản đồ chuyên đề nâng cao:
1. **Phân hệ Ngập lụt & Thủy văn (Flood Hydrology):** Dữ liệu phân tích ngập lụt chuyên sâu theo chuỗi kỳ quan trắc radar Sentinel-1 kết hợp mô hình cao độ số (FABDEM / DTM / HAND).
2. **Phân hệ Phân loại đối tượng (Forest Classification):** Dữ liệu phân loại che phủ rừng và các đối tượng mặt đất 8 lớp toàn thành phố theo mùa / kỳ.

### Bảng so sánh khác biệt cốt lõi giữa hai phân hệ

| Đặc điểm | Phân hệ Ngập lụt & Thủy văn | Phân hệ Phân loại đối tượng |
| :--- | :--- | :--- |
| **Bản chất dữ liệu** | Đa lớp phân tích (Artifacts) trong từng kỳ quan trắc | Đơn lớp raster phân loại 8 lớp toàn thành phố |
| **Endpoint danh sách kỳ** | `GET /api/v1/flood/runs?module=trend&mode=product` | `GET /api/v1/forest-classification/published-history` |
| **Endpoint dữ liệu lớp** | `GET /api/v1/flood/layers?page=1&limit=100` | Lồng trong snapshot: `snapshot.geoserverLayer` / `geeTileUrl` |
| **Cơ chế bật/tắt trên Map** | **Bật nhiều lớp cùng lúc** (Multi-selection) trong 1 kỳ | **Chỉ 1 lớp duy nhất** (Single overlay) cho kỳ đang chọn |
| **Định danh lớp bản đồ** | `artifact.registryLayerId` (ID trong bảng `gis.layers`) | `snapshot.geoserverLayer` (Tên GeoServer layer) |
| **Phương thức render Tile** | **WMS Proxy backend:** `/maps/layers/{registryLayerId}/wms` | **GeoServer WMS trực tiếp** hoặc **Google Earth Engine XYZ Tile** |
| **Cơ chế SLD / Màu sắc** | Backend tự động sinh và đính kèm `SLD_BODY` động từ Palette | GeoServer SLD mặc định cấu hình sẵn hoặc palette của GEE |
| **Xác thực quyền (Auth)** | Hỗ trợ Tile Ticket nếu `isPublic == false` | Dữ liệu công bố công khai (Public) |
| **Trạng thái khi đổi kỳ** | Tự động **TẮT** toàn bộ artifact của kỳ cũ | Cập nhật tile URL mới cho lớp hiện tại |

---

## 2. PHẦN 1: TÍCH HỢP PHÂN HỆ NGẬP LỤT & THỦY VĂN (FLOOD HYDROLOGY)

### 2.1 Các API Endpoints

```http
1. Tổng quan hiện trạng ngập:
GET /api/v1/flood/overview

2. Danh sách kỳ giám sát (Runs):
GET /api/v1/flood/runs?module=trend&mode=product&page=1&limit=50

3. Danh sách các lớp bản đồ đã công bố (Artifacts):
GET /api/v1/flood/layers?page=1&limit=100

4. Danh mục chú giải hệ thống:
GET /api/v1/flood/legends
```

### 2.2 Cấu trúc DTO Kỳ giám sát (Flood Run)

```json
{
  "id": 24,
  "name": "Giám sát ngập lụt Đợt 2 - Tháng 8/2026",
  "module": "trend",
  "mode": "product",
  "status": "SUCCEEDED",
  "started_at": "2026-08-25T01:00:00.000Z",
  "completed_at": "2026-08-25T03:30:00.000Z",
  "analysis_periods": [
    { "start": "2026-08-01", "end": "2026-08-20" }
  ],
  "result_metadata": {
    "totalFloodAreaHa": 1250.4,
    "affectedPopulation": 4500,
    "affectedCroplandHa": 320.1,
    "affectedBuiltHa": 85.6
  }
}
```

### 2.3 Cấu trúc DTO Lớp kết quả (Artifact Layer)

```json
{
  "id": 105,
  "analysisRunId": 24,
  "module": "trend",
  "code": "flood_extent",
  "role": "REPORT",
  "registryLayerId": 142,
  "isPublic": true,
  "workspace": "campha",
  "layerName": "fl_trend_flood_extent_r24",
  "styleName": "flood_extent_style",
  "publishedAt": "2026-08-25T04:00:00.000Z",
  "metadata": {
    "label": { "vi": "Vùng ngập phát hiện", "en": "Flood extent" },
    "description": "Các khu vực được phát hiện có dấu hiệu ngập trong kỳ giám sát"
  }
}
```

### 2.4 Phân nhóm Artifacts hiển thị trên giao diện

Các lớp kết quả trong một kỳ được phân nhóm logic để người dùng dễ theo dõi:

1. **Nhóm Ngập lụt (Flood Extent):**
   - `flood_extent`: Vùng ngập đã xác nhận từ ảnh radar Sentinel-1 (Lớp chính quan trọng nhất).
2. **Nhóm Ảnh hưởng (Impact):**
   - `pop_affected`: Ước tính dân cư chịu ảnh hưởng.
   - `crop_affected`: Đất trồng trọt / nông nghiệp chịu ảnh hưởng (ha).
   - `built_affected`: Khu vực xây dựng / cơ sở hạ tầng chịu ảnh hưởng (ha).
3. **Nhóm Tiêu thoát nước (Drainage):**
   - `pond_to_built`: Mặt nước chuyển đổi thành khu xây dựng.
   - `drainage_sensitive`: Vùng nhạy cảm tiêu thoát nước, dễ ứ đọng.
   - `encroachment_alert`: Cảnh báo lấn chiếm hành lang thoát lũ.
4. **Nhóm Kiểm tra chất lượng (QA / Technical):**
   - `frequent_flood`: Vùng ngập tái diễn.
   - `flood_frequency`: Tần suất ngập.
   - `stratum`: Lớp phân tầng xử lý kỹ thuật.

### 2.5 Quy tắc tương tác bản đồ & Dựng WMS Tile URL

1. **Bật/Tắt đồng thời:** Người dùng có thể bật một hoặc nhiều artifact trong cùng 1 kỳ đang chọn (ví dụ: vừa xem `flood_extent`, vừa bật lớp `crop_affected`).
2. **Đổi kỳ quan trắc:** Khi người dùng chọn sang Run khác trong dropdown/accordion:
   - **Bắt buộc gỡ bỏ toàn bộ** các artifact của Run cũ đang hiển thị trên bản đồ.
   - Đặt lại danh sách layer đang chọn (`visibleIds = empty`).
3. **Dựng WMS Tile URL qua Proxy:**
   Tile URL của mỗi artifact bắt buộc gọi qua Map Proxy bằng **`artifact.registryLayerId`**:
   ```text
   GET {apiBase}/api/v1/maps/layers/{artifact.registryLayerId}/wms?request=GetMap&version=1.3.0&bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857&format=image/png&transparent=true
   ```
   > [!NOTE]
   > Backend Proxy tự động nhận diện mã lớp ngập (`fl_*`) và tự động chèn cấu hình màu sắc động (`SLD_BODY`) vào GeoServer. Mobile **không cần** tự build XML SLD.
4. **Xác thực quyền:**
   - Nếu `artifact.isPublic == true`: Gọi WMS trực tiếp.
   - Nếu `artifact.isPublic == false`: Lấy ticket qua `GET /api/v1/maps/layers/{registryLayerId}/tile-ticket?access=view` và gắn `&ticket={encoded_ticket}`.

---

## 3. PHẦN 2: TÍCH HỢP PHÂN HỆ PHÂN LOẠI ĐỐI TƯỢNG (FOREST CLASSIFICATION)

### 3.1 Các API Endpoints

```http
1. Lấy kết quả kỳ mới nhất:
GET /api/v1/forest-classification/latest

2. Lịch sử các kỳ đã công bố:
GET /api/v1/forest-classification/published-history?page=1&limit=24

3. Chi tiết một kỳ cụ thể theo Snapshot ID:
GET /api/v1/forest-classification/snapshot/:id
```

### 3.2 Cấu trúc DTO Snapshot & Chú giải 8 lớp

```json
{
  "status": 200,
  "message": "Lấy kết quả Phân loại đối tượng thành công.",
  "data": {
    "snapshot": {
      "id": 18,
      "year": 2026,
      "month": 6,
      "status": "PUBLISHED",
      "geoserverLayer": "campha:forest_classification_2026_06",
      "geeTileUrl": "https://earthengine.googleapis.com/v1/projects/.../tiles/{z}/{x}/{y}",
      "oobAccuracy": 0.912,
      "testKappa": 0.885,
      "provinceSummary": {
        "totalAreaHa": 48500.2,
        "forestCoveragePct": 54.2,
        "legend": [
          { "classId": 0, "nameVi": "Rừng lá rộng thường xanh", "color": "#006400", "areaHa": 18500.0, "percent": 38.14 },
          { "classId": 1, "nameVi": "Rừng hỗn giao", "color": "#228B22", "areaHa": 7800.2, "percent": 16.08 },
          { "classId": 2, "nameVi": "Rừng ngập mặn", "color": "#20B2AA", "areaHa": 1200.0, "percent": 2.47 },
          { "classId": 3, "nameVi": "Trảng cỏ, cây bụi", "color": "#ADFF2F", "areaHa": 3500.0, "percent": 7.22 },
          { "classId": 4, "nameVi": "Đất nông nghiệp", "color": "#FFD700", "areaHa": 5200.0, "percent": 10.72 },
          { "classId": 5, "nameVi": "Vùng nước tự nhiên", "color": "#1E90FF", "areaHa": 4100.0, "percent": 8.45 },
          { "classId": 6, "nameVi": "Đất trống, khai trường mỏ", "color": "#D2691E", "areaHa": 6200.0, "percent": 12.78 },
          { "classId": 7, "nameVi": "Khu dân cư, xây dựng", "color": "#DC143C", "areaHa": 2000.0, "percent": 4.12 }
        ]
      }
    }
  }
}
```

### 3.3 Cơ chế Render bản đồ & Độ trong suốt (Opacity)

1. **Hiển thị đơn lớp:** Lớp phân loại bao phủ toàn bộ diện tích thành phố Cẩm Phả. Tại một thời điểm chỉ hiển thị kết quả của 1 kỳ duy nhất.
2. **Quy tắc giải quyết nguồn Tile (Tile Resolution):**
   ```dart
   String? resolveTileUrl(ForestSnapshot snapshot, String geoserverBaseUrl) {
     // Ưu tiên 1: Lớp GeoServer WMS đã publish nội bộ
     if (snapshot.geoserverLayer != null && snapshot.geoserverLayer!.isNotEmpty) {
       return '$geoserverBaseUrl?service=WMS&version=1.3.0&request=GetMap'
           '&layers=${Uri.encodeComponent(snapshot.geoserverLayer!)}'
           '&styles=&width=256&height=256&crs=EPSG:3857&format=image/png'
           '&transparent=true&tiled=true&bbox={bbox-epsg-3857}';
     }
     // Dự phòng 2: URL XYZ Tile trực tiếp từ Google Earth Engine
     return snapshot.geeTileUrl;
   }
   ```
3. **Mặc định Bật & Điều chỉnh Opacity:**
   - Khi người dùng vào màn hình Phân loại đối tượng: Lớp tự động bật (`visible = true`).
   - Cung cấp thanh trượt (Slider) để người dùng điều chỉnh độ mờ (`opacity` từ `0.0` đến `1.0`, **giá trị khuyến nghị mặc định: `0.85`**) để có thể nhìn xuyên xuống bản đồ vệ tinh/địa hình phía dưới.
4. **Đổi kỳ phân loại:** Khi chọn một kỳ trong lịch sử (`published-history`), cập nhật lại `tileUrl` của raster source hiện tại.

---

## 4. Bảng tổng hợp so sánh luồng Mobile

```text
[MÀN HÌNH NGẬP LỤT & THỦY VĂN]
  1. GET /flood/runs               → Dropdown chọn Kỳ (Analysis Run)
  2. GET /flood/layers             → Lọc các artifacts thuộc Run đã chọn
  3. GET /flood/legends            → Ghép nhãn & màu sắc theo artifact.code
  4. Người dùng tick chọn artifacts → Thêm từng RasterSource qua Proxy backend (/maps/layers/{registryLayerId}/wms)
  5. Đổi kỳ                        → Xóa sạch các layers của kỳ cũ, load kỳ mới

[MÀN HÌNH PHÂN LOẠI ĐỐI TƯỢNG]
  1. GET /forest-classification/latest → Tự động hiển thị kỳ mới nhất
  2. Bảng chú giải 8 lớp               → Đọc trực tiếp từ snapshot.provinceSummary.legend
  3. Render bản đồ                     → 1 RasterSource duy nhất (GeoServer WMS hoặc GEE tile)
  4. Thanh điều khiển                  → Bật/tắt mắt xem + Slider chỉnh Opacity (mặc định 0.85)
  5. Đổi kỳ lịch sử                    → Cập nhật lại Tile URL của snapshot tương ứng
```

---

## 5. Mã nguồn mẫu Dart / Flutter

### 5.1 Model Phân hệ Ngập lụt

```dart
class FloodArtifact {
  final int id;
  final int analysisRunId;
  final String code;
  final String role;
  final int? registryLayerId;
  final bool isPublic;
  final String? layerName;
  final String? workspace;
  final String labelVi;

  FloodArtifact({
    required this.id,
    required this.analysisRunId,
    required this.code,
    required this.role,
    this.registryLayerId,
    required this.isPublic,
    this.layerName,
    this.workspace,
    required this.labelVi,
  });

  factory FloodArtifact.fromJson(Map<String, dynamic> json) {
    return FloodArtifact(
      id: json['id'] as int,
      analysisRunId: json['analysisRunId'] as int,
      code: json['code'] as String? ?? '',
      role: json['role'] as String? ?? 'REPORT',
      registryLayerId: json['registryLayerId'] as int?,
      isPublic: json['isPublic'] as bool? ?? true,
      layerName: json['layerName'] as String?,
      workspace: json['workspace'] as String?,
      labelVi: json['metadata']?['label']?['vi'] ?? json['code'] ?? '',
    );
  }
}
```

### 5.2 Model Phân hệ Phân loại đối tượng

```dart
class ForestLegendClass {
  final int classId;
  final String nameVi;
  final String color;
  final double areaHa;
  final double percent;

  ForestLegendClass({
    required this.classId,
    required this.nameVi,
    required this.color,
    required this.areaHa,
    required this.percent,
  });

  factory ForestLegendClass.fromJson(Map<String, dynamic> json) {
    return ForestLegendClass(
      classId: json['classId'] as int? ?? 0,
      nameVi: json['nameVi'] as String? ?? '',
      color: json['color'] as String? ?? '#94a3b8',
      areaHa: (json['areaHa'] as num?)?.toDouble() ?? 0.0,
      percent: (json['percent'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class ForestSnapshot {
  final int id;
  final int year;
  final int month;
  final String? geoserverLayer;
  final String? geeTileUrl;
  final double totalAreaHa;
  final double forestCoveragePct;
  final List<ForestLegendClass> legend;

  ForestSnapshot({
    required this.id,
    required this.year,
    required this.month,
    this.geoserverLayer,
    this.geeTileUrl,
    required this.totalAreaHa,
    required this.forestCoveragePct,
    required this.legend,
  });

  factory ForestSnapshot.fromJson(Map<String, dynamic> json) {
    final summary = json['provinceSummary'] as Map<String, dynamic>? ?? {};
    final legendRaw = summary['legend'] as List? ?? [];

    return ForestSnapshot(
      id: json['id'] as int,
      year: json['year'] as int? ?? DateTime.now().year,
      month: json['month'] as int? ?? 1,
      geoserverLayer: json['geoserverLayer'] as String?,
      geeTileUrl: json['geeTileUrl'] as String?,
      totalAreaHa: (summary['totalAreaHa'] as num?)?.toDouble() ?? 0.0,
      forestCoveragePct: (summary['forestCoveragePct'] as num?)?.toDouble() ?? 0.0,
      legend: legendRaw.map((e) => ForestLegendClass.fromJson(e)).toList(),
    );
  }
}
```

### 5.3 Controller Quản lý Lớp Ngập lụt (Hỗ trợ Multi-layer)

```dart
class FloodHydrologyController {
  final MapboxMap mapboxMap;
  final String apiBaseUrl;
  final Set<int> _activeArtifactIds = {};

  FloodHydrologyController({required this.mapboxMap, required this.apiBaseUrl});

  Set<int> get activeArtifactIds => Set.unmodifiable(_activeArtifactIds);

  Future<void> toggleArtifact(FloodArtifact artifact, {String? ticket}) async {
    if (artifact.registryLayerId == null) return;

    final sourceId = 'flood-artifact-${artifact.id}';
    final layerId = 'flood-artifact-${artifact.id}-raster';

    if (_activeArtifactIds.contains(artifact.id)) {
      _activeArtifactIds.remove(artifact.id);
      await _removeLayer(sourceId, layerId);
    } else {
      _activeArtifactIds.add(artifact.id);
      final tileUrl = _buildProxyUrl(artifact.registryLayerId!, ticket);
      await _addLayer(sourceId, layerId, tileUrl);
    }
  }

  Future<void> clearAllArtifacts() async {
    for (final id in _activeArtifactIds) {
      await _removeLayer('flood-artifact-$id', 'flood-artifact-$id-raster');
    }
    _activeArtifactIds.clear();
  }

  String _buildProxyUrl(int registryLayerId, String? ticket) {
    final params = [
      'request=GetMap',
      'version=1.3.0',
      'bbox={bbox-epsg-3857}',
      'width=256',
      'height=256',
      'crs=EPSG%3A3857',
      'format=image%2Fpng',
      'transparent=true',
    ];
    if (ticket != null) params.add('ticket=${Uri.encodeComponent(ticket)}');
    return '$apiBaseUrl/api/v1/maps/layers/$registryLayerId/wms?${params.join('&')}';
  }

  Future<void> _addLayer(String sourceId, String layerId, String tileUrl) async {
    await mapboxMap.style.addSource(
      RasterSource(id: sourceId, tiles: [tileUrl], tileSize: 256),
    );
    await mapboxMap.style.addLayer(
      RasterLayer(id: layerId, sourceId: sourceId, rasterOpacity: 0.85),
    );
  }

  Future<void> _removeLayer(String sourceId, String layerId) async {
    if (await mapboxMap.style.styleLayerExists(layerId)) {
      await mapboxMap.style.removeStyleLayer(layerId);
    }
    if (await mapboxMap.style.styleSourceExists(sourceId)) {
      await mapboxMap.style.removeStyleSource(sourceId);
    }
  }
}
```

---

## 6. Checklist kiểm thử & Tiêu chí nghiệm thu (Acceptance Criteria)

### 6.1 Phân hệ Ngập lụt & Thủy văn
- [ ] Danh sách kỳ (`/flood/runs`) hiển thị đầy đủ tên đợt giám sát và thời gian.
- [ ] Lọc chính xác các artifact thuộc kỳ đang chọn; không hiển thị artifact của kỳ khác.
- [ ] Cho phép bật/tắt độc lập nhiều artifact trong cùng 1 kỳ.
- [ ] Khi chuyển sang kỳ khác trong dropdown: Toàn bộ artifact của kỳ cũ lập tức bị gỡ khỏi bản đồ.
- [ ] URL WMS của artifact gọi qua proxy đúng `registryLayerId`.
- [ ] Màu sắc hiển thị trên tile WMS khớp với mã màu trong bảng chú giải `/flood/legends`.
- [ ] Artifact không có `registryLayerId` bị disable hoặc không phát sinh request lỗi.

### 6.2 Phân hệ Phân loại đối tượng
- [ ] Màn hình khởi động tự động tải kỳ mới nhất (`/forest-classification/latest`).
- [ ] Lớp bản đồ tự động hiển thị (`visible = true`) với opacity ban đầu `0.85`.
- [ ] Thanh trượt Opacity hoạt động mượt mà từ `0%` đến `100%`.
- [ ] Bảng chú giải hiển thị đủ 8 lớp đối tượng kèm mã màu, diện tích (ha) và phần trăm (%).
- [ ] Đổi kỳ phân loại sang một tháng/năm khác trong lịch sử cập nhật đúng tile mới tương ứng.
- [ ] Nguồn tile ưu tiên GeoServer WMS nếu có; fallback sang GEE tile nếu chưa publish GeoServer.
