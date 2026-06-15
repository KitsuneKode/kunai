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
3. New fields: numeric `score`, `trailerUrl`, `externalLinks` (AniList / MAL / IMDb / site).
4. "Your" block: watch progress + where-to-watch (providers / offline) + subs.
5. Inline actions footer: play/resume · queue · follow · download · episodes · **trailer (mpv)**.
6. Instant open (cached/known data + skeletons) → live fill → cache; never blocks; graceful
   on fetch failure.
7. **Minimise network**: seed the sheet from data we already fetched (the browse option /
   `SearchResult` carries score, poster, genres, external IDs); only fetch the gaps, and only
   via ONE consolidated call per source.

## Non-goals

- Cast photos rendered as images (model has `photoUrl`; sheet shows names only).
- Redesigning the inline preview rail (separate; this is the full sheet only).
- New metadata providers; we extend the existing AniList/TMDB resolvers only.

## Locked decisions

| Decision    | Choice                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| Surface     | Full-screen details sheet (not the side rail)                                             |
| Data source | Existing `TitleDetail` via `fetchTitleDetail`; reuse `details-view` + `DetailsSheetUI`    |
| Loading     | Seed from already-fetched data → ONE consolidated gap-fill call per source → cached       |
| New fields  | `score?: number`, `trailerUrl?: string`, `externalLinks?: {label,url}[]` on `TitleDetail` |
| Trailer     | Played in mpv (`t`) via the app's player + yt-dlp; browser/link fallback if unavailable   |
| Links       | External links (AniList/MAL/IMDb/site) open in the browser                                |
| Scope       | Everything in one pass (score + trailer + links + seasons + actions)                      |

## Architecture

### 1. Model + resolver extension

Add to `TitleDetail` (`src/domain/catalog/title-detail.ts`):

```ts
readonly score?: number;            // 0–10 numeric rating (★)
readonly trailerUrl?: string;       // external trailer link (YouTube etc.)
readonly externalLinks?: readonly { readonly label: string; readonly url: string }[];
```

Populate in the AniList + TMDB resolvers used by `TitleDetailService`, each in a SINGLE call:

- **AniList**: one GraphQL `Media` query already returns everything we need — add
  `averageScore` (→ `/10` `score`), `trailer { site, id }` (→ YouTube/Dailymotion URL),
  `externalLinks { site, url }`, and `idMal` (→ MAL link) to the existing selection set. No
  extra request.
- **TMDB**: one call with `append_to_response=videos,external_ids,credits` returns details +
  `vote_average` (→ `score`), first YouTube trailer (→ `trailerUrl`), `homepage` + IMDb
  (`external_ids.imdb_id` → `externalLinks`), and cast — replacing any multi-call path.

All optional and best-effort; missing fields render as skeleton-then-omitted.

### 1a. Minimise network — seed before fetch

The browse option / `SearchResult` already carries data from the search call (`rating`/score,
`posterPath`, `externalIds`, `episodeCount`, and — for anime — AniList-enriched fields). The
sheet's **header renders entirely from this seed with zero fetch**: title, poster, year, score,
type, your-progress. A gap-fill `fetchTitleDetail` (the single consolidated call above, cached
in `TitleDetailService`) runs only for the parts the seed lacks — synopsis, studio, cast,
seasons, trailer, links — and only if not already cached. Reopening a title never re-fetches.
`buildDetailsSheet` takes the seed as `instant` and treats `detail` as the (optional) gap-fill.

### 2. Pure sheet view-model

New `src/app-shell/details-sheet.model.ts` — `buildDetailsSheet(input)` → a structured,
fully-typed `DetailsSheetModel` with sections, given:

- `detail: TitleDetail | null` (null = gap-fill not yet fetched → skeleton for gap-only parts)
- `instant: { title; posterUrl?; type; year?; score?; genres?; }` (seed from the browse
  option / `SearchResult`, always present — header needs no fetch)
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
   `e` episodes). `t` plays `trailerUrl` in mpv via the existing `PlayerService` (yt-dlp);
   if mpv/yt-dlp can't, fall back to opening the URL in the browser. External links (`l` or a
   links sub-list) open in the browser.

`details-panel.ts` (`DetailsPanelData` + string-scrape) is retired once callers move to the
new model (check `overlay-panel.tsx`, `post-play`, `playback` consumers; migrate or keep a
thin adapter only if a non-browse caller still needs the old shape).

## Data flow

1. `i`/Enter on a browse row → open sheet seeded from the option/`SearchResult` (score,
   poster, year, genres, progress) + cached `peekTitleDetail` → header is complete with no
   fetch; gap-only parts (synopsis/cast/seasons/trailer/links) show skeletons.
2. If not cached, ONE consolidated `fetchTitleDetail` (single AniList GraphQL / one TMDB
   `append_to_response`) resolves the gaps → cache → fill. Reopen never re-fetches.
3. `buildDetailsSheet` merges seed + detail + history + availability → `DetailsSheetModel`.
4. `DetailsSheetUI` renders; `s` toggles seasons; `t` plays the trailer in mpv; footer keys
   dispatch existing actions.

## Testing

- Resolver extension: AniList/TMDB → `score`, `trailerUrl`, `externalLinks` mapping (unit).
- `buildDetailsSheet`: loaded vs `detail=null` (skeleton) vs partial; your-progress block from
  history (in-progress/completed); availability block; seasons expanded/collapsed (unit).
- `DetailsSheetUI`: `captureFrame` snapshots — loaded, skeleton, narrow width, no-poster,
  long synopsis wrap, seasons collapsed/expanded.
- Seed-first: the header (title/poster/year/score/genres/progress) builds from the option seed
  with NO `fetchTitleDetail` call; gap-fill only fires for missing parts and is skipped when
  cached (seam test with a fake fetch counting calls).
- Trailer action: `t` with a `trailerUrl` invokes the player port (mpv) with that URL; falls
  back to the browser opener when the player declines (seam test with fakes).
- Graceful failure: fetch rejects → seed data retained, skeletons dropped.

## Out of scope / follow-ups

- Inline preview rail richness (could later share `buildDetailsSheet`).
- Cast/season poster thumbnails as images (one-image budget; names only for now).
- Details sheet from calendar/history/post-play surfaces (same model, wire later).
