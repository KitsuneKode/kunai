# Rich Details Sheet — design

Date: 2026-06-16
Status: Draft (spec)
Topic: Replace the thin, string-scraped browse "details" with an AniList/IMDb-grade full-screen details sheet backed by the existing rich `TitleDetail` model, fetched with an instant skeleton and cached.

## Why

The browse details surface (`details-panel.ts` → `DetailsPanelData`) is built entirely
by parsing the thin browse-option preview strings (regex over `previewMeta`/`previewBody`).
It has no real synopsis, genres, score, studio, cast, status, seasons, trailer, or links.

Meanwhile a rich `TitleDetail` model (`src/domain/catalog/title-detail.ts`) already
exists — synopsis, genres, studios, status, `seasons`, cast (with photos), episode/season
counts, runtime, content rating, artwork, external IDs — resolved by
`TitleDetailService.fetchTitleDetail(id, type)` and rendered by `details-view.ts` +
`details-pane-ui.tsx` (`DetailsSheetUI`), but only on the playback path. Browse never uses it.

This spec unifies browse details onto that rich path, extends it with the few missing
fields (score, trailer URL, external links), and renders a complete sheet — "everything
relevant people search and want to know," like opening a title on AniList/IMDb.

## Goals

1. Full-screen details sheet (press `i` / Enter) replacing the string-scrape panel.
2. Real data from `fetchTitleDetail`: synopsis, genres, score, studio, status + next-airing,
   episode/season counts, cast, collapsible seasons.
3. New fields: numeric `score`, `trailerUrl` (openable link — terminal can't embed),
   `externalLinks` (AniList / MAL / IMDb / official site).
4. "Your" block: watch progress + where-to-watch (providers / offline) + subs.
5. Inline actions footer: play/resume · queue · follow · download · episodes.
6. Instant open (cached/known data + skeletons) → live fill → cache; never blocks; graceful
   on fetch failure.

## Non-goals

- Embedded trailer/video playback (terminal limitation — trailer is a link).
- Cast photos rendered as images (model has `photoUrl`; sheet shows names only).
- Redesigning the inline preview rail (separate; this is the full sheet only).
- New metadata providers; we extend the existing AniList/TMDB resolvers only.

## Locked decisions

| Decision    | Choice                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| Surface     | Full-screen details sheet (not the side rail)                                             |
| Data source | Existing `TitleDetail` via `fetchTitleDetail`; reuse `details-view` + `DetailsSheetUI`    |
| Loading     | Instant skeleton from known data → live fetch fill → cached (reopen instant)              |
| New fields  | `score?: number`, `trailerUrl?: string`, `externalLinks?: {label,url}[]` on `TitleDetail` |
| Trailer     | Shown as an openable external link, not embedded                                          |
| Scope       | Everything in one pass (score + trailer + links + seasons + actions)                      |

## Architecture

### 1. Model + resolver extension

Add to `TitleDetail` (`src/domain/catalog/title-detail.ts`):

```ts
readonly score?: number;            // 0–10 numeric rating (★)
readonly trailerUrl?: string;       // external trailer link (YouTube etc.)
readonly externalLinks?: readonly { readonly label: string; readonly url: string }[];
```

Populate in the AniList + TMDB resolvers used by `TitleDetailService`:

- **AniList**: `averageScore/10` → `score`; `trailer { site, id }` → YouTube/Dailymotion URL;
  `externalLinks { site, url }` + a MAL link from `idMal`.
- **TMDB**: `vote_average` → `score`; `videos` (first YouTube trailer) → `trailerUrl`;
  `homepage` + IMDb (`external_ids.imdb_id`) → `externalLinks`.

All optional and best-effort; missing fields render as skeleton-then-omitted.

### 2. Pure sheet view-model

New `src/app-shell/details-sheet.model.ts` — `buildDetailsSheet(input)` → a structured,
fully-typed `DetailsSheetModel` with sections, given:

- `detail: TitleDetail | null` (null = not yet fetched → skeleton)
- `instant: { title; posterUrl?; type; year?; }` (from the browse option, always present)
- `history: HistoryProgress | null` (your-progress block)
- `availability: { providers: string[]; offline: boolean; subs: string[] }`
- `seasonsExpanded: boolean`

Returns sections: `header`, `synopsis`, `facts`, `your`, `cast`, `seasons` (with
`expanded`), `links`, `actions`, each carrying a `loading` flag where the value depends on
`detail`. Reuses `details-view.ts` helpers (`buildDetailFactRows`, `buildDetailCastLines`,
`wrapSynopsis`, `buildDetailSubtitle`, `resolvePosterUrl`) for the parts that already exist.

### 3. Render

Extend `DetailsSheetUI` (`details-pane-ui.tsx`) to render the new sections (score in the
subtitle, collapsible `seasons` list, `links` block, trailer line, actions footer) and a
skeleton row primitive (`░░░░`) for `loading` sections. Poster = single Kitty hero (one-image
budget; `usePosterPreview` non-embedded for the hero).

### 4. State + data flow (browse)

`browse-shell.tsx` already tracks `companionDetails` and `openDetailsOverlay`. Replace the
`DetailsPanelData` path with:

1. On open: build the sheet from instant option data + cached `peekTitleDetail(id,type)`
   (may be null) → render immediately (skeletons for unresolved).
2. Fire `fetchTitleDetail(id, type)` (cached in `TitleDetailService`); on resolve, update
   state → sheet re-renders populated. On failure, drop skeletons, keep instant data.
3. Seasons collapse toggled by a key (e.g. `s`); actions dispatch through the existing
   browse action paths (`onSubmit` play, `onResolve` download/watchlist, queue, `w` follow,
   `e` episodes).

`details-panel.ts` (`DetailsPanelData` + string-scrape) is retired once callers move to the
new model (check `overlay-panel.tsx`, `post-play`, `playback` consumers; migrate or keep a
thin adapter only if a non-browse caller still needs the old shape).

## Data flow

1. `i`/Enter on a browse row → open sheet with instant data + `peekTitleDetail` (cached).
2. `fetchTitleDetail` resolves (AniList/TMDB, now incl. score/trailer/links) → cache → fill.
3. `buildDetailsSheet` merges detail + history + availability → `DetailsSheetModel`.
4. `DetailsSheetUI` renders; `s` toggles seasons; footer keys dispatch existing actions.

## Testing

- Resolver extension: AniList/TMDB → `score`, `trailerUrl`, `externalLinks` mapping (unit).
- `buildDetailsSheet`: loaded vs `detail=null` (skeleton) vs partial; your-progress block from
  history (in-progress/completed); availability block; seasons expanded/collapsed (unit).
- `DetailsSheetUI`: `captureFrame` snapshots — loaded, skeleton, narrow width, no-poster,
  long synopsis wrap, seasons collapsed/expanded.
- Reachability: opening from a browse row builds instant model without a fetch; fetch fills it
  (seam test with a fake `fetchTitleDetail`).
- Graceful failure: fetch rejects → instant data retained, skeletons dropped.

## Out of scope / follow-ups

- Inline preview rail richness (could later share `buildDetailsSheet`).
- Cast/season poster thumbnails as images (one-image budget; names only for now).
- Details sheet from calendar/history/post-play surfaces (same model, wire later).
