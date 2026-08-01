# Sprint 1 — Xác thực và quản trị người dùng

## Sprint Goal

Hoàn thiện JWT auth/user đa tổ chức, session invalidation và khóa lũy tiến; MFA giữ dưới feature flag; LDAP/AD tích hợp kỹ thuật, chờ hạ tầng để live UAT.

## Commitment

| Story | Scope | SP | Trạng thái |
|---|---|---:|---|
| US-1.1/1.2 | Login/logout/refresh/register/email verification hardening | 8 | Done |
| US-1.3–1.7 | CRUD/search/role/status/temp password theo organization | 8 | Done |
| US-1.9 | Progressive account lock + rate limit | 5 | Done |
| US-1.10 | MFA TOTP enrollment/login/recovery | 13 | Done kỹ thuật; `MFA_ENABLED=false`, defer UAT |
| US-1.8 | Microsoft AD qua LDAPS | — | Done code/test/migration; `LDAP_ENABLED=false`, chờ live UAT |

Backend LDAP đã có endpoint, provisioning, refresh revalidation và migration 005. Chưa bật runtime khi hạ tầng AD thật chưa đạt rollout gate.

## Definition of Ready

- [x] Goal, scope, capacity.
- [x] Given/When/Then success/failure/permission denial.
- [x] API/migration/test plan.
- [x] Không Docker, Redis, BullMQ, Newman, Testcontainers.
- [x] PO chốt quyền ảnh vệ tinh: UB, TNMT, XD, QT được thêm/xóa/phân loại theo mục 2.1.
- [ ] Data owner/deadline Phụ lục 2.
- [x] Thiết kế LDAP security được duyệt: Microsoft AD, LDAPS-only, local RBAC, pre-provision.
- [ ] Hạ tầng AD thật: endpoint, CA, private route, service account, UAT accounts.

## Tasks

### Auth security

- [x] Migration 004 forward-only; VPS checksum OK.
- [x] `token_version` claim + Passport DB enforcement.
- [x] Refresh rotation/reuse invalidation.
- [x] Progressive lockout 15/30/60/120; success reset.
- [x] Register email verification không bypass DB state.
- [x] Security regression unit tests.

### MFA

- [x] Native RFC 4226/6238 utility; AES-256-GCM.
- [x] Hashed opaque challenge; hashed single-use recovery codes.
- [x] Setup/confirm/verify API.
- [x] Password/Google privileged-role gate.
- [x] Challenge/factor/recovery/session atomic transaction + rollback self-check.
- [x] Service unit tests + read-only DB catalog integration.
- [x] Write integration trên `campha_test`: auth/refresh/MFA 3/3.

### LDAP/Active Directory

- [x] Dependency `ldapts`; structured LDAP filters chống injection.
- [x] LDAPS-only, CA/hostname verification, TLS ≥1.2, secret files, fail-fast config.
- [x] Pre-provision identity; role/org từ PostgreSQL; không JIT hoặc email auto-link.
- [x] Endpoint LDAP riêng; IP limit + progressive account lock.
- [x] Không local password/Google fallback cho LDAP identity.
- [x] Refresh revalidate AD; disabled/deleted thu hồi session; outage fail closed.
- [x] Migration 005 trên `campha_test`; checksum/integration đạt.
- [x] Unit test TLS, injection, 0/2 result, disabled, invalid credential, outage, unbind.
- [ ] Live AD UAT và production rollout.

### User/session

- [x] List/revoke own sessions.
- [x] Password changes invalidate token version + refresh tokens.
- [x] Role/status/reset/delete invalidation assertions.
- [x] Cross-org write integration evidence trên `campha_test`.

> [!NOTE]
> Thu hồi một session chặn refresh ngay; access token hiện tại có thể sống tối đa 15 phút.
> Thu hồi tất cả session tăng `token_version`, chặn access token ngay qua Passport DB enforcement.

### Contract/quality

- [x] OpenAPI Sprint 1 refresh/MFA/session operations/schemas/errors; parse OK.
- [x] Authenticated runtime smoke: sample citizen `/auth/me` 200 với `tokenVersion`.
- [x] Lint sạch; 81/81 unit; branch 77,97%; audit 0 High/Critical.
- [x] Migration 004 áp dụng VPS `campha`; integration read-only 3/3.
- [x] Postman MFA UAT được defer theo quyết định chưa sử dụng MFA; `MFA_ENABLED=false`.
- [x] `campha_test` migration rehearsal + write-capable integration suite 6/6.

## Acceptance Evidence

- Unit: RFC vectors, AES tamper, challenge expiry/reuse, recovery reuse, role/status/session invalidation.
- Transaction: injected recovery insert failure dẫn tới `ROLLBACK`, không `COMMIT`, client được release.
- Integration write: register/unverified/verify single-use, refresh rotate/replay, cross-org denial, MFA enrollment/recovery reuse.
- Integration DB tổng: foundation 3/3 + Sprint 1 write 3/3 trên `campha_test`.
- Runtime: `GET /api/v1/auth/me` trả 200 với JWT có `tokenVersion` và fresh DB lookup.
- Security: MFA/JWT secrets sinh local trong `.env`; LDAP bind password/CA chỉ được đọc từ file ngoài source.
- LDAP unit: structured filter, invalid username, 0/2 entries, disabled account, wrong credential/outage, guaranteed unbind.
- LDAP DB: migration 005 checksum OK; `auth.ldap_identities` tồn tại trên `campha_test`.

## Blockers

### LDAP/AD live UAT

Code/migration/test đã đóng. Runtime vẫn `LDAP_ENABLED=false`. Cần AD endpoint, CA, service account chỉ đọc, private VPS→DC route, lockout policy, identity-role-org mapping được data owner duyệt và UAT accounts. Theo [LDAP_AD_RUNBOOK.md](file:///C:/Users/SunSun/Documents/DuAN_20226/campha/server-campha/docs/LDAP_AD_RUNBOOK.md).

### DB integration

Đã đóng. `campha_test` áp dụng 000–005 checksum OK; foundation và write integration 6/6. Suite fail-fast nếu `DB_NAME` khác `campha_test`.

### Product ownership

Quyền ảnh vệ tinh đã chốt theo mục 2.1; DB hiện khớp. Còn thiếu data owner/deadline Phụ lục 2.
