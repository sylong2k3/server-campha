# FE-Sprint 07B — Admin Domain Gap Fill

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Resolve the FE-S01-classified domain gaps in admin: Remote Sensing, Spatial Statistics, Field Reports, Shared Layer. **Story action (KEEP / MIGRATE / ADD_PAGE / DEFER) is decided by FE-S01 gap analysis — not pre-committed here.**

## Commitment / Stories (~15 SP)

| ID | Story | SP |
|---|---|---|
| US-FE07B.1 | Resolve Remote Sensing admin gap. Action after FE-S01: KEEP / MIGRATE / ADD_PAGE / DEFER | 5 |
| US-FE07B.2 | Resolve Spatial Statistics admin gap. Action after FE-S01: KEEP / MIGRATE / ADD_PAGE / DEFER | 5 |
| US-FE07B.3 | Migrate Feedback admin → Field Report moderation with clustering (action confirmed MIGRATE per §12) | 3 |
| US-FE07B.4 | Shared Layer admin review. Action after FE-S01: KEEP / MIGRATE / ADD_PAGE / DEFER | 2 |

## Definition of Ready
- FE-S07A Exit Gate satisfied.
- FE-S01 gap-matrix action assigned for each row in this sprint (KEEP / MIGRATE / ADD_PAGE / DEFER).
- Field Reports module VERIFIED per §5 in FE-S01.

## Tasks
Concrete task list follows the action assigned in FE-S01; below is illustrative, not committing to ADD_PAGE for the TO_VERIFY items.
- [ ] For each domain row, read its FE-S01-assigned action; if KEEP, run contract-verification only; if MIGRATE, wire existing page to Cẩm Phả contract; if ADD_PAGE, build the new page against the Postman-confirmed contract; if DEFER, record a Backend Blocker per §16.3 and skip.
- [ ] Field Reports moderation (MIGRATE): migrate `Feedback/` page to Field Report contract + cluster + FCM if applicable.

## Acceptance Criteria (BDD)

**US-FE07B.1 (example)**
```
Given the FE-S01 action for Remote Sensing admin was ADD_PAGE
When the new admin page renders
Then GET on the Postman-confirmed remote-sensing admin endpoint is called
And categorization + compare actions succeed per contract
And a non-authorized role receives 403/404 per contract

Given the FE-S01 action for Remote Sensing admin was KEEP
When the existing page renders
Then a contract regression is recorded confirming no drift
```

## Dependencies
FE-S01 (per-row action assigned); FE-S07A (env + envelope + RBAC done). **Not blocked by FE-S02+ client track.**

## Risks
- If two rows resolve to ADD_PAGE and each costs 5+ SP, the sprint may need further split (see §17.4).
- If a domain admin module resolves to DEFER, that action must not be silently promoted to ADD_PAGE later without a follow-up gap review.

## Backend Blockers
Any domain admin module still UNKNOWN after FE-S07A must be documented per §16.3.

## Expected Acceptance Evidence
- Per row: either contract-verification evidence (KEEP), migration diff (MIGRATE), functioning new page against server (ADD_PAGE), or a Backend Blocker record (DEFER).

## Exit Gate
All admin domain gap-matrix rows resolved with their FE-S01-assigned action.

## Explicitly Not Included
Admin visual redesign (out of scope; admin stays visually as-is).

## Shared Layer decision
**Action: KEEP (no separate admin page).** FE-S07A migrated the API Registry admin (`/map-layer-apis`) which is the single administrative surface for Shared Layer slug metadata (name, allowed methods, read/write/search fields, keys, usage). Building a second CRUD page for `/shared/:slug/features` would duplicate a data-plane responsibility that already lives with the data owners (per-domain admin pages). No new page in FE-S07B for this row.

## FE-S07B Execution Result (2026-08-11)

