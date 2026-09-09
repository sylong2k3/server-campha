# Tích hợp Chú giải (Legend) và Trạng thái Bật mặc định (Default Enable) trên Mobile

Cập nhật: 2026-09-09.

Tài liệu liên quan:
- [FLOOD_SCENARIO_MOBILE_INTEGRATION.md](FLOOD_SCENARIO_MOBILE_INTEGRATION.md): Tích hợp Kịch bản ngập (Flood Scenarios).
- [FLOOD_CLASSIFICATION_LAYERS_MOBILE_INTEGRATION.md](FLOOD_CLASSIFICATION_LAYERS_MOBILE_INTEGRATION.md): Tích hợp lớp ngập lụt theo kỳ quan trắc và lớp phân loại đối tượng.
- [GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md](GEOTIFF_TIME_SERIES_FE_MOBILE_INTEGRATION.md): Tích hợp GeoTIFF Time Series.
- [MOBILE_SERVER_HANDOFF.md](MOBILE_SERVER_HANDOFF.md): Hướng dẫn kết nối và bàn giao API Mobile.

---

## 1. Mục tiêu và Phạm vi

Tài liệu này chuẩn hóa việc triển khai hai thành phần nền tảng trên ứng dụng Mobile:
1. **Trạng thái Bật mặc định (Default Enable):** Quy tắc xác định lớp bản đồ nào tự động hiển thị khi mở ứng dụng, và cách lưu giữ trạng thái bật/tắt của người dùng khi ứng dụng refresh dữ liệu catalog.
2. **Hệ thống Chú giải động (Dynamic Legend):** Quy tắc đọc, chuẩn hóa và hiển thị chú giải màu sắc/chỉ số tương ứng với **các lớp bản đồ đang thực sự bật** trên màn hình.

Phạm vi bao gồm tất cả các loại lớp: Lớp chuyên đề GIS thông thường (Vector WFS / Raster WMS), Lớp kịch bản ngập, Lớp ngập lụt theo kỳ quan trắc, Lớp phân loại đối tượng và Lớp chuỗi thời gian (Time Series).

---

## 2. Cơ chế Bật mặc định (Default Enable) của Layer

### 2.1 Các trường dữ liệu trong Catalog

Trong API danh mục lớp bản đồ (`GET /api/v1/web-map/layers`), mỗi layer chứa hai vị trí có thể khai báo trạng thái mặc định:
1. Trường cấp 1: `is_enable_default` (`boolean`) — Cấu hình trực tiếp trong bảng `gis.layers`.
2. Trường trong metadata: `default_style.visible_by_default` (`boolean`) — Cấu hình kiểu hiển thị mặc định.

### 2.2 Công thức chuẩn hóa (Normalization Formula)

Để tương thích với WebGIS (`client/src/stores/Map/Sidebar/useDataLayerStore.js`), Mobile áp dụng công thức chuẩn hóa:

```text
isDefaultEnabled = Boolean(layer.is_enable_default || layer.default_style?.visible_by_default)
```

Nếu một trong hai trường là `true`, lớp đó được xem là có cấu hình bật mặc định.

### 2.3 Quy tắc Quản lý State trong Local Store (Rất quan trọng)

> [!IMPORTANT]
> **Quy tắc Refetch Catalog:**
> Khi ứng dụng khởi động lần đầu hoặc người dùng kéo refresh danh sách lớp:
> - Nếu một layer **lần đầu tiên xuất hiện** trong local store: Gán `enabled = isDefaultEnabled`.
> - Nếu layer **ĐÃ TỒN TẠI** trong local store từ trước: **BẮT BUỘC GIỮ NGUYÊN** giá trị `existing.enabled` do người dùng đã thao tác; **TUYỆT ĐỐI KHÔNG** gán đè lại bằng `isDefaultEnabled`.
> 
> *Lý do:* Nếu gán đè, mỗi khi ứng dụng refetch ngầm trong nền hoặc mạng kết nối lại, các lớp mà người dùng đã chủ động tắt sẽ bị bật trở lại, gây trải nghiệm rất khó chịu.

### 2.4 Ma trận hành vi mặc định theo từng phân hệ

Không phải mọi module đều dùng chung cờ `is_enable_default`. Mobile tuân thủ ma trận sau:

