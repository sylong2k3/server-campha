# Sprint 1 — Xác thực và quản trị người dùng

## Sprint Goal

Hoàn thiện JWT auth/user đa tổ chức, session invalidation và khóa lũy tiến.

## Commitment

| Story | Scope | SP | Trạng thái |
|---|---|---:|---|
| US-1.1/1.2 | Login/logout/refresh/register/email verification hardening | 8 | Done |
| US-1.3–1.7 | CRUD/search/role/status/temp password theo organization | 8 | Done |
| US-1.9 | Progressive account lock + rate limit | 5 | Done |

Xác thực được hỗ trợ: email/password nội bộ và Google OAuth.

## Definition of Ready

- [x] Goal, scope, capacity.
- [x] Given/When/Then success/failure/permission denial.
- [x] API/migration/test plan.
- [x] Không Docker, Redis, BullMQ, Newman, Testcontainers.
- [x] PO chốt quyền ảnh vệ tinh: UB, TNMT, XD, QT được thêm/xóa/phân loại theo mục 2.1.
- [ ] Data owner/deadline Phụ lục 2.

## Tasks

### Auth security

- [x] Migration 004 forward-only; VPS checksum OK.
- [x] `token_version` claim + Passport DB enforcement.
- [x] Refresh rotation/reuse invalidation.
- [x] Progressive lockout 15/30/60/120; success reset.
- [x] Register email verification không bypass DB state.
- [x] Security regression unit tests.

### User/session

- [x] List/revoke own sessions.
- [x] Password changes invalidate token version + refresh tokens.
- [x] Role/status/reset/delete invalidation assertions.
- [x] Cross-org write integration evidence trên `campha_test`.

> [!NOTE]
> Thu hồi một session chặn refresh ngay; access token hiện tại có thể sống tối đa 15 phút.
> Thu hồi tất cả session tăng `token_version`, chặn access token ngay qua Passport DB enforcement.

### Contract/quality

- [x] Contract Sprint 1 refresh/session operations/schemas/errors đã được kiểm chứng; OpenAPI lịch sử retired tại Sprint 6a, Postman được giữ.
- [x] Authenticated runtime smoke: sample citizen `/auth/me` 200 với `tokenVersion`.
- [x] Lint, unit, coverage và security audit đạt; số liệu hiện hành ở Acceptance Evidence.
- [x] Migration 004 áp dụng VPS `campha`; integration read-only 3/3.
- [x] `campha_test` migration rehearsal + write-capable integration suite.

## Acceptance Evidence

- Unit: `127/127` passed (`6` GDAL-local tests skipped trong generic run).
- Coverage branches: `77.15%` (ngưỡng ≥75%).
- Lint: passed.
- Security audit production: 0 vulnerabilities.
- Integration write: register/unverified/verify single-use, refresh rotate/replay, cross-org denial, local create/reset session revoke.
- Integration DB tổng: foundation + Sprint 1 + Sprint 3 trên `campha_test`.
- Runtime: `GET /api/v1/auth/me` trả 200 với JWT có `tokenVersion` và fresh DB lookup.
- Security: JWT secrets sinh local trong `.env`; Google OAuth secret không đưa vào source/log.

## Blockers

Migration foundation đã áp và checksum OK trên `campha_test`; local user lifecycle đạt. Production `campha` chỉ migrate sau backup. Suite write fail-fast nếu `DB_NAME` khác `campha_test`.

## Delta RBAC Flood/Hydrology — 2026-08-12

- [x] Migration `082_flood_runtime_rbac.sql` cấp quyền rõ ràng, không dựa vào bypass ngầm cho admin.
- [x] `system_admin`, `so_tnmt`: `flood.read/run/calibrate/publish/configure`.
- [x] `ubnd_tp`, `so_xd`: `flood.read/run`.
- [x] `citizen`: `flood.read`; khách chỉ thấy endpoint công khai và product đã công bố.
- [x] Calibration yêu cầu quyền riêng cả khi submit và rerun; calibration artifact không thể publish trực tiếp.
- [x] Submit/rerun/cancel/publish/unpublish được ghi audit actor/IP/user-agent.
- [x] Migration lịch sử `083_forest_classification_domain.sql` từng cấp quyền Forest; không rollback migration đã áp.
- [x] Quyết định 2026-08-13 supersede phần Forest: xóa route, cron, child worker, service/repository, bucket config và Postman Forest vì không có nghiệp vụ rừng tại Cẩm Phả.
- [ ] Áp migration Flood còn thiếu và chạy kiểm thử phân quyền bằng tài khoản UAT của cả 5 vai trò trên môi trường đích.
- [x] Hủy yêu cầu boundary/bucket/golden Forest snapshot; không còn production gate Forest.

### Product ownership

Quyền ảnh vệ tinh đã chốt theo mục 2.1; DB hiện khớp. Còn thiếu data owner/deadline Phụ lục 2.
