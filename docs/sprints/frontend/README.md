# Frontend Migration Sprints — Cẩm Phả

Sprint backlog track for migrating `@client/` and `@admin/` from legacy regional deployments (Đắk Lắk / Kon Tum) to the Cẩm Phả backend.

## Flood replacement execution — 2026-08-12

- Client: mục Fire Risk và API cũ đã được thay bằng bảng Flood/Hydrology M1–M5, lịch sử product, lớp WMS và chú giải/QA.
- Admin: route `/flood`, dashboard, queue, lọc run, chi tiết stage/artifact, rerun/cancel và publish/unpublish theo RBAC.
- Forest Classification: đã xóa khỏi runtime/API/worker ngày 2026-08-13 vì không thuộc phạm vi nghiệp vụ Cẩm Phả; chỉ giữ migration lịch sử.
- Build repository: client `PASS`; admin TypeScript + Vite `PASS`.
- UAT: `RUNTIME_TO_VERIFY` cho 5 vai trò, GEE/GCS/MinIO/GeoServer thật, AOI chính thức và dữ liệu golden run.

Trạng thái delta: `IMPLEMENTATION_COMPLETE_WITH_UAT_GATES`. Báo cáo đầy đủ: [`docs/FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md`](../../../../docs/FIRE_RISK_TO_FLOOD_IMPLEMENTATION_RESULT.md).

## Sprint index

| Sprint                                            | Title                                          | Track  |
| ------------------------------------------------- | ---------------------------------------------- | ------ |
| [FE-SPRINT_01_BACKLOG](FE-SPRINT_01_BACKLOG.md)   | Discovery, Contract Audit & Admin Gap Analysis | Shared |
| [FE-SPRINT_02_BACKLOG](FE-SPRINT_02_BACKLOG.md)   | Foundation + Authentication                    | Client |
| [FE-SPRINT_03_BACKLOG](FE-SPRINT_03_BACKLOG.md)   | CMS Migration                                  | Client |
| [FE-SPRINT_04_BACKLOG](FE-SPRINT_04_BACKLOG.md)   | WebGIS Core Migration                          | Client |
| [FE-SPRINT_05_BACKLOG](FE-SPRINT_05_BACKLOG.md)   | Spatial Statistics + Remote Sensing            | Client |
| [FE-SPRINT_06_BACKLOG](FE-SPRINT_06_BACKLOG.md)   | Field Reports                                  | Client |
| [FE-SPRINT_07A_BACKLOG](FE-SPRINT_07A_BACKLOG.md) | Admin Core Migration                           | Admin  |
| [FE-SPRINT_07B_BACKLOG](FE-SPRINT_07B_BACKLOG.md) | Admin Domain Gap Fill                          | Admin  |
| [FE-SPRINT_08_BACKLOG](FE-SPRINT_08_BACKLOG.md)   | UI Foundation + Home + Map                     | Client |
| [FE-SPRINT_09_BACKLOG](FE-SPRINT_09_BACKLOG.md)   | Domain Page Redesign                           | Client |
| [FE-SPRINT_10_BACKLOG](FE-SPRINT_10_BACKLOG.md)   | Integration, Regression & Handoff              | Shared |

## Execution track

```
FE-S01
 │
 ├──► FE-S02 ─► FE-S03 ─► FE-S04 ─► FE-S05 ─► FE-S06 ─► FE-S08 ─► FE-S09 ─┐
 │                                                                         ├─► FE-S10
 └──► FE-S07A ─► FE-S07B ─────────────────────────────────────────────────┘
```

- Admin track (FE-S07A → FE-S07B) starts immediately after FE-S01 and runs in parallel with the client track.
- Client UI redesign (FE-S08 → FE-S09) only touches `@client/` and does not wait for the admin track.
- FE-S10 requires both tracks complete.

Each downstream sprint has a **per-module readiness gate** in its Definition of Ready. A PARTIAL/UNKNOWN outcome for one module in FE-S01 blocks only the sprints touching that module.