| Phân hệ / Module | Endpoint Catalog | Cơ chế xác định trạng thái ban đầu | Hành vi khi chuyển đổi |
| :--- | :--- | :--- | :--- |
| **Lớp GIS thông thường** | `GET /web-map/layers` | `is_enable_default \|\| default_style.visible_by_default` | Cho phép bật đồng thời nhiều lớp; giữ state khi refetch |
| **Kịch bản ngập** | `GET /flood/scenarios` | Auto-activate: tự chọn kịch bản active có layer với `min_rainfall` cao nhất | Single-selection: chỉ bật 1 kịch bản; chọn kịch bản mới thì tắt kịch bản cũ |
| **Ngập lụt & Thủy văn** | `GET /flood/layers` | Mặc định **TẮT** toàn bộ (`enabled = false`) | Người dùng chọn kỳ và tự tick chọn các artifact muốn xem |
| **Phân loại đối tượng** | `GET /forest-classification/latest` | Mặc định **BẬT** (`visible = true`, `opacity = 0.85`) | Render duy nhất 1 lớp toàn thành phố cho kỳ được chọn |
| **Chuỗi thời gian (TS)** | `GET /web-map/time-series-layers` | Quản lý theo từng bộ sưu tập riêng; slider chọn mốc thời gian | Tắt/bật độc lập theo panel Time Series |

---

## 3. Hệ thống Chú giải bản đồ (Map Legend)

### 3.1 Các nguồn cung cấp Chú giải

Ứng dụng Mobile cần tổng hợp chú giải từ 4 nguồn API chính:

```text
1. Catalog Layers:          GET /api/v1/web-map/layers               → layer.legend
2. Endpoint Legend riêng:   GET /api/v1/web-map/layers/:id/legend    → data.legend
3. Phân hệ Ngập lụt:        GET /api/v1/flood/legends                → Array các artifact legends
4. Phân hệ Phân loại:       GET /api/v1/forest-classification/latest → snapshot.provinceSummary.legend
```

### 3.2 Cấu trúc dữ liệu Legend (Legend Schemas)

#### Dạng 1: Danh mục lớp rời rạc (Categorical / Class-based)
Dùng cho phân loại rừng, loại đất, cấp độ ngập, trạng thái ranh giới:

```json
[
  {
    "color": "#AAFF03",
    "label": "Rừng lá rộng thường xanh",
    "value": 1,
    "areaKm2": 142.5,
    "areaHa": 14250.0,
    "percent": 35.8
  },
  {
    "color": "#73B2FF",
    "label": "Mặt nước, sông suối",
    "value": 2,
    "areaKm2": 45.2,
    "areaHa": 4520.0,
    "percent": 11.3
  }
]
```

Hoặc dạng object bọc có `entries`:
```json
{
  "code": "flood_extent",
  "kind": "class",
  "label": { "vi": "Vùng ngập phát hiện", "en": "Flood extent" },
  "entries": [
    { "color": "#2563eb", "value": 1, "label": "Vùng ngập" }
  ]
}
```

#### Dạng 2: Dải liên tục (Continuous / Gradient)
Dùng cho độ sâu ngập (HAND depth), chỉ số thực vật (NDVI), nhiệt độ bề mặt (LST):

```json
{
  "code": "hand_depth",
  "kind": "continuous",
  "min": 0.0,
  "max": 5.0,
  "unit": "m",
  "entries": [
    { "color": "#e0f3f8", "value": 0.0 },
    { "color": "#74add1", "value": 1.5 },
    { "color": "#313695", "value": 3.0 },
    { "color": "#081d58", "value": 5.0 }
  ]
}
```

#### Dạng 3: Nhãn đa ngôn ngữ (Multi-language Label)
Các trường nhãn có thể là chuỗi hoặc đối tượng:
```json
"label": {
  "vi": "Rừng phòng hộ",
  "en": "Protection forest"
}
```
*Quy tắc Mobile:* Ưu tiên lấy ngôn ngữ hiện tại của ứng dụng (`vi`), fallback sang `en` hoặc chuỗi thô.

### 3.3 Hiển thị Chú giải động (Dynamic Legend Component)

Nguyên tắc vàng của cửa sổ chú giải: **Chỉ hiển thị chú giải của các lớp đang thực sự BẬT trên bản đồ.**

