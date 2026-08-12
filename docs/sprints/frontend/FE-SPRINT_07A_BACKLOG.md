# FE-Sprint 07A — Admin Core Migration

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

Split from a single 27-SP FE-S07 per the §12 rule "if scope > 21 SP → split".

## Sprint Goal
Bring the shared admin surface (env, apiClient envelope, RBAC, CMS, storage, API Registry) in line with the Cẩm Phả server.

## Commitment / Stories (~12 SP)

| ID | Story | SP |
|---|---|---|
| US-FE07A.1 | `.env` swap + response envelope alignment for admin apiClient | 2 |
| US-FE07A.2 | Admin role/permission list corrections against server RBAC (server-defined roles, no hardcoded count) | 2 |
| US-FE07A.3 | Verify admin CMS pages (News, Comments, Categories, Documents, PDF Maps) against `/api/v1/cms/*` | 3 |
| US-FE07A.4 | Migrate admin storage flow → presigned MinIO everywhere | 3 |
| US-FE07A.5 | Verify API Registry admin (key lifecycle + quota + rate-limit visibility) | 2 |

## Definition of Ready
- FE-S01 Admin Gap Matrix filled for the rows in scope (Auth, Users, System Logs, CMS, Storage, API Registry, Shared Layer decision).
- Storage / Auth / API contracts required by this sprint are VERIFIED (per FE-S01).
- Admin **may reuse** the FE-S02 contract pattern, but **MUST NOT depend on** `@client/` implementation unless a shared package actually exists. `@admin/` has its own `apiClient.ts`.

## Tasks
- [ ] Update `admin/.env` for Cẩm Phả server.
- [ ] Align admin `apiClient.ts` with the Cẩm Phả envelope.
- [ ] Correct role names in `useAuthStore.ts` and route guards; consume server-defined role list from FE-S01.
- [ ] Walk each admin CMS page vs Postman; fix any drift; add ETag if contract requires.
- [ ] Move admin uploads (document, PDF thumbnail, avatar) to presigned MinIO.
- [ ] Verify `MapLayerApis/` covers key lifecycle + quotas + rate limits.

## Acceptance Criteria (BDD)

**US-FE07A.4**
```
Given an admin-role user uploads a document
When the upload begins
Then the admin calls storage/presign → PUT MinIO → commit per contract
And no legacy direct-multipart route is used
And a non-authorized role receives 403/404 per contract
```

Backend-blocker template applies for any TO_VERIFY item that turns out PARTIAL/UNKNOWN.

## Dependencies
FE-S01 admin gap analysis. **Not blocked by FE-S02** — `@admin/` has its own apiClient stack; may start in parallel with FE-S02.

## Risks
- Minor drift between admin apiClient and client apiClient — surface + reconcile in this sprint.

## Backend Blockers
Any admin module still UNKNOWN after FE-S01 must be documented per §16.3.

## Expected Acceptance Evidence
- Admin can log in, walk CMS + storage + API Registry with each server-defined role, and audit shows the expected 403/404 for non-authorized calls.

## Exit Gate
Admin core surface (Auth, RBAC, CMS, Storage, API Registry) working against Cẩm Phả server.

## Explicitly Not Included

- FE-S07B domain expansion: Remote Sensing, Spatial Statistics, Field Reports, and Shared Layer.

## FE-S07A execution record — 2026-08-10

### IMPLEMENTATION COMPLETE

- Confirmed `admin/.env` already uses the approved Cẩm Phả VPS base (`http://103.163.119.247:3006/api/v1`); no URL was invented.
- Migrated the independent admin API client: Cẩm Phả envelope, top-level list metadata normalization, bearer token, one refresh retry, normalized 401/403/404/429 behavior, and no retry for 429 auth mutations.
- Migrated Login, Profile, ChangePassword, auth store, and route access to the FE-S01 role codes: `system_admin`, `ubnd_tp`, `so_tnmt`, `so_xd`, `citizen`. No numeric-role check remains in mounted code.
- Rebuilt Users against the contracted list/create/detail/role/active/reset/delete operations; generic update, lock/unlock, and batch actions cannot emit a request.
- Rebuilt System Logs against list and cleanup only.
- Migrated News, News Comments, Documents, and PDF Maps to `/api/v1/admin/cms/*`. CMS mutations include `expectedUpdatedAt`, `visibility`, `status`, `publishedAt`, and `fileObjectId` only where contracted.
- Migrated mounted document/PDF Map file flows to `presign → PUT returned URL → commit`; no thumbnail field was invented. Avatar upload remains unavailable because Postman does not establish an avatar storage contract.
- Rebuilt MapLayerApis as API Registry core: list/create/detail/update/delete, issue/list/rotate/revoke key, and usage/quota display.
- Kept Category, CronAlertLog, VisitorStatistics, generic notifications, legacy shared-layer UI, and field-report UI unmounted/deferred.
- Made every legacy/deferred compatibility service reject locally rather than emit an old API route, including map-layer/shared-layer operations.

