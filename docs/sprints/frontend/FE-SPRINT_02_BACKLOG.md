# FE-Sprint 02 — Foundation + Authentication

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Establish the Cẩm Phả-aligned client foundation (API client, envelope, refresh, presign, role mapping, error handling) and complete the auth flow for all server-defined roles.

## Commitment / Stories (~21 SP)

| ID | Story | SP |
|---|---|---|
| US-FE02.1 | Rewrite `apiClient/fetcher.js` for Cẩm Phả response envelope + list pagination shape | 5 |
| US-FE02.2 | Refresh-token rotation flow (no auto-retry on auth mutations) | 3 |
| US-FE02.3 | Presigned upload helper: `presignedUpload(file, uploadContext)`. `uploadContext` MUST contain only fields allowed by the Postman-confirmed Cẩm Phả storage contract. Do not send `ownerId`/`userId` unless the verified API contract explicitly requires it. Ownership must not be inferred or overridden by frontend code. | 3 |
| US-FE02.4 | Auth store role mapping — server-defined role list from FE-S01 (no hardcoded count) | 3 |
| US-FE02.5 | Route guards for role-based access | 3 |
| US-FE02.6 | Wire login/refresh/logout/profile pages to `/api/v1/auth/*`; handle 429 with `Retry-After` explicit surfacing | 3 |
| US-FE02.7 | New `.env` for Cẩm Phả (base URL); drop legacy external-API keys per §10.1 | 1 |

## Definition of Ready
- FE-S01 Exit Gate satisfied.
- Auth + role list + response envelope contract are VERIFIED per §5 (module-specific gate for this sprint).
- Cẩm Phả server reachable in dev.

## Tasks
- [x] Update `fetcher.js` to normalize `{ message, status, data, metadata? }` envelope for success + `{ success:false, message, errors[] }` for error.
- [x] Implement single-flight refresh: on 401 exchange refresh once, replay original request; if refresh fails, dispatch logout.
- [x] Implement 429 handling: read `Retry-After`, surface an error object the UI can render. **Do not** auto-retry auth mutations (login/refresh/logout/password-*).
- [ ] Add `presignedUpload(file, uploadContext)` helper: POST presign → PUT with progress → POST commit → return persisted object metadata. `uploadContext` only carries fields required by the Postman-confirmed contract; do not send `ownerId`/`userId` from the client.
- [x] Rewrite `useAuthStore.jsx` to consume the confirmed role list from FE-S01.
- [x] Add `<RequireRole>` guard component and route wiring.
- [x] Wire Login/Signup/Logout/Profile/ChangePassword pages to `/api/v1/auth/*` per Postman.
- [x] Update `.env` template (drop `VITE_OPENWEATHER_*`, `VITE_WEATHERAPI_*`, `VITE_TOMTOM_*`, `VITE_WINDY_*`).

## Acceptance Criteria (BDD)

**US-FE02.1**
```
Given any GET/POST/PATCH/DELETE against /api/v1/*
When the response arrives
Then the client extracts data.items (list) or data (single) transparently
And metadata { page, limit, total } is exposed on list responses
And error responses surface { message, errors[] } to the caller
```

**US-FE02.2 + US-FE02.6**
```
Given an expired access token
When the client hits a 401 on a non-auth endpoint
Then a single refresh call is made
And the original request is replayed with the new token
And a subsequent 401 (or refresh failure) triggers logout

Given a login/refresh/logout request returns 429
When the response contains Retry-After
Then the client surfaces a "wait N seconds" error to the UI
And no automatic retry is issued for the auth mutation
And the user is shown clear feedback rather than a silent hang
```

**US-FE02.4**
```
Given the auth store initializes
When it reads the role list
Then the list matches the FE-S01 confirmed server RBAC list
And no code path hardcodes a numeric role count
```

## Dependencies
FE-S01.

## Risks
- Envelope drift for edge endpoints (e.g. streaming/download) → tag exceptions in the fetcher.
- Refresh single-flight race conditions → covered by test.

## Backend Blockers
None (auth VERIFIED in FE-S01).

## Expected Acceptance Evidence
- Contract test hitting each `/api/v1/auth/*` endpoint per server-defined role.
- DevTools trace showing single refresh + replay on 401.
- Screenshot of clear 429 surfacing.

