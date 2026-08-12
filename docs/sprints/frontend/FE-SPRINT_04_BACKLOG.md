# FE-Sprint 04 — WebGIS Core Migration

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Map surface consumes the Web Map catalog + proxy stack. Direct GeoServer calls removed. Cẩm Phả extent applied.

## Commitment / Stories (~21 SP)

| ID | Story | SP |
|---|---|---|
| US-FE04.1 | `webMapService.js` — catalog + legend + basemap + feature detail | 5 |
| US-FE04.2 | Search via `/api/v1/web-map/search` | 3 |
| US-FE04.3 | `mapProxyService.js` — WMS/WFS via `/api/v1/map-proxy/*` with ACL handling | 5 |
| US-FE04.4 | Apply Cẩm Phả official extent (or FE placeholder policy from FE-S01) | 3 |
| US-FE04.5 | Refactor `MapComponent` to load layers via new services (remove direct GeoServer refs) | 5 |

## Definition of Ready
- FE-S02 Exit Gate satisfied.
- **Module gate:** Web Map + Map Proxy VERIFIED per §5 in FE-S01.
- Cẩm Phả extent confirmed in FE-S01 (or FE placeholder policy in force).

## Tasks
- [ ] Split `mapLayersService.js` into `webMapService.js` (catalog/search/legend/basemap/feature-detail) + `mapProxyService.js` (WMS/WFS).
- [ ] Update `useMapStore.js` to consume the new services.
- [ ] Replace `defaultLatLong` in `constant/mapData.js` with Cẩm Phả center from FE-S01.
- [ ] Update `MapComponent` layer loader to use `mapProxyService`.
- [ ] Handle ACL rejection (403/404) gracefully in UI.

## Acceptance Criteria (BDD)

**US-FE04.1**
```
Given a user opens the Map
When the catalog loads
Then GET /api/v1/web-map/layers is called with the Postman-confirmed query
And only layers allowed by the API contract are rendered
And loading/empty/error states are handled
And no request is emitted to legacy /map-layers or /categories
And no direct GeoServer URL is used from the client
```

**US-FE04.3**
```
Given a layer requires WMS tiles
When a tile URL is constructed
Then it is anchored under /api/v1/map-proxy/* per contract
And a 403 (no export permission) surfaces as a disabled overlay, not a crash
```

## Dependencies
FE-S02, FE-S01.

## Risks
- Client historically expected direct GeoServer responses; proxy shape may differ → verify tile mime + params.

## Backend Blockers
None.

## Expected Acceptance Evidence
- Network trace: 0 requests to `daklakanbg.vn` or GeoServer hosts.
- Screenshot of a WMS tile served via `/api/v1/map-proxy/*`.

## Exit Gate
Map renders end-to-end with server-defined catalog + proxy. Cẩm Phả extent applied (or documented placeholder policy in force).

## Explicitly Not Included
Map layout redesign (deferred to FE-S08).

## FE-S04 Execution Result (2026-08-11)

### Implementation
Files created:
- `client/src/services/webMapService.js` (+193 lines) — hook + fetcher pairs for `/web-map/layers`, `/web-map/layers/:id/features/:featureId`, `/web-map/features/search`, `/web-map/layers/:id/legend`, `/web-map/basemaps`, `/web-map/terrain`, `/web-map/terrain/:id/url`.
- `client/src/services/mapProxyService.js` (+219 lines) — `buildWmsTileUrl`, `buildRasterTileTemplateUrl`, `fetchWmsTile`, `buildWfsUrl`, `fetchWfsFeatures` targeting `/maps/layers/:id/wms|wfs`. No `/api/v1/map-proxy/*` route invented.

