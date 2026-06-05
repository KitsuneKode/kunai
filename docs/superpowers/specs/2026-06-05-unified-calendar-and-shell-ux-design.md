# Unified Calendar + Shell UX — Design

Status: draft for review
Date: 2026-06-05
Owner: calendar / schedule / shell

## Problem

The `/calendar` surface feels like 2–3 separate calendar implementations even though
a clean normalized model already exists upstream.

Root cause (verified in code):

1. **Lossy round-trip.** `CatalogScheduleService` produces a structured
   `CatalogScheduleItem` (kind, season, episode, `releaseAt`, `releasePrecision`,
   `status`, `source`). `apps/cli/src/app/calendar-results.ts` then **flattens it
   into display strings** on `SearchResult` — `metadataSource:
"AniList calendar · Today · airs today · timestamp"`, `displayGroup`,
   `displayBadge`, `displayReleaseStatus`.
2. **String re-parsing in the renderer.** `calendar-ui.tsx` / `calendar-view.ts`
   reconstruct meaning by parsing those strings:
   - content kind ← `metadataSource.includes("anilist")`
   - episode code ← regex `/(?:S\d+E\d+|E\d+)/` over body text
   - `providerConfirmed` ← scanning preview text for the literal `"provider confirmed"`
   - release state ← `releaseStatus` string + `previewGroup.includes("Today")`
3. **Mode dependency.** `loadCalendarResults` loads only
   `stateManager.getState().mode` (anime **or** series). The UI shows
   `All / Anime / TV / Movies / Tracked` tabs, but **Movies never load** (no movie
   source exists) and the non-active kind is absent, so tabs are partly cosmetic.
4. **Precision is dropped.** `releasePrecision` survives only inside a display
   string; the renderer can't honestly distinguish timestamp / date / unknown, so
   the "unknown date must not render as confirmed" rule is enforced indirectly.

## Goal

One content-kind–aware calendar with a single normalized item model that the
renderer consumes directly. No string re-parsing. Honest release semantics per kind
(anime episode, series season/episode, movie release date) with explicit precision
and an explicit reason an item is shown. Movies become real. Release-status
correctness and cache behavior are preserved.

## Non-goals

- No provider scraping changes. Providers expose playable facts only; catalog owns
  release dates.
- No shell-wide shortcut rewrite in this spec (calendar shortcuts only; the rest is
  captured in the follow-on UX audit deliverable).

## Architecture

### 1. `CalendarItem` — single source of truth

New domain model in `apps/cli/src/domain/calendar/calendar-item.ts`:

```ts
export type CalendarContentKind = "anime" | "series" | "movie";
export type CalendarReleasePrecision = "timestamp" | "date" | "unknown";
export type CalendarReleaseStatus = "released" | "upcoming" | "unknown";
export type CalendarReleaseReason =
  | "airing-today" // releases in the local current day
  | "upcoming-episode" // future-dated episode (anime/series)
  | "movie-release" // movie release date in window
  | "provider-confirmed" // a provider source is confirmed playable
  | "catalog-only"; // air date passed but no provider confirmation yet

export type CalendarItem = {
  readonly source: "anilist" | "tmdb";
  readonly titleId: string;
  readonly title: string;
  readonly contentKind: CalendarContentKind;
  readonly season?: number;
  readonly episode?: number;
  readonly episodeTitle?: string;
  readonly releaseAt: string | null;
  readonly releasePrecision: CalendarReleasePrecision;
  readonly releaseStatus: CalendarReleaseStatus; // clock-based, honest
  readonly providerConfirmed: boolean;
  readonly reason: CalendarReleaseReason;
  readonly dayKey: string | null; // YYYY-MM-DD local, for grouping
  readonly poster?: string | null;
  readonly popularity?: number;
  readonly averageScore?: number;
  readonly newEpisodeCount?: number;
  readonly inWatchlist?: boolean;
  readonly display: {
    readonly time: string | null; // "7:30 PM" or null
    readonly statusLabel: string; // "airs today" / "available" / "releases May 12"
    readonly episodeCode: string; // "S05E03" / "E29" / ""
    readonly badge?: string; // "3 new" / "E29" / "wl"
    readonly groupLabel: string; // "TUE 12 · Today"
  };
};
```

Pure builder `buildCalendarItem(scheduleItem, ctx)`:

```ts
type CalendarItemContext = {
  readonly nowMs: number;
  readonly inWatchlist?: boolean;
  readonly newEpisodeCount?: number;
  readonly providerConfirmed?: boolean;
};
```

The builder owns all derivation that today lives as scattered string formatting in
`calendar-results.ts` (day/group/time/episode-code/status copy) plus `reason`
classification. `releaseStatus` is computed by the existing
`classifyReleaseStatus` rule (date-only dated _today_ stays `upcoming`; only
strictly-past dates are `released`). `reason` rules:

- `releaseStatus === "unknown"` → reason stays `catalog-only`, `providerConfirmed`
  is forced `false` (never rendered as confirmed/available).
- `providerConfirmed` → `provider-confirmed`.
- `contentKind === "movie"` → `movie-release`.
- same local day as now → `airing-today`.
- future-dated episode → `upcoming-episode`.
- otherwise (past air date, no provider confirmation) → `catalog-only`.

### 2. Structural carry (no strings)

