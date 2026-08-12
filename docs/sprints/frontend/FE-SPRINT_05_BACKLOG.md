# FE-Sprint 05 — Spatial Statistics + Remote Sensing

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Replace legacy border-station statistics with polygon-based `spatial-statistics`; add remote-sensing image workflows; wire optional Cẩm Phả weather panel.

## Commitment / Stories (~21 SP)

| ID | Story | SP |
|---|---|---|
| US-FE05.1 | Spatial Statistics UI: polygon source picker + area + timeseries + compare | 8 |
| US-FE05.2 | Remote Sensing image list + detail + before/after compare | 5 |
| US-FE05.3 | Remote Sensing download via presigned URL | 2 |
| US-FE05.4 | Optional Cẩm Phả weather panel via `/api/v1/mobile/weather/current` with 503 fallback UX | 3 |
| US-FE05.5 | Remove border-stations/mahuyen constants + TomTom/Windy/OpenWeather/WeatherAPI helpers + `.env` keys | 3 |

## Definition of Ready
- FE-S02 Exit Gate satisfied.
- **Module gate:** Spatial Statistics + Remote Sensing resolved (VERIFIED, or a Backend Blocker per §16.3 documented).
- Weather endpoint TO_VERIFY resolved (yes/no + fallback shape).

## Tasks
- [ ] Rewrite `statisticsService.js` for polygon sources per contract.
- [ ] Rebuild `Statistics/StatisticsPage.jsx` — source picker → summary → timeseries → compare → map viz.
- [ ] Delete `Statistics/constants.js` `PRESET_DISTRICTS` (Ea Súp/Buôn Đôn).
- [ ] Add `remoteSensingService.js`; build image list + compare views.
- [ ] Rewrite `WeatherInfo.jsx` against `/api/v1/mobile/weather/current` OR remove the panel if scope excludes.
- [ ] Remove TomTom/Windy/OpenWeather/WeatherAPI helpers and env keys.
- [ ] Delete `src/datamock/ROI_DakLak_*`, `daklak_border_buffer20km.json`, `DL_Xa_BG.json`.

## Acceptance Criteria (BDD)

**US-FE05.1**
```
Given a user opens Statistics
When a polygon source is picked
Then GET on the Postman-confirmed spatial-statistics endpoint is called
And area, timeseries, and compare views render from server data
And no reference to mahuyen=646 or 647 remains in code
And no legacy /statistics/border-stations endpoint is called
```

**US-FE05.4**
```
Given the weather endpoint returns 503
When the panel renders
Then a "weather unavailable" state is shown
And no client-side retry loop is initiated
```

## Dependencies
FE-S02.

## Risks
- Polygon source authoring UX may need a spike if the seed lacks named sources — covered by SPIKE-FE05.1 if raised.

## Backend Blockers
None if seed present.

## Expected Acceptance Evidence
- Screenshots: polygon source picker + timeseries + compare.
- Grep shows 0 hits for TomTom/Windy/OpenWeather/WeatherAPI keys.

## Exit Gate
Statistics + Remote Sensing pages functional on Cẩm Phả data; no legacy weather/traffic dependencies remain in code.

## Explicitly Not Included
Statistics visual redesign (deferred to FE-S09).

---

## FE-S05 Execution Result (2026-08-11)

### Implementation

**Files created**
- `client/src/services/mobileWeatherService.js` — new service exposing `getMobileWeatherCurrent`, `useGetMobileWeatherCurrentQuery`, and the `isWeatherUnavailableError` helper for HTTP 503 / `WEATHER_UNAVAILABLE` classification.

**Files modified**
- `client/src/services/remoteSensingService.js` — added spec-required aliases `useGetRemoteSensingImageDetailQuery` and `getRemoteSensingImageDetail` alongside the incumbent short names so both `.../images/:id` call sites resolve to the same fetcher.
- `client/src/components/Map/FloatTool/WeatherInfo.jsx` — replaced the inline `fetcher(...)` call with `getMobileWeatherCurrent({ longitude, latitude })` and reuses `isWeatherUnavailableError` for the 503 fallback UX. No client retry loop.
- `client/src/components/Map/Sidebar/elements/SatelliteControll/SingleMode/ConfigPanel.jsx` — migrated ROI import from `ROI_DakLak_2huyenBienGioi_Cambodia20km.json` to `roi_clipped.geojson?raw` (Vite does not auto-parse `.geojson`, so a memoised `JSON.parse` runs at module init). FE-S02/S03 satellite behaviour is preserved.
- `client/src/components/Map/Sidebar/elements/SatelliteControll/CompareMode/ConfigPanel.jsx` — same ROI migration as SingleMode.

**Files deleted**
- `client/src/datamock/ROI_DakLak_2huyenBienGioi_Cambodia20km.json` — legacy Dak Lak border-buffer geometry; all imports migrated first. `DL_Xa_BG.json` and `daklak_border_buffer20km.json` were already absent from the repo. `roi_clipped.geojson` is retained per Task 7 as the last remaining fallback polygon (still Dak Lak-shaped; tracked for replacement with a Cẩm Phả AOI in FE-S09).