## Exit Gate
apiClient contract tests pass for all core auth flows. Auth flow works for **all roles defined by the current Cẩm Phả RBAC seed/migrations** (server-defined, not a fixed count).

## FE-S02 Execution Evidence (2026-08-10)

### Completed implementation

- [x] US-FE02.1 - Unified the client request path around the Cẩm Phả success/error envelopes. List responses expose `items`, `metadata`, and `pagination` while preserving the envelope's `data` field for current callers.
- [x] US-FE02.2 - Added single-flight refresh-token rotation. One `POST /auth/refresh` is shared by concurrent 401s; a failed refresh clears local tokens and dispatches the login-flow session-expiry event.
- [x] US-FE02.3 - Added `presignedUpload(file, uploadContext)`: presign, XMLHttpRequest PUT with progress events, and commit. Context is reject-listed to exactly `category`, `originalName`, `contentType`, and `expireSeconds`; no owner/user identifier can be sent.
- [x] US-FE02.4 - Added the verified server role-code set (`system_admin`, `ubnd_tp`, `so_tnmt`, `so_xd`, `citizen`) and code-based role helpers without a numeric role-count assumption.
- [x] US-FE02.5 - Added `RequireAuth` and `RequireRole`; current authenticated profile and My Feedback routes use the verified role-code list. These are UX guards only; VPS 403 remains authoritative.
- [x] US-FE02.6 - Login, signup, logout, profile PATCH, and change-password requests now use the documented `/api/v1/auth/*` paths, fields, and methods. API errors include `errors[]` and parsed `Retry-After`; auth mutations have retry explicitly disabled.
- [x] US-FE02.7 - Replaced the legacy client API/WS host with the approved VPS URL from existing `admin/.env` and FE-S01 evidence. Removed the legacy weather, TomTom, and Windy runtime keys from `client/.env`.

### Acceptance evidence

| Check | Evidence | Result |
| --- | --- | --- |
| Approved target | Existing `admin/.env` and `docs/CAMPHA_BACKEND_STATUS.md` identify `http://103.163.119.247:3006/api/v1`; the old client host was not used. | PASS |
| Build | `npm run build` in `client/` completed successfully on 2026-08-10. | PASS |
| Changed-file lint | ESLint passed for all FE-S02 touched client files. | PASS |
| Full lint | `npm run lint` reports 61 existing errors in unrelated Map/UI/legacy files; no FE-S02 touched file is reported. | BLOCKED BY BASELINE |
| VPS smoke | `GET /health` returned 200; unauthenticated `GET /api/v1/auth/me` returned 401. | PASS |
| Login, me, refresh, logout, role, 429, upload | No approved VPS/UAT credentials or safe upload fixture were available; mutation/auth tests were not sent to the VPS. | BLOCKED |

### VPS/API discrepancies and follow-up

1. **Endpoint:** VPS authentication mutations and authenticated profile/storage routes.  
   **Postman contract:** public path/method/request definitions are present, but response examples are not saved.  
   **Observed VPS response:** not executed because approved UAT credentials and an upload fixture are unavailable.  
   **Impact:** live token payload fields, role behavior, retry-after UI, and object-storage CORS cannot be proven in this sprint.  
   **Frontend handling:** follows the documented envelope, derives cookie expiry from JWT `exp` if duration fields are absent, and does not invent endpoint models.  
   **Backend follow-up:** provide approved non-production credentials for each current role and a disposable storage fixture/CORS test path.

2. **Endpoint:** API base discovery.  
   **Postman contract:** collection base URL is localhost.  
   **Observed VPS response:** FE-S01 safely verified the VPS base configured in `admin/.env`; client legacy config was a different regional host.  
   **Impact:** client must use the approved VPS configuration rather than the collection's local default.  
   **Frontend handling:** `client/.env` now uses the approved VPS base.  
   **Backend follow-up:** publish an official non-production/Postman environment for frontend integration.

### Exit Gate

**PARTIALLY PASSED.** Client foundation code, targeted lint, build, and safe unauthenticated VPS checks pass. The contract-test portion of the exit gate remains blocked by missing approved VPS/UAT credentials and a safe storage fixture. No FE-S03 work was started.

## Explicitly Not Included
`theme.css` rewrite · Home redesign · Map layout redesign · any UI reflow.
