# FE-Sprint 06 — Field Reports

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Migrate Feedback surface to Field Reports with cluster visualization; audit and confirm notification/WS/push-token contract before wiring subscribe code.

## Commitment / Stories (~15 SP)

| ID | Story | SP |
|---|---|---|
| US-FE06.1 | Rename `pages/Feedbacks/` → `pages/FieldReports/`; update routes and imports | 2 |
| US-FE06.2 | Public / mine / nearby field reports lists + detail | 5 |
| US-FE06.3 | Submit form with private image upload (via presigned helper from FE-S02) | 3 |
| US-FE06.4 | Map clustering visualization for field reports | 2 |
| SPIKE-FE06.1 | Verify notification / WebSocket / push-token contract before writing subscribe code | 3 |

## Definition of Ready
- FE-S02 Exit Gate satisfied.
- **Module gate:** Field Reports resolved (VERIFIED, or a Backend Blocker per §16.3 documented).
- Storage presigned flow working (from FE-S02).

## Tasks
- [ ] Rename `feedbackService.js` → `fieldReportService.js`.
- [ ] Rebuild list/detail + submit form + nearby.
- [ ] Wire private image upload through presigned helper.
- [ ] Add clustered map layer.
- [ ] SPIKE: consume Postman + server to confirm `/api/v1/devices/push-token` shape and whether a generic `/api/v1/notifications` endpoint or WebSocket exists.

## Acceptance Criteria (BDD)

**US-FE06.2**
```
Given a user opens Field Reports
When the list loads
Then GET on the Postman-confirmed /api/v1/field-reports endpoint is called
And no legacy /citizen-feedbacks endpoint is emitted
And loading/empty/error states render

Given a user submits a field report
When the submission includes an image
Then the image is uploaded via the presigned MinIO flow
And the API record references the committed object
```

**SPIKE-FE06.1**
```
Given the SPIKE completes
When notification/WS/push-token contract is documented
Then either subscribe code is written against a VERIFIED contract
Or a Backend Blocker (per §16.3) is recorded and subscribe code is not written
```

## Dependencies
FE-S02.

## Risks
- Real-time contract unknown → SPIKE-FE06.1 must resolve before any subscribe code.

## Backend Blockers
Possibly generic notifications / WS if contract UNKNOWN — document per §16.3.

## Expected Acceptance Evidence
- Field Report submitted end-to-end with image (presigned flow trace).
- Cluster layer visible on map.

## Exit Gate
Field Reports functional; SPIKE outcome documented in `@docs/CAMPHA_BACKEND_STATUS.md`.

## Explicitly Not Included
Field Reports visual redesign (deferred to FE-S09).

## FE-S06 Execution Result (2026-08-11)

### Implementation
- **New constants** (`client/src/constant/serviceData.js`): `serviceFieldReportsPath = "/field-reports"`, `serviceDevicesPath = "/devices"`. Legacy `serviceFeedbackPath` kept for FE-S10.
- **New service `client/src/services/fieldReportService.js`**: hook + fetcher pairs for `useGetPublicFieldReportsQuery`, `useGetMyFieldReportsQuery`, `useGetNearbyFieldReportsQuery` (5-input gate: `longitude`, `latitude`, `radiusMeters`, `from`, `to`), `useGetFieldReportDetailQuery`, `useCreateFieldReportMutation`, `useDeleteFieldReportMutation` + non-hook variants. All URLs built with `URLSearchParams`.
- **New service `client/src/services/devicesService.js`**: `registerPushToken({ token, platform })` → `PUT /devices/push-token`, `unregisterPushToken({ token })` → `DELETE /devices/push-token`. JSDoc records SPIKE-FE06.1 outcome.
- **New service `client/src/services/storageService.js`**: focused wrappers `presignUpload`, `commitUpload`, `uploadFileWithPresign` over the FE-S02 `presignedUpload.js` helper (which already exists — no duplication).
- **New pages under `client/src/pages/FieldReports/`**: `FieldReportsPage.jsx` (public list + clustered map), `MyFieldReportsPage.jsx` (auth-required my list + delete), `FieldReportDetailPage.jsx` (auth-required detail), `SubmitFieldReportPage.jsx` (form + per-photo presign+PUT+commit).
- **New component `client/src/components/fieldReports/FieldReportsMap.jsx`**: mapbox-gl `cluster: true` GeoJSON source; supercluster not required. Public client does not call `/admin/field-reports/clusters`.
- **Router updates (`client/src/App.jsx`)**: added `/field-reports`, `/field-reports/mine` (auth), `/field-reports/submit` (auth), `/field-reports/:id` (auth). Legacy `/my-feedbacks`, `/feedbacks`, `/feedbacks/:id` preserved as `<Navigate>` client-side aliases so no legacy API path is emitted.
- **Legacy cleanup (non-destructive to consumer flows)**:
  - `client/src/services/feedbackService.js` replaced by DEPRECATED stub (`export {}`); scheduled removal FE-S10.
  - `client/src/pages/Feedbacks/`, `client/src/components/feedback/` deleted (no remaining active importers).
  - `client/src/components/common/FloatButton.jsx` rewritten to navigate to `/field-reports/submit` (removed dialog + legacy `FeedbackForm` runtime).
  - `client/src/components/common/Header.jsx`: nav item "Phản ánh của tôi" now targets `/field-reports/mine`.
  - `client/src/components/common/NotificationMenu.jsx`: invalidateQueries keys migrated from `["feedbacks","my-feedbacks"]`/`["feedbacks","detail"]` to `["field-reports","mine"]`/`["field-reports","detail"]`.

