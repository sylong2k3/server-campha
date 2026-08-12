# FE-Sprint 01 — Discovery, Contract Audit & Admin Gap Analysis

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal

Freeze migration scope based on real Postman + server state. Produce all reference documents that later sprints depend on.

## Commitment / Stories (~23 SP)

| ID           | Story                                                                                                                                                                                               | SP  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| US-FE01.1    | Full Postman inventory: enumerate every endpoint in `campha.postman_collection.json` with method/path/auth/params/body/response by module                                                           | 5   |
| US-FE01.2    | Server implementation trace for core modules (auth, cms, storage, web-map, spatial-statistics, remote-sensing, field-reports, api-registry) and record Postman↔server discrepancies using §7 format | 5   |
| US-FE01.3    | Fill Admin Gap Analysis matrix (§12) against actual `@admin/src/pages` and `@admin/src/service` files                                                                                               | 3   |
| US-FE01.4    | Regional Dependency Inventory grep + classification for both frontends (see §18.5 patterns)                                                                                                         | 2   |
| SPIKE-FE01.1 | Confirm the actual Cẩm Phả role list from server RBAC seed/migrations. Output the definitive list — do not hardcode a count                                                                         | 2   |
| SPIKE-FE01.2 | Confirm Cẩm Phả official map extent, center, administrative polygons from data owner or backend seed                                                                                                | 2   |
| SPIKE-FE01.3 | Run the Cẩm Phả Postman collection against local/staging server; record 0/N failures and route them to §7 discrepancy notes                                                                         | 2   |
| US-FE01.5    | Write `@docs/CAMPHA_BACKEND_STATUS.md` v1 using §6 classification                                                                                                                                   | 2   |

## Definition of Ready

- Access to `@server/`, `@server/docs/`, `@server/docs/api/campha.postman_collection.json`, `@client/`, `@admin/` read-only.
- Ability to run the server locally OR read seed/migration files to confirm roles and geometry.

## Tasks

- [x] Enumerate every Postman folder + endpoint into a structured table (JSON or MD) grouped by module.
- [x] For each core module, open the corresponding route/controller/service in `@server/src` and note any parameter/validator drift vs Postman.
- [x] For each admin page in `@admin/src/pages`, map it to a server module and mark the gap (KEEP/ENV_SWAP/VERIFY/MIGRATE/ADD_PAGE/REBUILD/DEFER/NOT_APPLICABLE).
- [x] Grep both frontends for the §18.5 patterns; classify every hit (KEEP/REPLACE/REMOVE/REFACTOR/REVIEW).
- [x] Query server for role list — via seed/migration file or a login+/api/v1/auth/me for each user in fixtures.
- [x] Get Cẩm Phả bbox/center/administrative polygons from data owner or `spatial-statistics` seed rows.
- [x] Draft `@docs/CAMPHA_BACKEND_STATUS.md` v1.

## Acceptance Criteria (BDD)

**US-FE01.1**

```
Given the Cẩm Phả Postman collection
When the audit is complete
Then every endpoint is listed with method + path + auth + params + response shape
And each endpoint is tagged with a confidence label (VERIFIED/TO_VERIFY/UNKNOWN)
And the output is committed as a reference table inside @docs/CAMPHA_BACKEND_STATUS.md
```

**SPIKE-FE01.1**

```
Given the server RBAC seed/migration files
When the role list is queried
Then the output is an explicit list of role codes (e.g. system_admin, ...)
And the list carries VERIFIED confidence
And no frontend task in later sprints uses a hardcoded role count
```

**SPIKE-FE01.2**

```
Given a request for the Cẩm Phả official map extent
When the data owner or backend seed responds
Then bbox, center coordinate, and administrative polygon source are recorded
And a FE placeholder policy is documented if any of these is still deferred
```

## Dependencies

None (this is Sprint 1).

## Risks

- Data owner unavailable → SPIKE-FE01.2 may return only a "deferred with policy" outcome; downstream FE-S04 must adopt that policy.
- Postman may be out of date relative to server → discrepancies captured per §7; no silent side-taking.

## Backend Blockers

None expected — but if a core module (auth/cms/storage/web-map/map-proxy/remote-sensing/spatial-statistics/field-reports/api-registry) turns out DEMO/PARTIAL/MISSING, the downstream sprint(s) touching it are blocked and must document per §16.3.

## Expected Acceptance Evidence

- `@docs/CAMPHA_BACKEND_STATUS.md` committed.
- Filled API Migration Matrix (§9) with each core module moved from its
  initial assumption to an audited final status/confidence.
- Any unresolved item remains TO_VERIFY / UNKNOWN and has an explicit
  Backend Blocker or follow-up owner.
- Filled Admin Gap Analysis (§12) with each row assigned an action.
- Regional Dependency Inventory MD.
- Definitive role list.
- Cẩm Phả extent decision recorded.

## FE-S01 Acceptance Evidence — 2026-08-10