`SearchResult` gains one field `calendar?: CalendarItem` (structured, not strings).
`toCalendarBrowseOption` copies it to `BrowseShellOption.calendar`.
`isCalendarSearchResult` / `isCalendarBrowseOption` become `item.calendar != null`.
The existing `display*` string fields are retired from the calendar path (the
non-calendar browse path is untouched).

### 3. Renderer consumes the model

`calendar-ui.tsx` / `calendar-view.ts`:

- `deriveCalendarReleaseState`, `matchesCalendarType`, `episodeCode`,
  `hasProviderConfirmedAvailability` read `option.calendar.*`.
- The release-state machine (available / countdown / resolving / missed / upcoming /
  failed) stays, but is fed structured fields instead of parsed strings.
- The string-parsing helpers are deleted (single source of truth).

### 4. Unified, content-kind–aware loading

`loadCalendarResults` stops gating on `mode`. It loads anime + series + movies
concurrently and merges. Cache stays keyed per source/mode (preserved behavior);
unified = three cached reads merged, sorted by `releaseAt → popularity → title`.

New movie source in `CatalogScheduleService`: TMDB `/movie/upcoming` (proxy base
already used for TMDB), map `release_date` → `releasePrecision: "date"`,
`contentKind: "movie"`, no episodic progress. A `loadReleaseWindow` unified entry
(or a `kinds` argument) drives the three concurrent reads through the existing
cache/in-flight machinery.

## Visual & interaction language (Netflix-level clarity)

Grounded in the existing design authority — `.design/cli/kunai-sakura-canonical.html`,
`.design/cli/kunai-sakura-calendar-locked.html` — and the reference screenshot. The
look is **applying the existing system consistently**, not a new theme.

- **Tier-1 type tabs** use the existing `ClaudeTabRow` primitive: active tab =
  `accentFill` pill + bold (matches the highlighted tab in the reference). `TV`
  renders as `Series`.
- **Per-content-kind color** so a unified list reads at a glance: each row's kind
  glyph/accent uses `palette.typeAnime / typeSeries / typeMovie`. This is the
  payoff of content-kind awareness — anime, series, and movies are visually
  distinct in one list.
- **Segmented day/range strip** in the `segmented` helper style (the
  `All time · Last 7 days · Last 30 days` pattern): one active chip in `accent`,
  others `muted`; `←/→` move, `esc` clears to all days.
- **Accent discipline on values that matter**: the subtitle counts
  (`N airing today · N released · N new for you`) put the numbers in `accent`,
  labels in `muted` — like the reference's orange-on-value treatment.
- **Dim hint footer**, single consistent line:
  `← → day · ⇥ type · enter open · / commands` in `palette.dim`.
- Honest status copy per reason: `airs today` / `airs 7:30 PM` / `available` /
  `releases May 12` / `aired · resolving` / `release unknown`.

## Shortcuts (calendar surface only)

- `⇥ / ⇧⇥` cycle type tabs (already wired; verify ordering vs the global
  `tab → toggle-mode` fallthrough so calendar Tab always wins on this surface).
- `← / →` move day filter; `esc` layered step-back (clear day → list → query).
- `enter` opens the highlighted release.
- Footer hint text must match the actual bindings exactly (no stale copy).

## Error / empty / edge handling

- Unknown release date → `releaseStatus: "unknown"`, `providerConfirmed: false`,
  rendered as `release unknown` (never confirmed/available).
- Today date-only → `upcoming` until the day is strictly past.
- Catalog failure types (network / rate-limited / timeout / unavailable) keep the
  existing typed-error surface and `Refresh schedule` retry.
- Empty unified window → honest empty state per active tab/day.

## Testing (fixed clocks, pure)

On `buildCalendarItem` + unified loader + renderer derivations:

1. anime upcoming item and anime released item — kind/status/reason/copy.
2. TMDB series next episode — `S/E` code, date precision, status.
3. movie release item — `movie` kind, no episode, `releases <date>` copy.
4. today date-only stays `upcoming` (not released, not confirmed).
5. unknown release date does not render as confirmed (status unknown,
   `providerConfirmed` false).
6. mixed unified ordering — anime + series + movie sorted
   `releaseAt → popularity → title`.

Existing `calendar-results.test.ts` / `calendar-ui.test.ts` are migrated to assert
on the structured `calendar` item instead of `metadataSource` substrings. Snapshot
captures (`test/__captures__/calendar-*.txt`) are regenerated.

## Slices

1. `CalendarItem` model + `buildCalendarItem` + unit tests.
2. TMDB movie release source + unified `loadReleaseWindow` path + service tests.
3. `calendar-results.ts`: build `CalendarItem`s, attach structurally, unified load.
4. Renderer refactor (`calendar-ui` / `calendar-view`) to read the model; delete
   string parsing; per-kind color + segmented strip + accent subtitle + dim footer.
5. Migrate calendar tests to structured assertions; regenerate captures.
6. `bun run typecheck && bun run lint && bun run fmt && bun run --cwd apps/cli test`.

## Follow-on deliverables (separate spec/plan each)

- **Shell-wide UX/UI + shortcut audit** — prioritized findings doc covering Tab
  semantics across surfaces, bare-letter vs ctrl shortcuts, details discoverability
  (`i` / `Shift+Enter`), empty/error-state consistency, and accent discipline.
  Calendar findings are fixed here; the rest is documented for follow-up slices.
- **Branded README** — presentable, on-brand (fox / kitsune, `kitsunelabs.xyz`),
  the single unifying entry doc, via the `create-readme` skill.