```text
Danh sách tất cả các lớp trong Store
  ↓ (Lọc các lớp có enabled == true && visible == true)
Các lớp đang hiển thị
  ↓ (Lọc các lớp có dữ liệu legend hợp lệ)
Danh sách nhóm chú giải hiển thị trên widget
```

**Các nhóm chú giải chính:**
1. **Nhóm Lớp GIS thường:** Lấy từ `layer.legend` của các layer đang bật trong `useDataLayerStore`.
2. **Nhóm Kịch bản ngập:** Nếu có kịch bản đang active và có chú giải riêng.
3. **Nhóm Ngập lụt & Thủy văn:** Ghép theo mã `artifact.code` với danh sách `floodLegends` lấy từ `/flood/legends`.
4. **Nhóm Phân loại đối tượng:** Lấy từ `snapshot.provinceSummary.legend` khi lớp phân loại đang bật.

---

## 4. Xử lý trường hợp ngoại lệ & Fallback

1. **Lớp không có chú giải (`legend == null` hoặc rỗng):**
   - Không tạo nhóm chú giải trống làm rác giao diện.
   - Nếu lớp là Point có màu đại diện: Hiển thị 1 marker tròn đơn giản với tên lớp.
2. **Lớp WMS chưa cấu hình SLD phía GeoServer:**
   - Đối với các lớp ngập lụt (`fl_*`), backend Map Proxy tự động sinh `SLD_BODY` dựa trên palette màu chuẩn của hệ thống để GeoServer render đúng màu. Mobile không cần can thiệp SLD.
3. **Định dạng số đo diện tích:**
   - Dùng `fmtKm2`: Nếu diện tích lớn hơn `1 km²`, hiển thị `{area} km²`. Nếu nhỏ hơn, hiển thị `{area} ha`.

---

## 5. Mã nguồn mẫu trên Mobile (Dart / Flutter)

### 5.1 Model Chú giải chuẩn hóa

```dart
class LegendItem {
  final String color;
  final String label;
  final String? sublabel;
  final double? areaKm2;
  final double? areaHa;
  final double? percent;

  LegendItem({
    required this.color,
    required this.label,
    this.sublabel,
    this.areaKm2,
    this.areaHa,
    this.percent,
  });

  factory LegendItem.fromJson(dynamic json, int index) {
    if (json is String) {
      return LegendItem(color: '#94a3b8', label: json);
    }
    if (json is! Map<String, dynamic>) {
      return LegendItem(color: '#94a3b8', label: 'Mục ${index + 1}');
    }

    String resolveLabel(dynamic val) {
      if (val == null) return '';
      if (val is Map) return val['vi'] ?? val['en'] ?? val['label'] ?? '';
      return val.toString();
    }

    final label = resolveLabel(json['label']).isNotEmpty
        ? resolveLabel(json['label'])
        : resolveLabel(json['name']).isNotEmpty
            ? resolveLabel(json['name'])
            : 'Mức ${index + 1}';

    double? parseD(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v');

    return LegendItem(
      color: json['color'] ?? json['fill'] ?? json['hex'] ?? '#94a3b8',
      label: label,
      sublabel: resolveLabel(json['sublabel'] ?? json['range']),
      areaKm2: parseD(json['areaKm2'] ?? json['area_km2']),
      areaHa: parseD(json['areaHa'] ?? json['area_ha']),
      percent: parseD(json['percent'] ?? json['pct']),
    );
  }
}

class LegendGroup {
  final String id;
  final String title;
  final String? subtitle;
  final List<LegendItem> items;

  LegendGroup({
    required this.id,
    required this.title,
    this.subtitle,
    required this.items,
  });
}
```

### 5.2 Layer Model với Logic Default Enable

