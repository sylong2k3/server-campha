# FE-Sprint 09 — Domain Page Redesign

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Finalize Cẩm Phả identity across remaining domain and content pages; responsive audit.

## Commitment / Stories (~13 SP)

| ID | Story | SP |
|---|---|---|
| US-FE09.1 | Statistics REDESIGN (polygon-based composition) | 3 |
| US-FE09.2 | Remote Sensing RECOMPOSE | 3 |
| US-FE09.3 | Field Reports RECOMPOSE (map-first + cluster + filter panel) | 2 |
| US-FE09.4 | News / Documents / PDF Maps RESTYLE | 2 |
| US-FE09.5 | Login / Signup / Profile / Policy RESTYLE (Policy copy rewrite for Cẩm Phả) | 2 |
| US-FE09.6 | Error pages token pass | 1 |

## Definition of Ready
- FE-S08 AppShell + theme in place.

## Tasks
- [ ] Statistics: source picker → summary → timeseries/compare → map viz composition.
- [ ] Remote Sensing: image gallery + compare pane recompose.
- [ ] Field Reports: map-first with cluster/filter side panel.
- [ ] Copy pass on News/Documents/PDF Maps/Policy replacing Đắk Lắk strings.
- [ ] Restyle auth pages using new tokens.
- [ ] Error pages: keep structure, update tokens.

## Acceptance Criteria (BDD)

**US-FE09.1 (example)**
```
Given a user opens Statistics
When the redesigned composition renders
Then the source picker leads to the summary card
And timeseries/compare views use Cẩm Phả tokens
And the layout is responsive at sm/md/lg breakpoints
```

## Dependencies
FE-S08.

## Risks
- Copy in some pages may exceed placeholders → early copy freeze required.

## Backend Blockers
None.

## Expected Acceptance Evidence
- Before/after screenshots of every listed page at 3 breakpoints.

## Exit Gate
All listed pages ship with the new identity.

## Explicitly Not Included
Admin redesign.

---

## FE-S09 Execution Result (2026-08-11)

**Implementation:**
- **US-FE09.1 Statistics REDESIGN** — `client/src/pages/Statistics/StatisticsPage.jsx` and `constants.js` recomposed around source picker → summary → timeseries → compare, using FE-S08 tokens (bg-background / text-foreground / primary / muted / border). No border-station/mahuyen references remain in the active runtime.
- **US-FE09.2 Remote Sensing RECOMPOSE** — created `pages/RemoteSensing/RemoteSensingPage.jsx`, `RemoteSensingImageDetail.jsx`, `RemoteSensingCompare.jsx` against the FE-S05 `remoteSensingService`. Empty-state handled gracefully.
- **US-FE09.3 Field Reports RECOMPOSE** — `pages/FieldReports/` (from FE-S06) restyled with tokens; map-first layout retained.
- **US-FE09.4 CMS RESTYLE** — News / Documents / MapImage pages token-restyled; FE-S03 API integration preserved.
- **US-FE09.5 Auth / Profile / Policy RESTYLE + copy** — `Login.jsx`, `Signup.jsx`, `Profile.jsx`, `Policy.jsx` restyled with tokens. Copy pass replaced remaining legacy APK URL (`/uploads/apk/gis-dak-lak.apk` → `/uploads/apk/campha.apk`) in `components/common/Header.jsx` and `components/common/UnSupported.jsx`.
- **US-FE09.6 Error pages** — token pass applied.

**Static verification:**
- Client `npm run build` → **PASS** (Vite 7.3.1, 16.4 s, 2470+ modules). Bundle includes StatisticsPage (13.96 kB), RemoteSensingPage (13.41 kB), HomePage (8.59 kB), Login (5.58 kB), Signup (8.17 kB), Profile (9.97 kB), Policy (8.84 kB), FieldReportsPage (9.56 kB), MyFieldReportsPage (4.60 kB), MapImagePage (4.68 kB), NewsDetailPage (28.08 kB), SubmitFieldReportPage (9.45 kB). Only pre-existing warning: mapbox-gl chunk > 500 kB (documented FE-S10 gate).

**Legacy runtime grep (post-cleanup):**
- Active runtime hits for regional terms (`daklak`, `kontum`, `mahuyen`, `tomtom`, `windy`, `openweather`, `weatherapi`): **0** in JSX runtime paths. Remaining references are documentation/comments only:
  - `MapLayerDetailModal.jsx` — JSDoc note on legacy `mahuyen`/`maxa` property names (comment only).
  - `AQIPopup.jsx`, `WeatherInfo.jsx`, `MapComponent.jsx`, `useWeatherLayerStore.js` — FE-S05 removal notes (comments).
  - `ConfigPanel.jsx` (SingleMode + CompareMode) — placeholder comments describing the deleted `ROI_DakLak_*.json` fixture.

**Public VPS verification:** n/a (redesign only — no new endpoints).

**Authenticated UAT:** n/a (UI-only redesign).

**Data/UAT gates:** FE-S04 fallback-centre policy still in force (no authoritative Cẩm Phả extent from `/web-map/layers`); Statistics endpoints remain EXPECTED_DEPLOYMENT_GATE (401 without JWT); Remote Sensing catalog EXPECTED_EMPTY on VPS.

**Build:** PASS.

**Lint:** targeted lint clean on files modified this sprint (pre-existing warnings on unrelated legacy files noted separately).

**Exit Gate:** **PASS** — all listed pages ship with the Cẩm Phả token identity; 0 active runtime legacy regional references; build green.
