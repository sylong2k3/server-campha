# FE-Sprint 03 — CMS Migration

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Client CMS surface (News, Comments, Documents, PDF Maps) fully consumes `/api/v1/cms/*` — no legacy CMS calls remain.

## Commitment / Stories (~13 SP)

| ID | Story | SP |
|---|---|---|
| US-FE03.1 | News list + detail via `/api/v1/cms/news` with ETag/304 on detail | 5 |
| US-FE03.2 | News comments (list + create) via `/api/v1/cms/news-comments` | 2 |
| US-FE03.3 | Documents list + detail with private-visibility handling + presigned download URL | 3 |
| US-FE03.4 | PDF Maps (renamed from MapImage) list + detail | 3 |

## Definition of Ready
- FE-S02 Exit Gate satisfied (apiClient + auth ready).
- **Module gate:** CMS (news, comments, documents, pdf-maps) VERIFIED per §5 in FE-S01.

## Tasks
- [ ] Add `newsService.js` conforming to Postman contract (query: page, limit, search, sort).
- [ ] Add If-None-Match / ETag support on detail (fetcher-level or per-service).
- [ ] Add `commentsService.js` create/list.
- [ ] Rename `imageMap.js` → `pdfMapsService.js`; update all imports.
- [ ] Add `documentsService.js` with visibility indicator and presigned download resolver.
- [ ] Update `NewsPage`, `NewsDetailPage`, `DocumentsPage`, `DocumentDetailPage`, `MapImagePage`/`MapImageDetailPage` (→ PdfMaps).
- [ ] Remove copy strings tied to Đắk Lắk (`Header.jsx`, `Policy.jsx`, page subtitles) — mark for FE-S09 restyle if visual copy change.

## Acceptance Criteria (BDD)

**US-FE03.1**
```
Given a user opens News list
When the page loads
Then GET /api/v1/cms/news is called with { page, limit, search?, sortBy?, sortOrder? } per contract
And data.items renders with metadata pagination
And no request to legacy /news endpoint is emitted
And loading/empty/error states are handled

Given a user opens News detail
When the page loads
Then GET /api/v1/cms/news/:idOrSlug is called
And a subsequent reload sends If-None-Match matching the stored ETag
And a 304 response reuses the cached body
```

**US-FE03.3**
```
Given a user requests a private document
When the document requires signed access
Then the client fetches a short-lived presigned URL and initiates the download
And the URL is not leaked to logs
```

## Dependencies
FE-S02.

## Risks
- ETag support on all detail endpoints may not be uniform → tag per-endpoint in fetcher.

## Backend Blockers
None.

## Expected Acceptance Evidence
- Network trace showing no calls to `/news`, `/news-comments`, `/documents`, `/map-images` legacy paths.
- 304 hit demonstrated on News detail reload.

## Exit Gate
All CMS pages in client render entirely from `/api/v1/cms/*`.

## Explicitly Not Included
CMS visual redesign (deferred to FE-S09).

## FE-S03 Execution Evidence — 2026-08-10

This execution evidence supersedes stale route/query wording in the original
task and acceptance-criteria sections above. The public CMS Postman collection
and the reachable approved VPS were used as the implementation source of truth.

### Completed client work

- [x] Replaced the legacy News service with /cms/news list and numeric-detail
  calls. Public list requests send only the confirmed page, limit, and q
  parameters.
- [x] Added per-news-detail in-memory ETag caching. A returned ETag is sent as
  If-None-Match on a subsequent request; a supported 304 response reuses the
  cached response body.
- [x] Replaced legacy comment calls with GET and authenticated POST
  /cms/news/:newsId/comments. The creation payload is { content }.
- [x] Replaced imageMap.js with pdfMapsService.js, using /cms/pdf-maps.
  The existing /map-images browser routes remain as compatibility aliases.
- [x] Migrated Documents to /cms/documents and PDF Maps to /cms/pdf-maps.
  Download buttons first request the documented authenticated
  download-url?expireSeconds=300 endpoint, then open the returned short-lived
  URL without logging, persisting, or constructing an object-storage URL.
- [x] Updated all News, Documents, and PDF Map list/detail pages to consume
  data.items and metadata and the live field names. Unsupported legacy
  thumbnail, image URL, slug, reply, edit, delete, preview, and sorting models
  were removed rather than inferred.
- [x] Changed the CMS PDF Map page subtitle/title from the incorrect Dak Lak
  copy to Cam Pha copy. Broader Header/Policy visual-copy work remains outside
  this migration-only sprint.

### Public VPS contract observations

Approved base: http://103.163.119.247:3006/api/v1

| Check | Result |
| --- | --- |
| GET /cms/news?page=1&limit=5 | 200; envelope has data.items, metadata; first ID was 8. |
| GET /cms/news/8 | 200; detail fields include id, title, summary, content, visibility, status, and timestamps. |
| GET /cms/news/8/comments?page=1&limit=5 | 200; comment fields include id, news_id, user_id, full_name, content, status, and moderation/timestamp fields. |
| GET /cms/documents?page=1&limit=5 and /cms/documents/2 | Both 200; document list/detail are public. |
| GET /cms/pdf-maps?page=1&limit=5 and /cms/pdf-maps/5 | Both 200; PDF Map list/detail are public. |
| Unauthenticated document/PDF download-url requests | Both 401; no credentials, mutation, signed URL, or response body was used or retained. |

### ETag result

ETAG_SUPPORTED: the live News detail response returned an ETag header.
CONDITIONAL_304_NOT_OBSERVED: a safe explicit curl request with that exact
If-None-Match value returned 200, not 304. The client nevertheless handles
304 correctly when the VPS begins honoring the validator. This observation is
not a build or migration failure.

### Environment/deployment gate

Vite consumes client/.env, which now points to the approved HTTP VPS API
base. A frontend deployed over HTTPS cannot call this HTTP API without browser
mixed-content blocking. Deployment must provide HTTPS for the API (or an HTTPS
same-origin reverse proxy) before serving the frontend over HTTPS; this sprint
does not change infrastructure.

### Verification

- [x] npm run build in client/ passed.
- [x] Targeted ESLint over every FE-S03 changed source file passed with zero
  findings.
- [x] Full npm run lint was run: it remains failing with 48 pre-existing
  project-wide errors and 19 warnings in unrelated Map, UI, statistics, helper,
  and Vite files. No FE-S03 changed file is among those findings.

### Remaining credential-dependent verification

- Authenticated comment creation requires an approved test account.
- Authenticated document and PDF Map download requires an approved account with
  the corresponding download permission.
- No fake token, login, write request, or presigned URL was used.

### Gate decision

- FE-S03 Exit Gate: PARTIALLY PASSED — all scoped client migration code,
  public VPS reads, build, and targeted lint pass; authenticated write/download
  UAT remains pending approved credentials.
- FE-S04 Readiness: CONDITIONALLY_UNBLOCKED for the FE-S03 dependency only;
  its independent WebGIS and data-runtime gates remain out of scope.
