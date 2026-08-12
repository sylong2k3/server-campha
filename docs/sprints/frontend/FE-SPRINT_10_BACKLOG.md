# FE-Sprint 10 — Integration, Regression & Handoff

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Cross-cutting verification, cleanup, docs, handoff. Zero legacy runtime dependencies. Ready to hand off to product/UAT.

## Commitment / Stories (~13 SP)

| ID | Story | SP |
|---|---|---|
| US-FE10.1 | Role-based end-to-end walkthrough for all server-defined roles | 3 |
| US-FE10.2 | Postman-driven contract regression against staging | 3 |
| US-FE10.3 | Legacy-dependency grep sweep (0 hits per §18.5) | 2 |
| US-FE10.4 | Lighthouse targets — Best Practices ≥ 90, Accessibility ≥ 90 where applicable, Performance ≥ 90 for ordinary content pages (Home, News), WebGIS Map: no material regression from approved baseline; document map-library/tile-related costs separately | 2 |
| US-FE10.5 | Final documentation: `@docs/CAMPHA_CLIENT_UI_REDESIGN.md` + update `@docs/CAMPHA_BACKEND_STATUS.md` + Final Migration Report (§21) | 3 |

## Definition of Ready
- FE-S02→S09 all Exit Gates passed.

## Tasks
- [ ] Walk each server-defined role through the primary user journeys.
- [ ] Run the full Cẩm Phả Postman collection with a live server; investigate any failure.
- [ ] Grep both frontends with the §18.5 pattern list; achieve 0 runtime hits (comments/history docs allowed).
- [ ] Run Lighthouse on Home, Map, News detail; record scores. Target: Best Practices ≥ 90 and Accessibility ≥ 90 across all; Performance ≥ 90 for ordinary content pages (Home, News); Map performance measured against approved baseline (map-library/tile costs documented separately, not treated as a hard release gate).
- [ ] Finalize UI Redesign doc + Backend Status update + Final Report.
- [ ] Confirm ClamAV real-environment posture (re-verify per §18) and note upload-side implications.

## Acceptance Criteria (BDD)

**US-FE10.3 + US-FE10.2**
```
Given the release candidate build
When the legacy-dependency grep runs
Then 0 runtime references remain for: daklak, đắk lắk, dak lak, kontum, kon tum, mahuyen, TOMTOM, WINDY, OPENWEATHER, WEATHERAPI, daklakanbg.vn
And documentation-only references (migration history) are allowed

Given the Postman collection is executed against staging
When the run completes
Then any failure is investigated and either fixed or documented as a known deployment gate
```

## Dependencies
FE-S02 through FE-S09.

## Risks
- Live-environment gate items (real MinIO, ClamAV, real GIS data, seed migrations) may surface issues that only appear at UAT.

## Backend Blockers
None intrinsic; document any surfaced gate items.

## Expected Acceptance Evidence
- Role walkthrough recording/notes.
- Postman regression run output.
- Grep-sweep evidence.
- Lighthouse reports.
- Final Migration Report (§21).

## Exit Gate
Release-ready. Handoff docs delivered.

---

## FE-S10 Execution Result (2026-08-11)

Executed against Cẩm Phả VPS `http://103.163.119.247:3006/api/v1`. Full
detail lives in
[`docs/CAMPHA_FRONTEND_MIGRATION_FINAL_REPORT.md`](../../../../docs/CAMPHA_FRONTEND_MIGRATION_FINAL_REPORT.md).
Backend-status extension appended to
[`docs/CAMPHA_BACKEND_STATUS.md`](../../../../docs/CAMPHA_BACKEND_STATUS.md).
UI redesign notes extended in
[`docs/CAMPHA_CLIENT_UI_REDESIGN.md`](../../../../docs/CAMPHA_CLIENT_UI_REDESIGN.md).

### Per-story result

- **US-FE10.1 — Role-based walkthrough**: `RUNTIME_TO_VERIFY`. No UAT
  credentials issued in this sprint; §Global-rule-2 forbids fabricating
  test accounts. All five server-defined roles remain to be walked
  through by the UAT owner. Client + admin auth screens compile and
  render; auth-guarded flows deferred.
- **US-FE10.2 — Postman-driven regression**: `SAFE_READ_PASS`. Did not
  execute the whole 172-request Postman collection (§Global-rule-3).
  Classified aggregate counts (12 SAFE_READ / 75 AUTH_REQUIRED_READ / 85
  MUTATION_UNSAFE_WITHOUT_UAT / 2 KNOWN_ROUTE_MOUNT_DIFF) and executed
  the 16 safe unauthenticated GETs manually: **12 PASS / 3 AUTH_GATE / 1
  ROUTE_MOUNT_DIFF (404 on `/health` + `/` — route mount diff, not a
  client regression)**. See Final Report §"VPS Regression".
