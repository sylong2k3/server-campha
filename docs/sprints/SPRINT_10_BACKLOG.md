# Sprint 10 — KTTV hai chế độ → kịch bản

## Mục tiêu

Cả hai chế độ tạo cùng payload chuẩn và đi qua cùng matcher:

1. **Tự động:** REST/JSON Weather API → mapping → chuẩn hóa → khớp.
2. **Thủ công:** cán bộ nhập payload chuẩn → khớp.

Kịch bản do đơn vị nghiệp vụ/chủ đầu tư bàn giao. Hệ thống chỉ quản lý phiên bản,
ban hành và khớp; không tự sinh kịch bản.

## API quản trị

| Method | Endpoint | Quyền |
|---|---|---|
| `GET` | `/api/v1/admin/kttv/scenarios` | `hydro.read` |
| `POST` | `/api/v1/admin/kttv/scenarios` | `kttv.match_scenario` |
| `GET` | `/api/v1/admin/kttv/scenarios/:id` | `hydro.read` |
| `PATCH` | `/api/v1/admin/kttv/scenarios/:id` | `kttv.match_scenario` |
| `POST` | `/api/v1/admin/kttv/scenarios/:id/publish` | `hydro.publish_scenario` |
| `POST` | `/api/v1/admin/kttv/inputs/manual` | `kttv.manual_input` |
| `POST` | `/api/v1/admin/kttv/sources/:id/collect` | `kttv.schedule` |
| `GET` | `/api/v1/admin/kttv/inputs` | `kttv.read` |
| `GET` | `/api/v1/admin/kttv/inputs/:id` | `kttv.read` |

## Payload chuẩn

```json
{
  "stationCode": "CP-WEATHER",
  "observedAt": "2026-08-07T09:00:00Z",
  "values": {
    "rain_1h_mm": { "value": 35.2, "unit": "mm" }
  }
}
```

## Mapping nguồn REST/JSON

Lưu trong `kttv.sources.variables`:

```json
{
  "observedAtPath": "current.time",
  "observedAtFormat": "iso",
  "stationCode": "CP-WEATHER",
  "mappings": [
    {
      "path": "current.precipitation",
      "variable": "rain_1h_mm",
      "unit": "mm",
      "factor": 1,
      "offset": 0,
      "min": 0,
      "max": 500
    }
  ]
}
```

`observedAtFormat`: `iso`, `unix_seconds`, hoặc `unix_milliseconds`.

## DSL kịch bản

Nhóm `all` hoặc `any`, tối đa 20 điều kiện; bộ khung hiện tại không lồng nhóm. Điều kiện:

```json
{
  "variable": "rain_1h_mm",
  "unit": "mm",
  "op": "between",
  "value": [30, 50]
}
```

Toán tử: `eq`, `gt`, `gte`, `lt`, `lte`, `between`. Không dùng `eval`,
JavaScript động hoặc SQL động.

Matcher chỉ xét kịch bản `official`, `is_enabled=true`, còn hiệu lực. Priority số
nhỏ thắng. Nhiều kịch bản cùng priority tốt nhất trả `ambiguous`.

## Kết quả và provenance

- `matched`: có đúng một `scenario_id`.
- `no_match`: vẫn lưu input; `scenario_id=null`.
- `ambiguous`: vẫn lưu input; `scenario_id=null`, lưu candidate IDs.
- Automatic lưu `source_id`; manual lưu `entered_by`.
- Automatic `(source_id, station_code, observed_at)` idempotent.
- Không trạng thái nào tự chạy engine thủy lực.

## Scheduler

Bật bằng `KTTV_COLLECTION_ENABLED=true`. Worker singleton đồng bộ cron nguồn mỗi
5 phút; tùy chỉnh bằng `KTTV_SCHEDULE_SYNC_CRON`. Dynamic fetch bắt buộc qua
SSRF-safe fetch và allowlist `KTTV_ALLOWED_SOURCE_HOSTS`.

## Ngoài phạm vi

Raster, cắt lớp không gian, Thiessen/IDW, fallback đa nguồn, cảnh báo và chạy
engine thủy lực.

## Nghiệm thu

- [x] Migration forward-only, provenance, RBAC.
- [x] Matcher thuần + unit test `matched/no_match/ambiguous`.
- [x] CRUD/publish kịch bản và optimistic lock.
- [x] Manual + REST/JSON automatic dùng chung matcher.
- [x] Scheduler singleton, overlap guard, graceful shutdown.
- [x] Migration rehearsal và integration test trên `campha_test`.