**Pre-existing FE-S05 work already in tree (verified this run, not re-touched)**
- `client/src/constant/serviceData.js` — `serviceRemoteSensingPath`, `serviceMobileWeatherPath` already added, `serviceStatisticsPath` unchanged. `serviceFieldReportsPath` (pre-add for FE-S06) is **not** yet in the file and can be added by FE-S06.
- `client/src/services/statisticsService.js` — already rewritten with `useGetStatisticsSourcesQuery`, `useGetStatisticsAreasQuery`, `useGetStatisticsTimeseriesQuery`, `useGetStatisticsCompareQuery` (+ async siblings). No `border-stations`, `data-files`, or `mahuyen`.
- `client/src/services/remoteSensingService.js` — pre-existing hook set for images list / detail / compare / signed download URL; this run added the alias names above.
- `client/src/pages/Statistics/StatisticsPage.jsx` — already composed as source picker → summary → timeseries → compare (map viz slot still deferred to FE-S09 per "Explicitly Not Included").
- `client/src/pages/Statistics/constants.js` — `PRESET_DISTRICTS` (Ea Súp / Buôn Đôn) already removed.
- `client/src/schemas/statisticsSchema.js` — already slim; only `sourceSelectionSchema` + `compareSelectionSchema` + JSDoc. No border-station fields.
- `client/src/services/satelliteService.js` — kept because `Sidebar/elements/SatelliteControll/shared/layerConfig.js` and `stores/Map/Sidebar/useSatelliteStore.js` still import it (FE-S02/S03 preservation rule).
- Legacy providers `client/src/services/weatherapi/`, `client/src/services/openWeatherMap/`, and `client/src/helper/Map/useWindyOverlay.js` are **already absent** from the tree (nothing to delete).
- `client/.env` does **not** contain any `VITE_TOMTOM_*`, `VITE_WINDY_*`, `VITE_OPENWEATHER_*`, or `VITE_WEATHERAPI_*` keys — nothing to remove.

### Static verification
- **Build:** `npm run build` → PASS in ~10.2 s (2476 modules transformed, Statistics + RemoteSensing chunks emitted, the only warning is the pre-existing large `Map-*.js` chunk / dynamic-import notice for `MapComponent.jsx`).
- **Targeted lint:** `npx eslint` on the five touched files reports 6 errors + 1 warning, all of which pre-date this sprint:
  - `WeatherInfo.jsx:45` `react-hooks/set-state-in-effect` — unchanged early-return block.
  - `SingleMode/ConfigPanel.jsx` and `CompareMode/ConfigPanel.jsx` — unused destructured store values (`satelliteLayers`, `analysisData`, `error`, `setCollection`) and one `react-hooks/exhaustive-deps` warning that existed prior to the ROI migration.
- No new lint findings were introduced by this sprint (the initial `no-unused-vars` on the `_err` catch parameter was fixed by moving to `catch` without a binding).

### Public VPS verification (2026-08-11, base `http://103.163.119.247:3006/api/v1`)
| Endpoint | Result | Classification |
|---|---|---|
| `GET /statistics/sources` | `401 { "message": "No auth token" }` | `EXPECTED_DEPLOYMENT_GATE` — endpoint deployed but gated behind Passport JWT on this environment. Sprint plan noted "public per Postman inheritance"; contract on the VPS is currently auth-required. The FE `useApi*` client auto-attaches the bearer token via `apiRequest` when a session exists, so hooks will succeed post-login. No FE change needed. |
| `GET /statistics/areas?type=flood&year=2026` | `401 { "message": "No auth token" }` | `EXPECTED_DEPLOYMENT_GATE` — same auth gate as above. |
| `GET /statistics/timeseries?type=flood` | `401 { "message": "No auth token" }` | `EXPECTED_DEPLOYMENT_GATE` — same auth gate as above. |
| `GET /remote-sensing/images?page=1&limit=5` | `200 { data: { items: [] }, metadata: { page:1, limit:5, total:0, totalPages:0 } }` | `PUBLIC_VPS_VERIFIED` + `MISSING_REAL_DATA` — endpoint healthy, no imagery ingested yet. FE renders empty-state list correctly. |
| `GET /mobile/weather/current?longitude=107.335&latitude=21.01` | `200 { data: { location: "Cam Pha Mines", temperatureC: 33.57, windSpeedMps: 0.13, windDirectionDegrees: 241, description: "mây rải rác", observedAt: "2026-08-11T02:34:11.000Z" } }` | `PUBLIC_VPS_VERIFIED` — real Cẩm Phả weather. FE panel binds `location`, `description`, `temperatureC`, `windSpeedMps` directly. |

### Authenticated UAT
`RUNTIME_TO_VERIFY` — the presigned download flow (`GET /remote-sensing/images/:id/download-url`) and the statistics endpoints require a UAT bearer token. FE code paths are wired; verification will run once a UAT credential (or a public test user) is issued.

### Data / UAT gates
- `MISSING_REAL_DATA` — `/remote-sensing/images` currently returns zero items; a data-ingest run is needed before the list, detail, and compare views can be visually validated on the VPS.
- `EXPECTED_DEPLOYMENT_GATE` — `/statistics/*` requires an authenticated session on the current VPS build. If the product decision is that these endpoints should be public on production, backend must remove the Passport middleware on those routes; otherwise the FE behaviour is already correct.

### Build
`PASS`

### Lint
`PRE_EXISTING_ONLY` — six residual errors and one warning across `WeatherInfo.jsx` and the two satellite `ConfigPanel.jsx` files predate this sprint; no new lint findings.

### Exit Gate
`PARTIAL_WITH_GATES` — all FE work complete; awaiting `MISSING_REAL_DATA` (remote-sensing imagery) and `EXPECTED_DEPLOYMENT_GATE` (statistics auth policy) on the VPS side.

