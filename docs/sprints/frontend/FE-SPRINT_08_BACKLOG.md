# FE-Sprint 08 — UI Foundation + Home + Map

> Shared conventions (confidence rule, discrepancy format, credential policy, grep patterns) live in [README.md](README.md). Section references (e.g. §5, §7, §16.3) refer to the master plan file.

## Sprint Goal
Introduce Cẩm Phả identity and layout evolution. Rewrite theme tokens. Redesign Home. Recompose Map. Establish AppShell.

## Commitment / Stories (~21 SP)

| ID | Story | SP |
|---|---|---|
| US-FE08.1 | Rewrite `client/src/theme/theme.css` with the token system (§13.2) and Cẩm Phả palette | 5 |
| US-FE08.2 | AppShell + navigation | 3 |
| US-FE08.3 | Typography + spacing scale + shadcn variants alignment | 3 |
| US-FE08.4 | Home page redesign (Cẩm Phả hero + module cards) | 5 |
| US-FE08.5 | Map page recomposition (Map \| Result panel on desktop; Map + Bottom Sheet on mobile) | 5 |

## Definition of Ready
- Client API migration (FE-S02→S06) complete and stable.
- Brand asset audit done (palette + typography direction).

## Tasks
- [ ] Design theme tokens; document in `@docs/CAMPHA_CLIENT_UI_REDESIGN.md`.
- [ ] Implement `theme.css` token rewrite.
- [ ] Add `AppShell` layout, sticky header, optional sidebar.
- [ ] Redesign Home hero + module grid.
- [ ] Recompose Map page as split layout with responsive drawer/bottom sheet.

## Acceptance Criteria (BDD)

**US-FE08.1**
```
Given the new theme.css is applied
When any page renders
Then colors come from the Cẩm Phả token palette
And legacy regional brand hex values are removed from application theme/page CSS
And new page-level colors use semantic theme tokens unless a documented exception exists for maps, charts, status colors, or third-party components
And Đắk Lắk's green primary is absent from computed styles
```

## Dependencies
FE-S02 through FE-S06 complete.

## Risks
- Component visual regressions across pages → snapshot the current UI first as reference.

## Backend Blockers
None.

## Expected Acceptance Evidence
- Before/after screenshots: Home + Map.
- Visual diff report acknowledging accepted changes.

## Exit Gate
Home + Map ship with Cẩm Phả identity; AppShell in use.

## Explicitly Not Included
Domain-page redesigns (Statistics, Field Reports, Remote Sensing) — deferred to FE-S09.

---

## FE-S08 Execution Result (2026-08-11)

### Implementation
- **Theme tokens (US-FE08.1, US-FE08.3):**
  - Rewrote `client/src/theme/theme.css` — token system in HSL components,
    Cẩm Phả palette (coastal deep blue `205 85% 32%`, industrial slate,
    warm signal orange), documented exceptions (satellite / chart / third-
    party) preserved at bottom.
  - Rewrote base tokens in `client/src/theme/index.css` — Cẩm Phả palette
    on `:root`, best-effort `.dark` overrides, typography stack switched to
    Inter/Manrope + system fallbacks, radius default lifted to `0.75rem`.
  - Legacy Đắk Lắk green hexes (`#4d8033`, `#3d6629`, `#2d4d1f`, `#1f3314`,
    `#e8f5e0`) removed from the active theme.
- **AppShell (US-FE08.2):**
  - Added `client/src/layout/AppShell.jsx` — sticky Cẩm Phả header via
    reused `Header.jsx`, `<Outlet />` content area, minimal footer with
    "Application UI, not official government branding" disclaimer.
  - Wired as a layout route in `client/src/App.jsx` — hosts `/` and
    `/home` (Home) without altering existing auth-guard routes.