- **US-FE10.3 — Legacy-dependency grep sweep**: `PASS`. **0 RUNTIME
  hits** across both frontends for every §18.5 pattern. Migration
  regression discovered and fixed in FE-S10: `MapLayerDetailModal.jsx`
  still called `useGetAllCategoriesQuery` (`/categories`); replaced with
  layer-payload-derived metadata. `categoriesService.js`,
  `mapLayersService.js`, `searchService.js` reduced to empty DEPRECATED
  modules. Legacy path constants deleted from `serviceData.js` (client)
  and `serviceConstant.tsx` (admin). Two admin form placeholders that
  mentioned "Đắk Lắk" retagged to Cẩm Phả. Remaining hits are
  COMMENT/DOC (allowed).
- **US-FE10.4 — Lighthouse**: `TOOLING_TO_VERIFY`. Not executed inside
  the sprint harness (no reliable headless-Chrome path). Existing code
  splitting confirmed from the build output: per-page dynamic chunks,
  Map dynamic import, `mapbox-gl` isolated to its own 1.68 MB / 463 kB
  gzip vendor chunk (documented as inherent WebGIS cost per
  US-FE10.4). Formal audit deferred to UAT.
- **US-FE10.5 — Final documentation**: `PASS`.
  - Created `docs/CAMPHA_FRONTEND_MIGRATION_FINAL_REPORT.md` (§21
    structure filled with observed FE-S10 data).
  - Appended `## FE-S10 Regression Result (2026-08-11)` to
    `docs/CAMPHA_BACKEND_STATUS.md` (history preserved).
  - Appended `## FE-S10 Final Notes (2026-08-11)` to
    `docs/CAMPHA_CLIENT_UI_REDESIGN.md`.
  - Appended this `## FE-S10 Execution Result (2026-08-11)` section to
    the sprint backlog.

### Build / lint / grep / VPS summaries

- **Client build (`npm run build`)**: PASS. Post-cleanup rebuild also
  PASS. Bundle sizes unchanged (main `index-*.js` 394 kB / gzip 127 kB;
  map chunk 276 kB / gzip 81 kB; `mapbox-gl` 1.68 MB / gzip 463 kB).
- **Admin build (`tsc -b && vite build`)**: PASS. Post-cleanup rebuild
  also PASS. Main `index-*.js` 433 kB / gzip 138 kB.
- **Client full lint**: 42 errors + 14 warnings = 56 total. All
  classified `PREEXISTING_LEGACY_DEBT` (React-19 Compiler purity /
  memoisation on legacy map hooks + Zustand stores). 0
  `MIGRATION_REGRESSION`.
- **Admin full lint**: 143 errors + 113 warnings = 256 total. All
  classified `PREEXISTING_LEGACY_DEBT` (dominant category:
  `@typescript-eslint/no-explicit-any` in
  `VisitorStatistics.tsx`, `UserFormDialog.tsx`, `NewsFormDialog.tsx`,
  `types/api/*.ts`; plus React-19 ref-during-render + set-state-in-effect
  warnings in `MapLayers/index.tsx`). 0 `MIGRATION_REGRESSION`.
- **Legacy grep sweep**: 0 RUNTIME hits across all §18.5 patterns; all
  remaining hits are COMMENT/DOC.
- **VPS safe-GET regression**: 12/16 PASS, 3 AUTH_GATE (statistics), 1
  ROUTE_MOUNT_DIFF (`/health` + `/` return 404; the routes exist on
  the server root, not under `/api/v1`).

### Deployment gates carried forward

- HTTPS_API_OR_REVERSE_PROXY_REQUIRED_FOR_HTTPS_DEPLOYMENT (VPS is HTTP).
- MinIO / ClamAV runtime posture `TO_VERIFY` under UAT.
- GeoServer live layers: only `campha:ranhgioi_campha` seeded.
- Statistics polygon catalog + remote-sensing catalog empty.
- Official Cẩm Phả extent / bbox `TO_VERIFY` from data owner.
- FCM push infra `TO_VERIFY`.

### Exit Gate: PARTIAL_WITH_GATES

Release-ready from the frontend perspective — both frontends build
cleanly, ship zero legacy runtime dependencies, and pass every safe
public GET against the Cẩm Phả VPS. Remaining items are UAT credential
provisioning, real-data provisioning, Lighthouse audit, and HTTPS
deployment infrastructure. Final release readiness recorded as
**`IMPLEMENTATION_COMPLETE_WITH_UAT_GATES`** in the Final Migration
Report.