Files modified:
- `client/src/constant/serviceData.js` — added `serviceWebMapPath = "/web-map"` and `serviceMapProxyPath = "/maps"`; legacy constants retained for backward compat (FE-S10 will remove).
- `client/src/constant/mapData.js` — annotated `defaultLatLong` as frontend fallback only; added `serverExtentFallback = null` sentinel.
- `client/src/stores/Map/useMapStore.js` — added `webMapLayers`, `webMapBasemaps`, `webMapTerrain`, `layerVisibility`, `serverExtent`, `mapReadyState` with corresponding setters. Legacy `category*` fields preserved.
- `client/src/services/mapLayersService.js` — added DEPRECATED banner (kept exports live during migration).
- `client/src/components/Map/Sidebar/elements/Datalyer/LayerSelection.jsx` — swapped `useGetAllCategoriesQuery` + `useGetMapLayersByCategoryQuery` for `useGetWebMapLayersQuery` + `fetchWfsFeatures`. Added ACL/error handling (401/403 → disabled with ShieldAlert tooltip; empty → "Trống"; catalog empty → friendly message). Adapter maps `{id, code, nameVi, geometryType, isPublic}` to the internal `useDataLayerStore` shape.
- `client/src/components/Map/Sidebar/elements/Datalyer/SearchEngine.jsx` — rewritten to `useSearchWebMapFeaturesQuery`. Highlights map from the returned `location: Point` directly (feature-detail requires auth and is deferred until UAT).
- `client/src/components/Map/Sidebar/elements/MonitoringAndAlerting/index.jsx` — replaced `getMapLayersByCategory` + `useGetAllCategoriesQuery` with WebMap catalog + WFS. Legacy classification flags (`is_monitoring_feature`, `is_landmark`, `is_border_guard_station`) are absent from the WebMap contract, so classification-derived arrays are empty and the feature renders empty-state cleanly (no crash). Product to define new classification in a later sprint.
- `client/src/components/Map/MapComponent.jsx` — added FE-S04 extent-policy effect: prefers `useMapStore.serverExtent` via `mapRef.fitBounds`; when absent logs `[FE-S04] No authoritative Cẩm Phả extent from server; using fallback centre.` No arbitrary Cẩm Phả coordinates fabricated.

### Static verification
Build (`npm run build`): **PASS** — `✓ built in 8.82s` (Vite reporter writes to stderr; PowerShell surfaces that as NativeCommandError but the build artifacts are produced).

Lint (targeted on touched files) — my changes: **CLEAN**. Pre-existing lint issues in `MapComponent.jsx` (ref-in-render at line 127, unused `reason` at 614) and `MonitoringAndAlerting/index.jsx` (unused `stats`, unused `e`, setState-in-effect at 394) were not introduced by this sprint and are left for the responsible sprint to address.

### Public VPS verification (curl against http://103.163.119.247:3006/api/v1)
- `GET /web-map/layers` → **PUBLIC_VPS_VERIFIED**. Returns `{message, status: 200, data: [{id, code, nameVi, category, geometryType, srid, geoserverLayer, styleName, minZoom, maxZoom, legend, isPublic}]}`. 1 layer present (`ranhgioi_campha`).
- `GET /web-map/basemaps` → **PUBLIC_VPS_VERIFIED**. 1 basemap (`osm_standard`).
- `GET /web-map/terrain` → **EXPECTED_EMPTY** (`data: []`). No terrain configured yet; classification per instruction 9.
- `GET /web-map/features/search?q=cam%20pha&limit=5` → **PUBLIC_VPS_VERIFIED**. 1 result with `{layerId, layerCode, layerName, feature_id, label, location: GeoJSON Point}`.

### Authenticated UAT
- `GET /web-map/layers/:id/features/:id` — **RUNTIME_TO_VERIFY** (no UAT credentials).
- `GET /web-map/terrain/:id/url` — **RUNTIME_TO_VERIFY**.
- `GET /maps/layers/:id/wms` — **RUNTIME_TO_VERIFY**.
- `GET /maps/layers/:id/wfs` — **RUNTIME_TO_VERIFY**.

### Data / UAT gates
- **DEPLOYMENT_GATE — WMS tile Authorization header via Mapbox raster source**: Mapbox GL cannot attach a `Bearer` header to tile requests emitted from a raster source URL template. If `/maps/layers/:id/wms` enforces auth, tiles will 401 unless the server issues signed-URL tiles or the client uses `transformRequest` (CORS-dependent). Documented in `mapProxyService.js` header. Requires server-side confirmation of the tile auth model before rollout.
- **Data gate — WebMap classification**: The Cẩm Phả contract does not expose `is_monitoring_feature`, `is_landmark`, `is_border_guard_station`. Monitoring/Alerting sidebar is intentionally empty; product must define new classification metadata (or a `category` string convention) before this feature is re-enabled.
- **Data gate — Authoritative extent**: `/web-map/layers` response carries no `extent`/`bbox`. `serverExtentFallback = null`. Map falls back to `defaultLatLong` and logs a warning per contract. Await extent metadata from server (FE-S08 or contract update).

### Build: **PASS**
### Lint: **PASS** on all files created/modified by this sprint (pre-existing issues unchanged and out of scope).
### Exit Gate: **PARTIAL_WITH_GATES** — All in-scope migration work is complete and green. Authenticated WMS/WFS/feature-detail paths remain RUNTIME_TO_VERIFY pending UAT credentials, and two data gates are open (Mapbox tile auth model, WebMap classification metadata).