- **Header re-brand:**
  - `client/src/components/common/Header.jsx` — brand mark switched from
    `ShieldUser` + "An Ninh Đắk Lắk" to `Waves` + "Cẩm Phả · WebGIS".
    Navigation catalogue extended to full FE-S08 spec (Home / Bản đồ /
    Tin tức / Tài liệu / Bản đồ PDF / Thống kê / Ảnh viễn thám / Phản ánh).
- **Home page (US-FE08.4):**
  - New `client/src/pages/Home/HomePage.jsx` — coastal-blue CSS hero
    (no fabricated logo art), module grid for all 7 modules, latest-news
    preview backed by `useGetAllNewsQuery({ limit: 3 })` with neutral
    "Chưa có tin tức" placeholder on empty response.
  - Route `/` now serves `HomePage` (previously `/` served `Map`). `/map`
    still serves the Map page unchanged.
- **Map recomposition (US-FE08.5):**
  - Rewrote `client/src/layout/MapLayout.jsx` — desktop layout preserved
    (rail + panel + map). Mobile no longer bails with `<UnSupported />`;
    instead a full-bleed map surfaces the same `SideBar` content inside a
    bottom-sheet triggered by a FAB. WebGIS API contract, extent policy,
    and Sidebar internals untouched.
- **Tailwind alignment:** Client is on Tailwind v4 (via `@tailwindcss/vite`);
  no `tailwind.config.js`. Palette wiring is done via the `@theme` block in
  `index.css` which already binds every base token — palette changes flow
  through shadcn primitives with zero component edits.
- **Design brief:** Created `docs/CAMPHA_CLIENT_UI_REDESIGN.md` with
  palette, typography, spacing, shadow/radius scales, documented
  exceptions, asset audit, and an explicit "Application UI, not official
  government branding" section.

### Static verification
- `npm run build` — **PASS** (`vite build`, 7.24 s, 0 errors). Existing
  chunk-size warning for `mapbox-gl` is pre-existing (unrelated to FE-S08).
- `npx eslint <modified files>` — **PASS** (0 errors, 0 warnings on JSX
  files; two "no matching config" info-warnings for `.css` files, which
  ESLint does not lint — expected).

### Public VPS verification
n/a — UI-only sprint, no new endpoints or API contract changes.

### Authenticated UAT
n/a — UI-only sprint. Auth guards on `/profile`, `/field-reports/mine`,
`/field-reports/submit`, `/field-reports/:id` preserved unchanged in
`App.jsx`.

### Data / UAT gates
- Cẩm Phả extent still unknown from server — MapComponent continues to
  use FE-S04 fallback centre (`defaultLatLong`, `defaultZoom`); no
  fabricated extent introduced by FE-S08.
- Neutral empty-state text on Home's news preview when CMS returns zero
  items (no fabricated news content).

### Build
**PASS.**

### Lint
Targeted lint on `src/theme/*.css`, `src/layout/AppShell.jsx`,
`src/layout/MapLayout.jsx`, `src/pages/Home/HomePage.jsx`, `src/App.jsx`,
`src/components/common/Header.jsx` — **0 errors, 0 warnings** on JSX;
`.css` files ignored by ESLint config (expected).

### Files changed
- Created:
  - `client/src/layout/AppShell.jsx`
  - `client/src/pages/Home/HomePage.jsx`
  - `docs/CAMPHA_CLIENT_UI_REDESIGN.md`
- Modified:
  - `client/src/theme/theme.css`
  - `client/src/theme/index.css`
  - `client/src/layout/MapLayout.jsx`
  - `client/src/components/common/Header.jsx`
  - `client/src/App.jsx`
- Deleted: none.

### Exit Gate
**PASS.** Home and Map ship with the Cẩm Phả identity; AppShell is
in use for the Home layout route; Đắk Lắk green primary is absent from
the active theme; the WebGIS API contract and auth guards are preserved.
Domain-page copy sweeps (Statistics / Auth / Policy) intentionally
deferred to FE-S09 per the story scope.
