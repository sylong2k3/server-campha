# Flood/Hydrology replacement track

Ngày chốt source: 2026-08-12. Trạng thái chung:
`IMPLEMENTATION_COMPLETE_WITH_UAT_GATES`.

| Sprint | Phạm vi | Repository gate | Infrastructure/UAT gate |
|---|---|---|---|
| FLOOD-S01 | Audit Fire Risk và ma trận thay thế | Done | Xác nhận dữ liệu lịch sử cần giữ |
| FLOOD-S02 | M1–M4 modular GEE | Done | Golden events + threshold địa phương |
| FLOOD-S03 | Queue, child worker, run persistence | Done | Restart/memory/queue soak test |
| FLOOD-S04 | GCS, GeoTIFF/COG, MinIO, GeoServer | Done | Live export/archive/publish/cleanup |
| FLOOD-S05 | Public/Admin Flood API + RBAC/audit | Done | 5-role UAT trên DB đích |
| FLOOD-S06 | Client WebGIS M1–M5 | Done | Browser/responsive/live WMS UAT |
| FLOOD-S07 | Admin dashboard/run/artifact/publish | Done | Operator workflow UAT |
| FLOOD-S08 | M5 trend/frequency/change/validation | Done | Multi-year science validation |
| FLOOD-S09 | Regression, Forest retention, handoff | Done | Apply migrations 080–083 + E2E sign-off |

## Forest regression guard

Forest Classification không thuộc Flood. Migration `083` phục hồi persistence
và RBAC; route, model v5.3, cron, GEE child, ground truth, client và admin đều
giữ miền riêng. Production phải mount boundary/administrative-unit GeoJSON Cẩm
Phả, đặt expected district count, tạo bucket Forest và chạy golden snapshot.

## Evidence

- Server lint PASS; 74 suites/724 tests PASS, 1 suite/6 tests skip.
- Client build PASS; client lint 0 error.
- Admin TypeScript + Vite build PASS; targeted Flood lint PASS.
- Server production dependency audit: 0 vulnerability.

Xem báo cáo đầy đủ tại
[FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md](../../../../docs/FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md).
