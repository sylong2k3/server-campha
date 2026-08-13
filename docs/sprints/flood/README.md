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
| FLOOD-S09 | Regression, Forest removal, handoff | Done | Apply Flood migrations + E2E sign-off |

## Forest removal decision

Forest Classification không thuộc Flood và không có phạm vi nghiệp vụ tại Cẩm Phả. Ngày 2026-08-13, route, model runtime, cron, GEE child, ground-truth API, bucket config và UI integration Forest đã bị xóa. Migration lịch sử vẫn giữ để không phá dữ liệu/schema đã áp dụng; không được dùng migration tồn tại làm bằng chứng module còn active.

## Evidence

- Server lint/test và live storage evidence: xem walkthrough ngày 2026-08-13; không giữ số suite cũ trong tài liệu sprint.
- Client build PASS; client lint 0 error.
- Admin TypeScript + Vite build PASS; targeted Flood lint PASS.
- Server production dependency audit tại thời điểm handoff: 0 vulnerability.

Xem báo cáo đầy đủ tại
[FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md](../../../../docs/FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md).