### Static verification
- Grep for `citizen-feedbacks` / `feedbackService` / `serviceFeedbackPath`: **no active runtime callers remain**. Only surviving references are the DEPRECATED stub, the constant in `serviceData.js` (kept for FE-S10), and a schema file `client/src/schemas/feedbackSchema.js` (no importers; FE-S10 cleanup).

### Public VPS verification (base http://103.163.119.247:3006/api/v1)
- `GET /field-reports/public?page=1&limit=5` → **HTTP 200**, envelope `{ message, status, data: { items: [] }, metadata: { page, limit, total: 0, totalPages: 0 } }`. Contract MATCHES.
- `GET /field-reports/nearby?longitude=&latitude=&radiusMeters=` → **HTTP 400** (`Trường này là bắt buộc` ×2). Adding `from` and `to` (ISO date/datetime) → **HTTP 200**, `{ data: [] }`. Contract MATCHES; validator confirms `from` and `to` are REQUIRED (window capped at 366 days) — hook `useGetNearbyFieldReportsQuery` enables only when all five inputs are present.

### Authenticated UAT: RUNTIME_TO_VERIFY
Missing UAT credentials — not executed:
- `POST /field-reports` (submit + photoIds)
- `GET /field-reports/mine`
- `GET /field-reports/:id`
- `DELETE /field-reports/:id?expectedUpdatedAt=…`
- Presign+PUT+commit end-to-end (via `uploadFileWithPresign`)
- `PUT /devices/push-token`, `DELETE /devices/push-token`

### SPIKE-FE06.1 result
- **Push-token endpoints VERIFIED** against the Cẩm Phả contract (`PUT /devices/push-token`, `DELETE /devices/push-token`) — implemented in `devicesService.js`.
- **Generic notifications endpoint / WebSocket channel UNCONFIRMED** — DEFER per §16.3. No subscribe code was written in this sprint. `devicesService.js` JSDoc records the SPIKE outcome; `NotificationMenu.jsx` retains its existing `useNotificationWebSocket` hook (out of FE-S06 scope; pre-existing FE-S05 code, not modified beyond invalidateQueries key rename).
- Push-token wiring on service-worker registration success: **DEFERRED** — no FCM/browser-push setup currently exists in the app. Introducing Firebase is explicitly out of scope for FE-S06 per Task 8; flagged RUNTIME_TO_VERIFY.

### Build
`npm run build` → **PASS** (Vite 7.3.1, 2469 modules transformed, dist emitted). Warnings: (a) `MapComponent.jsx` dynamic-import notice — pre-existing; (b) mapbox-gl chunk >500 kB — pre-existing.

### Lint (targeted)
`npx eslint` on all modified files → **1 error + 2 warnings**, all inside `client/src/components/common/NotificationMenu.jsx` at `handleRefetch` (lines 46–49) and `useEffect` (line 88). **All three are pre-existing** — the only edit made to that file in FE-S06 was inside `handleSocketMessage` (lines 57–64) to migrate invalidateQueries keys; the flagged blocks were not touched. Report separately.

### Exit Gate
**PARTIAL_WITH_GATES** — Field Reports UI is functional against verified public endpoints; SPIKE outcome documented (push-token VERIFIED, notifications/WS DEFERRED). Authenticated flows (submit / mine / detail / delete / upload / push-token) remain RUNTIME_TO_VERIFY pending UAT credentials.