```dart
class MapLayerItem {
  final String id;
  final String code;
  final String nameVi;
  final bool isPublic;
  final bool isDefaultEnabled;
  bool enabled;
  final List<LegendItem> legendItems;

  MapLayerItem({
    required this.id,
    required this.code,
    required this.nameVi,
    required this.isPublic,
    required this.isDefaultEnabled,
    required this.enabled,
    required this.legendItems,
  });

  factory MapLayerItem.fromCatalogJson(Map<String, dynamic> json, {bool? currentEnabledState}) {
    final id = json['id']?.toString() ?? json['code']?.toString() ?? '';
    final isEnableDefault = json['is_enable_default'] == true;
    final visibleByDefault = json['default_style']?['visible_by_default'] == true ||
        json['metadata']?['defaultStyle']?['visible_by_default'] == true;
    
    final computedDefault = isEnableDefault || visibleByDefault;

    // Phân tích legend inline nếu có
    List<LegendItem> items = [];
    final rawLegend = json['legend'];
    if (rawLegend is List) {
      items = rawLegend.asMap().entries.map((e) => LegendItem.fromJson(e.value, e.key)).toList();
    } else if (rawLegend is Map && rawLegend['entries'] is List) {
      items = (rawLegend['entries'] as List)
          .asMap()
          .entries
          .map((e) => LegendItem.fromJson(e.value, e.key))
          .toList();
    }

    return MapLayerItem(
      id: id,
      code: json['code'] ?? '',
      nameVi: json['name_vi'] ?? json['nameVi'] ?? json['code'] ?? '',
      isPublic: json['is_public'] == true || json['isPublic'] == true,
      isDefaultEnabled: computedDefault,
      // NẾU đã có trạng thái trước đó -> giữ nguyên. NẾU chưa -> dùng computedDefault
      enabled: currentEnabledState ?? computedDefault,
      legendItems: items,
    );
  }
}
```

### 5.3 Widget Chú giải bản đồ dạng Floating / Collapsible

```dart
class MapLegendSheet extends StatelessWidget {
  final List<LegendGroup> activeGroups;

  const MapLegendSheet({Key? key, required this.activeGroups}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    if (activeGroups.isEmpty) return const SizedBox.shrink();

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Container(
        constraints: const BoxConstraints(maxHeight: 320, maxWidth: 260),
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.map_outlined, size: 16, color: Colors.blue),
                const SizedBox(width: 8),
                const Text(
                  'Chú giải bản đồ',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '${activeGroups.length}',
                    style: const TextStyle(fontSize: 11, color: Colors.blue, fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const Divider(),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: activeGroups.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final group = activeGroups[index];
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(group.title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      ...group.items.map((item) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Row(
                          children: [
                            Container(
                              width: 12,
                              height: 12,
                              decoration: BoxDecoration(
                                color: _parseColor(item.color),
                                borderRadius: BorderRadius.circular(2),
                                border: Border.all(color: Colors.black12),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item.label,
                                style: const TextStyle(fontSize: 11),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (item.percent != null)
                              Text(
                                '${item.percent!.toStringAsFixed(1)}%',
                                style: const TextStyle(fontSize: 10, color: Colors.grey),
                              ),
                          ],
                        ),
                      )),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _parseColor(String hexString) {
    try {
      final hex = hexString.replaceAll('#', '');
      return Color(int.parse('FF$hex', radix: 16));
    } catch (_) {
      return Colors.grey;
    }
  }
}
```

---

## 6. Checklist kiểm thử & Tiêu chí nghiệm thu (Acceptance Criteria)

### 6.1 Kiểm thử Bật mặc định (Default Enable)
- [ ] Khi cài đặt mới và mở ứng dụng lần đầu: Các layer có `is_enable_default == true` hoặc `visible_by_default == true` tự động được bật và hiển thị trên bản đồ.
- [ ] Các layer không cấu hình cờ mặc định ở trạng thái tắt.
- [ ] Người dùng chủ động tắt Layer A, sau đó thực hiện kéo làm mới danh sách (Pull-to-refresh) hoặc chuyển tab rồi quay lại: **Layer A vẫn phải ở trạng thái TẮT**.
- [ ] Lớp Kịch bản ngập tuân theo cơ chế auto-activate riêng, không bị ảnh hưởng bởi nút Bật/Tắt tất cả lớp.

### 6.2 Kiểm thử Chú giải động (Dynamic Legend)
- [ ] Khi chưa bật lớp nào trên bản đồ: Widget Chú giải tự động ẩn hoàn toàn (không chiếm diện tích).
- [ ] Khi bật Layer B: Widget Chú giải xuất hiện và bổ sung nhóm chú giải của Layer B.
- [ ] Khi tắt Layer B: Nhóm chú giải của Layer B tự động biến mất khỏi widget.
- [ ] Màu sắc hiển thị trong ô chú giải khớp 100% với màu sắc thể hiện trên bản đồ (được đối chiếu từ GeoServer SLD / Palette).
- [ ] Hiển thị chính xác nhãn tiếng Việt và các chỉ số diện tích, tỷ lệ phần trăm (nếu có).