- [x] `docs/CAMPHA_BACKEND_STATUS.md` contains the full 172-request Postman inventory with method, path, auth, params, body and available response-shape evidence.
- [x] Core implementation traces, conservative module statuses/confidence, and Postman↔Server discrepancies are recorded.
- [x] Admin Gap Analysis assigns an action to every routed admin page/surface; required regional-dependency hits are classified.
- [x] RBAC roles verified from server migration/seed: `system_admin`, `ubnd_tp`, `so_tnmt`, `so_xd`, `citizen`.
- [x] Map extent/polygon outcome is UNKNOWN with a strict placeholder policy; no coordinates or geometry were invented.
- [x] Runtime result recorded accurately: local endpoint unreachable, Postman run NOT RUN (0/172).
- [x] PARTIAL/MISSING/UNKNOWN dependencies use Backend Blocker records and downstream readiness is classified.

### SPIKE-FE01.3 Runtime Follow-up — 2026-08-10

- [ ] Runtime contract verification complete — **BLOCKED**. The server cannot start without real required environment values; PostgreSQL/PostGIS is unavailable locally. This item is intentionally unchecked and no static evidence was promoted to runtime verification.

| Runtime evidence | Actual result |
| --- | --- |
| Supported runtime | Node v24.14.1 / npm v11.11.0 ready; native Node + PostgreSQL/PostGIS deployment model; Redis not applicable. |
| Dependency install | npm ci blocked by package-lock.json drift (missing prettier@3.9.6); local npm install with lockfile writes disabled was used for diagnosis only. |
| Server | BLOCKED before HTTP bind by required environment validation: APP_NAME, APP_URL, FRONTEND_URL, CORS_ORIGINS, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET, JWT_SECRET_REFRESH, LAYER_WORK_DIR. |
| Database / seed | BLOCKED: npm run migrate:status received ECONNREFUSED for ::1:5432 and 127.0.0.1:5432; no migration or seed was run. |
| Postman collection | TOTAL 172; PASSED 0; FAILED 0; SKIPPED 172 — unexecuted because no server was reachable. |
| Optional integrations | MinIO, ClamAV, GeoServer, FCM/push, and layer worker were disabled/not configured; weather is explicitly degraded without its optional API key. |
| RBAC / geometry | Static roles remain VERIFIED; runtime RBAC is NOT RUN. Geometry/map center/bbox/polygon remains UNKNOWN; no values were invented. |

Runtime findings, blockers, module statuses, and downstream decisions are recorded in docs/CAMPHA_BACKEND_STATUS.md under the Runtime Follow-up sections. FE-S02 and later were not started.

### SPIKE-FE01.3 VPS Runtime Verification — 2026-08-10

- [x] Existing admin configuration supplied the approved Cẩm Phả VPS API base URL; it was used without guessing or changing any environment file.
- [x] Safety-filtered Postman runtime subset completed: 12 passed, 0 failed, 160 skipped. Health, public CMS, and public Web Map success/list envelopes are runtime-verified.
- [ ] Authenticated runtime verification remains incomplete — approved VPS/UAT credentials are unavailable. No dev-only collection password was sent to the VPS, and no admin/mutation request was executed.
- [ ] Client Cẩm Phả API configuration remains incomplete — the client active environment still targets a legacy host; this is recorded for a later explicitly-scoped configuration task, not changed in FE-S01.

| VPS runtime evidence | Actual result |
| --- | --- |
| Base URL source | Existing admin .env VITE_BASE_URL / VITE_API_BASE_URL; no VPS URL was invented. |
| Safe requests | GET /health, public CMS/Web Map/Remote reads, plus expected anonymous 401 and validation 400: all passed. |
| Auth/RBAC | Static role list remains VERIFIED; login and authenticated /auth/me are SKIPPED as AUTH_RBAC_SETUP. |
| Full collection | TOTAL 172; PASSED 12; FAILED 0; SKIPPED 160. Mutation/destructive requests are UNSAFE_FOR_LIVE_RUNTIME; data/credential-dependent requests remain skipped. |
| Local infrastructure | Not required for this VPS verification; no local backend, PostgreSQL/PostGIS, MinIO, GeoServer, or ClamAV was provisioned. |

Detailed VPS evidence, response-shape discrepancy, safety classifications, and FE-S02 conditions are recorded in docs/CAMPHA_BACKEND_STATUS.md under VPS Runtime Verification. FE-S02 and later were not started.

### FE-S01 Exit Gate Assessment

**PARTIALLY PASSED.** Static audit evidence plus public VPS runtime evidence are complete. A full pass still needs approved VPS/UAT credentials for login and authenticated /auth/me, safe live identifiers for the remaining non-mutating requests, and client configuration to the approved Cẩm Phả VPS API. Official extent/polygon remains UNKNOWN under the documented placeholder policy. FE-S02 and later were not started.

## Exit Gate

Audit complete and every module classified per §6; Admin Gap Matrix rows all assigned an action; Cẩm Phả role list confirmed with VERIFIED confidence; Cẩm Phả extent confirmed or FE placeholder policy signed off. **Downstream sprints hold their own per-module readiness gate — a PARTIAL/UNKNOWN result in one module does not block sprints touching other modules.**