### STATIC VERIFIED

| Check | Result | Evidence |
| --- | --- | --- |
| Admin build | PASSED | `npm run build` passed after TypeScript and Vite production compilation. |
| Typecheck | PASSED | `npm run type-check` passed. |
| Lint bootstrap | PASSED | Direct ESLint config imports `eslint-plugin-react-x` and `eslint-plugin-react-dom`; both missing dev dependencies were added at `5.18.3` with lockfile entries. |
| Lint debt | RECORDED SEPARATELY | The script now executes but exits 1 on 211 errors / 117 warnings in 58 legacy/shared/unmounted source files, led by old Document/Feedback dialogs and deferred pages. The FE-S07A mounted core has no remaining ESLint findings. |
| Bundle/network static inspection | PASSED | Production bundle embeds `http://103.163.119.247:3006/api/v1`, contains all mounted Cẩm Phả core paths, and has no legacy regional/deferred network strings. |
| VPS safe smoke | PASSED / limited | `GET /health` = 200; public CMS news/documents/PDF maps = 200; unauthenticated `/auth/me`, admin users, system logs, and API Registry = 401 as expected. |
| Auth/RBAC, authenticated core, storage UAT | RUNTIME_TO_VERIFY | No approved VPS/UAT credential was available. No production-like mutation, login attempt, or storage presign was made. |

### RUNTIME TO VERIFY

Authenticated login, the five-role RBAC matrix, Users/System Logs/CMS/API Registry mutations, storage `presign → PUT → commit`, and 401/403/404/429 UI behavior require approved UAT credentials and safe test data. If the admin is hosted over HTTPS, the approved HTTP VPS API will be blocked by browser mixed-content policy; HTTPS/TLS or a same-origin reverse proxy is a deployment gate.

#### Postman ↔ VPS / implementation discrepancies

Endpoint: VPS base URL

Postman contract: collection default is localhost.

Server/VPS evidence: approved existing `admin/.env` uses `http://103.163.119.247:3006`; safe reads above succeeded.

Impact: admin uses the existing approved VPS base rather than an invented/local URL.

Confidence: VERIFIED for reachability; authenticated behavior remains TO_VERIFY.

Recommended action: maintain the VPS environment value and provide approved UAT credentials for authenticated verification.

Backend owner required: yes, for UAT access.

Frontend temporary strategy: none; current base is used.

Endpoint: `PATCH /api/v1/auth/me`

Postman contract: form-data `fullName`, `phone`.

Server implementation: additionally contains legacy avatar middleware/fields, but storage Postman contract has no avatar category or avatar commit mapping.

Impact: profile uses only the two Postman fields and does not offer avatar upload.

Confidence: VERIFIED.

Recommended action: publish a storage/avatar contract before enabling avatar changes.

Backend owner required: yes.

Frontend temporary strategy: profile text/phone update only.

### Remaining Admin-Side Blockers

- Category, CronAlertLog, VisitorStatistics, generic notifications: DEFER — no verified Cẩm Phả contract.
- Remote Sensing, Spatial Statistics, Field Reports, Shared Layer: DEFER to FE-S07B; no FE-S07B implementation was started.
- End-to-end FE-S07A UAT remains blocked on approved VPS credentials and safe test identifiers/layer data.

**Exit Gate: PARTIALLY PASSED (implementation complete; runtime gates remain).** Static contract migration, typecheck, production build, lint-bootstrap repair, and safe VPS reachability passed. Authenticated Users/System Logs/CMS/API Registry RBAC and storage cannot be claimed until approved UAT credentials are supplied.
Any admin domain-page gap fill (Remote Sensing, Spatial Statistics, Field Reports, Shared Layer) — belongs to FE-S07B.