---

## Shared conventions

### Confidence rule

Every non-trivial claim in these backlogs must carry one of:

- **VERIFIED** — confirmed via Postman Cẩm Phả and/or server code
- **INFERRED** — extrapolated from current frontend without server-side verification
- **TO_VERIFY** — likely true, must be confirmed in FE-S01 before it becomes an implementation task
- **BACKEND_FUTURE** — backend roadmap item, not merged; FE must not depend on it in FE-S01–S10

Do not promote INFERRED / TO_VERIFY into an implementation task before FE-S01 verifies it.

### Backend status classification

- **READY_FOR_FE_INTEGRATION** — contract + implementation sufficient
- **READY_WITH_DEPLOYMENT_GATES** — implementation OK, production gates open (live MinIO, ClamAV, real GIS, QGIS UAT, seed migrations, pentest)
- **PARTIAL** — endpoint exists, missing important logic or contract fields
- **DEMO** — mock / hardcoded / temporary
- **PLANNED** — roadmap item, not implemented
- **MISSING** — needed by FE, no backend
- **UNKNOWN** — insufficient signal

### Postman ↔ Server discrepancy format

When any mismatch is found, record it verbatim — do not silently pick a side:

```
Endpoint:
Postman contract:
Server implementation:
Impact:
Confidence:
Recommended action:
Backend owner required:
Frontend temporary strategy:
```

### Backend blocker format

If a task depends on PARTIAL / DEMO / PLANNED / MISSING / UNKNOWN API:

```
Backend dependency:
Backend status:
Contract status:
Blocker:
Frontend impact:
Temporary strategy:
Final strategy:
Owner:
```

A task is not Done if only wired to a demo/temporary API when AC requires production contract.

### Legacy dependency grep patterns (final cleanup gate — FE-S10)

```
daklak | đắk lắk | đắk-lắk | dak lak | dak-lak
kontum | kon tum | kon-tum
mahuyen
TOMTOM | tomtom
WINDY | windy
OPENWEATHER | openweather
WEATHERAPI | weatherapi
daklakanbg\.vn
```

### Test credential policy

- Do NOT hardcode UAT usernames/passwords/tokens in Sprint markdown or any repository doc.
- Test credentials must come from: local fixtures, environment variables, private UAT documentation, or seed scripts.
- Do NOT commit secrets/tokens/passwords into `@docs/`, `@server/docs/sprints/`, or any client/admin source.

### Task standards

- Task IDs: `US-FE<N>.<seq>` (user story) · `SPIKE-FE<N>.<seq>` (research/POC).
- Story Points: Fibonacci scale (1/2/3/5/8/13/21). Match server convention where applicable.
- Acceptance Criteria: BDD Given/When/Then. Not "Update tourism page".

### Core rules

```
CẨM PHẢ POSTMAN     = PUBLIC API CONTRACT
SERVER CODE         = IMPLEMENTATION STATUS / DRIFT CHECK
OLD PROJECTS        = REFERENCE ONLY
FE-S01              = AUDIT BEFORE ASSUMPTION
API MIGRATION       BEFORE UI REDESIGN
NO GLOBAL "BACKEND READY" CLAIM
NO UNVERIFIED ADMIN PAGE
NO HARDCODED TEST SECRETS
NO PLACEHOLDER GEOMETRY AS FINAL
NO HARDCODED ROLE COUNT
NO AUTO-RETRY ON AUTH 429
```

### Section references

When a backlog references "§N", that refers to the master planning document
`C:\Users\hahie\.claude\plans\plan-mode-snuggly-whale.md`. Key sections:

- §5 Confidence Rule · §6 Backend Status · §7 Discrepancy Format · §9 API Migration Matrix
- §10.1 Feature Scope · §12 Admin Gap Analysis · §13 UI Redesign Direction
- §16.3 Backend Blocker · §17 Risks · §18.5 Grep patterns · §19 Credential Policy
- §21 Final Report Format
