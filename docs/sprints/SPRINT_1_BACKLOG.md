# Sprint 1 — Xác thực và quản trị người dùng

## Sprint Goal

Hoàn thiện JWT auth/user đa tổ chức, session invalidation và khóa lũy tiến. MFA/TOTP và LDAP/AD đã được loại khỏi phạm vi theo quyết định sản phẩm.

## Commitment

| Story | Scope | SP | Trạng thái |
|---|---|---:|---|
| US-1.1/1.2 | Login/logout/refresh/register/email verification hardening | 8 | Done |
| US-1.3–1.7 | CRUD/search/role/status/temp password theo organization | 8 | Done |
| US-1.9 | Progressive account lock + rate limit | 5 | Done |
| US-1.10 | MFA TOTP enrollment/login/recovery | 13 | Retired by product decision; runtime/schema xóa bằng migration `072` |
| US-1.8 | Microsoft AD qua LDAPS | — | Removed by product decision; runtime/dependency/schema được retire bằng migration `008` |

Xác thực được hỗ trợ: email/password nội bộ và Google OAuth. Không còn endpoint, provisioning, dependency hoặc UAT MFA/LDAP/AD.

## Definition of Ready

- [x] Goal, scope, capacity.
- [x] Given/When/Then success/failure/permission denial.
- [x] API/migration/test plan.
- [x] Không Docker, Redis, BullMQ, Newman, Testcontainers.
- [x] PO chốt quyền ảnh vệ tinh: UB, TNMT, XD, QT được thêm/xóa/phân loại theo mục 2.1.
- [ ] Data owner/deadline Phụ lục 2.
- [x] US-1.8 được loại khỏi scope; không dựng domain controller/LDAPS trên VPS dùng chung.

## Tasks

### Auth security

- [x] Migration 004 forward-only; VPS checksum OK.
- [x] `token_version` claim + Passport DB enforcement.
- [x] Refresh rotation/reuse invalidation.
- [x] Progressive lockout 15/30/60/120; success reset.
- [x] Register email verification không bypass DB state.
- [x] Security regression unit tests.

### MFA/TOTP — Retired

- [x] Quyết định sản phẩm: không sử dụng MFA/TOTP.
- [x] Xóa endpoint, service, repository, validator, cấu hình, Postman/Bruno contract và test MFA.
- [x] Migration `072` xóa credential, recovery code, challenge và nhánh OAuth MFA theo hướng forward-only.
- [x] Giữ khóa lũy tiến, rate limit, xác minh email, JWT rotation/replay detection và session revoke.
- [x] Write integration trên `campha_test`: auth/refresh, cross-org và local create/reset.

### LDAP/Active Directory — Retired

- [x] Quyết định sản phẩm: không triển khai AD/LDAP trên VPS dùng chung.
- [x] Xóa endpoint, provisioning, refresh revalidation, dependency `ldapts`, cấu hình và runbook.
- [x] Migration `008` thu hồi session, vô hiệu hóa LDAP-only user và drop `auth.ldap_identities`.
- [x] User-create contract khi đó chuyển local-only; Google OAuth giữ nguyên. OpenAPI đã retired tại Sprint 6a.

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
- [x] MFA contract đã retire; client chỉ xử lý token trực tiếp từ login/OAuth exchange.
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
- MFA removal: migration `072` forward-only; migration `004` giữ nguyên lịch sử checksum.
- LDAP removal: migration `005` giữ nguyên lịch sử checksum; migration `008` retire schema forward-only.

## Blockers

### DB integration

Migration `008` đã áp và checksum OK trên `campha_test`; suite xác minh `auth.ldap_identities` không còn tồn tại và local user lifecycle đạt. Production `campha` vẫn pending migration `007` và `008`; chỉ chạy sau backup. Suite write fail-fast nếu `DB_NAME` khác `campha_test`.

### Product ownership

Quyền ảnh vệ tinh đã chốt theo mục 2.1; DB hiện khớp. Còn thiếu data owner/deadline Phụ lục 2.