### Per-row action outcome
- **US-FE07B.1 Remote Sensing — ADD_PAGE (implemented).** New service `admin/src/service/remoteSensingAdminService.ts` + types `admin/src/types/api/remoteSensing.ts`. New page tree `admin/src/pages/RemoteSensing/` (list, `RemoteSensingCreateDialog`, `RemoteSensingCategoryDialog`, inline delete). Route `/remote-sensing`. Uses `storageService.uploadFile(category='raster')` for optional file upload; also accepts a direct `fileObjectId` (RUNTIME_TO_VERIFY).
- **US-FE07B.2 Spatial Statistics — ADD_PAGE (implemented).** Stub `statisticsService.ts` replaced with hooks + thunks for `list/create/update/refresh` per contract. New types added to `admin/src/types/api/statistics.ts` (border-station shims retained). New page `admin/src/pages/Statistics/SpatialSources.tsx` + route `/statistics/spatial-sources`. `VisitorStatistics.tsx` untouched.
- **US-FE07B.3 Field Reports — MIGRATE (implemented).** Legacy `citizenFeedbackService.ts`, `citizenFeedback.ts`, `constant/feedbackConstant.tsx`, and `pages/Feedback/` deleted. Replaced by `fieldReportAdminService.ts` (`list/get/review/clusters` + hooks), `types/api/fieldReport.ts`, `constant/fieldReportConstant.ts`, and `pages/FieldReports/` (list, `FieldReportDetailDialog`, `FieldReportReviewDialog`). Route `/field-reports` with alias `/feedback → /field-reports`. `UserCell`/`UserText` retyped to `FieldReportUser`.
- **US-FE07B.4 Shared Layer — KEEP.** See "Shared Layer decision" above. No new page.

### Implementation
- Services added/rewritten: `remoteSensingAdminService.ts`, `statisticsService.ts`, `fieldReportAdminService.ts`.
- Types added/rewritten: `remoteSensing.ts`, `fieldReport.ts`, `statistics.ts` (extended).
- Types deleted: `citizenFeedback.ts`.
- Constants: added `fieldReportConstant.ts`; deleted `feedbackConstant.tsx`.
- Pages: added `pages/RemoteSensing/*`, `pages/Statistics/SpatialSources.tsx`, `pages/FieldReports/*`; deleted `pages/Feedback/*`.
- Router: `admin/src/App.tsx` — 3 new protected routes + 1 alias.
- Nav: `admin/src/constant/common.tsx` — 3 new sidebar entries (Ảnh viễn thám, Thống kê không gian, Phản ánh hiện trường); existing entries preserved.
- Envelope handling reuses FE-S07A `apiClient` / `useApi` (list normalized to `data.items` + `data.metadata`).

### Static verification (build / typecheck)
- `cd admin && npm run build` → **PASS** (`tsc -b && vite build`, built in ~4s).
- ESLint (targeted, changed files only) → **PASS** for all new files; one **pre-existing** warning remains on `admin/src/components/common/UserCell.tsx` (`react-refresh/only-export-components` — `displayUser` was exported alongside `UserCell` before this sprint; I only changed the type import).

### Public VPS verification
- `GET /statistics/sources` → **401 No auth token** (endpoint is auth-gated even though the plan labels it "public"; admin will call it once logged in). Not a client contract regression.
- `GET /remote-sensing/images?page=1&limit=5` → **200** with `{ data: { items: [] }, metadata: { page:1, limit:5, total:0, totalPages:0 } }` — envelope confirmed, list currently empty (EXPECTED_EMPTY).
- `GET /field-reports/public?page=1&limit=5` → **200** with the same envelope, list currently empty (EXPECTED_EMPTY).

### Authenticated admin UAT: RUNTIME_TO_VERIFY
No UAT credentials were used. All authenticated flows (`GET/POST/PATCH/DELETE /admin/remote-sensing/*`, `POST/PATCH /admin/statistics/sources`, `POST /admin/statistics/sources/:id/refresh`, `GET/PATCH /admin/field-reports/*`, `GET /admin/field-reports/clusters`) are wired to the contract but remain **RUNTIME_TO_VERIFY** until UAT with a `system_admin` account.

### Data gates
- Remote Sensing list, Field Reports list, Field Report clusters: **EXPECTED_EMPTY** on VPS as of 2026-08-11.
- Statistics sources list: cannot verify (401), page renders under RUNTIME_TO_VERIFY.

### Build: PASS
### Lint: PASS on changed files (one pre-existing warning noted above)

### Exit Gate: PARTIAL_WITH_GATES
All FE-S01 gap-matrix rows are resolved (ADD_PAGE × 2, MIGRATE × 1, KEEP × 1) with the actions assigned by FE-S01. Static gates (build + lint on changed files) pass. Runtime admin UAT deferred to a session with `system_admin` credentials — endpoints are not exercised end-to-end from this sprint execution.

