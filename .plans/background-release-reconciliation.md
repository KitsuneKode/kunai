# Background Release Reconciliation Plan

Status: implemented 2026-05-24

## Goal

Detect episodes that have aired after the user's last watched episode using catalog and schedule data, not provider scrapes, then surface "N new" in browse-idle, history, and calendar without adding per-frame or per-keystroke work.

This solves the E6 -> E8 problem:

- The user watched E6.
- E7 airs this week.
- E8 airs next week.
- Kunai should know there are new episodes without the user manually refreshing history and without resolving providers.

## Non-Goals

- Do not scrape providers to detect new episodes.
- Do not mark unplayed episodes as watched.
- Do not use stream availability as the source of release truth.
- Do not make browse typing, list movement, or render loops perform catalog calls.
- Do not treat "aired" as "playable". Provider resolution still happens only after explicit user action.
- Do not create catalog-only inbox/toast notifications in v1; use shelves and badges first.

## Current State

Implemented pieces:

- `CatalogScheduleService` owns schedule metadata and has SQLite cache, in-memory cache, in-flight dedupe, release-aware TTLs, `peekNextRelease`, and an AniList progress-batch path that includes finished-series totals.
- `/calendar` already loads catalog schedule rows without provider resolution.
- History UI already has "new since E#" formatting and projection helpers.
- Notifications already separate queue recovery and new episode notices from raw stream URLs.
- `BackgroundWorkScheduler` already has an `attention-refresh` lane with bounded concurrency.

Hardening completed:

- Browse idle and `/history` paint from `release_progress_cache`; neither fetches during rendering, typing, or row movement.
- Startup, browse, history, and post-playback enqueue one coalescing background task identity on the low-priority lane.
- Catalog failures preserve or seed an unknown projection with retry backoff instead of quietly refetching.
- Calendar joins schedule IDs to provider-native history IDs through external catalog IDs and writes only from rows already loaded in its window.
- AniList reconciliation reads finished totals as well as next-airing metadata.
- TMDB reconciliation reads season-level catalog data under a five-title sequential budget; season rollover remains deferred until TV-details support can represent it without guessing.

## Recommended Architecture

Use a catalog-only reconciliation service that materializes a cheap "release progress projection" in the cache DB.

The projection is derived data, not watch history:

```ts
type ReleaseProgressProjection = {
  titleId: string;
  mediaKind: "series";
  source: "anilist" | "tmdb";
  title: string;
  anchorSeason?: number;
  anchorEpisode: number;
  latestAiredSeason?: number;
  latestAiredEpisode?: number;
  newEpisodeCount: number;
  nextAiringSeason?: number;
  nextAiringEpisode?: number;
  nextAiringAt?: string;
  latestKnownReleaseAt?: string;
  status: "new-episodes" | "caught-up" | "upcoming" | "unknown";
  checkedAt: string;
  nextCheckAt: string;
  staleAfterAt: string;
  sourceFingerprint: string;
  errorCount: number;
  lastError?: string;
};
```

Store it in a new cache repository, for example `release_progress_cache`, keyed by `title_id`. It is safe to rebuild from history plus catalog. Do not add fields to `history_progress` for this; history should remain a factual record of playback progress.

## Architecture Options Considered

1. Route-local cache reads only
   - Keep `/history`, browse idle, and `/calendar` deriving their own labels from `schedule_cache`.
   - Lowest migration cost, but it keeps duplicate logic and makes route opens responsible for freshness.
   - Not recommended because it preserves the current "every surface figures it out again" shape.

2. Durable projection in `history_progress`
   - Add latest-aired fields directly beside playback progress.
   - Easy to query, but it mixes watched facts with catalog-derived facts and risks making unplayed episodes look like history.
   - Not recommended because history must remain the user's actual playback record.

3. Separate release progress projection
   - Keep history immutable as watched facts, keep schedule cache as upstream payload cache, and add a user-specific projection table.
   - Slightly more structure, but it gives every surface one cheap read path and one shared reconciliation policy.
   - Recommended because it controls overfetching and keeps the data model honest.

## Data Flow

1. Candidate harvest
   - Read recent series history in one bounded query.
   - Include followed and watchlist titles when they have catalog IDs.
   - Exclude movies, muted titles, titles without usable catalog identity, and entries below the interest threshold.
   - Collapse multiple history rows per title into one anchor cursor.

2. Anchor cursor calculation
   - Prefer the highest watched episode cursor over the most recently updated row.
   - This prevents rewatching E2 from making Kunai forget that E6 was already watched.
   - Keep unfinished progress separate: browse can still prioritize "resume E6", while the release projection can say "2 new since E6".

3. Catalog reconciliation
   - Group candidates by catalog source.
   - AniList: batch by `id_in` chunks, using `nextAiringEpisode`, `episodes`, and status. For ongoing shows, `latestAired = nextAiringEpisode.episode - 1`. For finished shows, use `episodes` when available.
   - TMDB: use title/season cache, not episode-by-episode checks. Fetch one season payload per due title-season, compute the highest episode with `air_date <= local today`, and use TV details or `next_episode_to_air` later for season rollover.
   - Calendar route can opportunistically update projections from already-loaded calendar rows with no extra network calls.

4. Projection write
   - Write one projection row per title.
   - Compute `newEpisodeCount = latestAiredCursor - watchedAnchorCursor`.
   - Compute `nextCheckAt` from known future release time plus a safety window, otherwise from conservative backoff.
   - Preserve the last good projection if a refresh fails.

5. UI reads
   - Browse idle reads a precomputed summary: total new episodes and title count.
   - History reads a projection map once when the overlay opens and joins it to rows.
   - Calendar joins schedule rows to history/projection data already in memory and labels tracked rows as `N new` when the calendar episode is newer than the watched anchor.

## Runtime Triggers

No per-frame or per-keystroke fetching.

Allowed triggers:

- Startup idle: enqueue a low-priority reconciliation after the shell is usable.
- Browse idle open: read cached projection immediately, enqueue stale-while-revalidate only if projection is due.
- `/history`: read cached projection immediately, enqueue one due-title reconciliation batch, then update rows once.
- `/calendar`: use the calendar window response as a free reconciliation source for matching history/followed titles.
- Post-playback: after history is saved, enqueue reconciliation for the just-watched title only.
- Long-running shell: optional single coarse wake timer for the nearest due `nextCheckAt`; no render-loop polling.

## Fetch Budget And N+1 Controls

Hard rules:

- One candidate harvest per surface open, not per row.
- One projection map read per surface open, not per row.
- Deduplicate candidates by canonical catalog ID before fetching.
- Batch AniList requests in chunks, with a small max candidate count per pass.
- TMDB fetches must be season-level or title-level, never episode-level loops.
- Reuse schedule cache entries before network.
- Use in-flight dedupe so browse/history/calendar opening together does not duplicate calls.
- Abort work when the user exits the surface.
- Keep stale projections visible on failure.

Recommended first budgets:

- Startup idle: max 25 titles, no blocking.
- Browse idle SWR: max 10 due titles.
- History overlay: max 50 due titles, cached rows render first.
- Calendar opportunistic updates: no extra fetch budget because the schedule rows already exist.
- TMDB: max 5 uncached season fetches per pass until TV weekly UX is better designed.

## API Safety Policy

This feature must be designed as if upstream catalog APIs are scarce shared resources.

Add one reconciliation coordinator, not many surface-local refresh loops. The coordinator owns:

- per-source budgets
- due-title selection
- cache reads before network
- in-flight request dedupe
- abort and timeout behavior
- backoff after failures or rate limits
- diagnostics for skipped and fetched work

Safety invariants:

- UI surfaces may read cached projections freely, but may not call catalog APIs directly for "N new" labels.
- A title is eligible for network refresh only when `nextCheckAt <= now`, the user has enough interest in the title, and the source budget has capacity.
- A successful future release schedules the next refresh around the known release time plus a safety window, not on every app launch.
- A failure keeps the last good projection and pushes `nextCheckAt` forward with exponential backoff and jitter.
- `429`, `503`, timeout, or DNS failures should reduce the remaining budget for that source in the current process.
- No retry loop should run inside one surface open. A failed pass waits until a later trigger.
- Reconciliation should use a single background lane and a low concurrency limit so it never competes with playback-critical work.
- Tests must assert maximum loader calls for representative history sets, including 0-call cached reads.

Initial guardrail numbers:

- AniList batch size: 50 ids per request, max 2 requests per reconciliation pass.
- TMDB season fetches: max 5 per pass until TV weekly support is expanded.
- Minimum network refresh interval per title without known next-airing timestamp: 2 hours.
- Minimum retry backoff after catalog failure: 15 minutes, then 30, 60, 120, capped at 24 hours.
- Browse idle: cache-only render; optional background pass capped at 10 due titles.
- History overlay: cache-only first paint; one background pass capped at 50 due titles.
- Startup idle: scheduled after shell readiness; capped at 25 due titles; never awaited by startup.

## Surface Behavior

### Browse Idle

Replace the provider-confirmed notification count with a catalog release summary:

- `3 new episodes · 2 shows`
- secondary copy: `catalog schedule · sources checked on play`

Keep playlist and resume rows above it. Do not say "source confirmed" unless the signal came from provider availability.

### History

Each history row can show:

- `2 new since E6`
- `caught up · next Fri`
- `release unknown`

Selecting a row with new episodes should target the next unwatched aired episode, but only after the user confirms selection. If the provider cannot resolve it, the normal playback failure path applies.

### Calendar

Calendar already has schedule rows. For rows matching a watched/followed title:

- If the release episode is newer than the watched anchor, badge the row `new`.
- If several episodes are already newer, the companion/history detail can show `N new since E#`.
- Do not imply playability; calendar remains release timing.

### Notifications

Do not reuse current `new-episode` notification semantics for catalog-only releases if the notification actions imply queue/download/playability.

Better split:

- Shelf/browse/history/calendar: catalog-aired, provider-unconfirmed.
- Notification: provider-confirmed only for v1.
- A later catalog-only notification kind may be added only if its actions are safe, such as "view history", "open calendar", and "dismiss".

## Locked Review Decisions

These answers are part of the implementation contract:

1. TMDB scope
   - AniList is the full v1 path for anime release progress.
   - TMDB series support is allowed only when IDs are already known and season-level data can be fetched under the strict TMDB budget.
   - No episode-by-episode TMDB loops.

2. Catalog-only notifications
   - Catalog-only aired episodes remain browse/history/calendar shelves and badges in v1.
   - Provider-confirmed notifications stay separate.
   - Do not imply playability until provider resolution happens from explicit user action.

3. Browse idle copy
   - Use calm summary copy: `3 new episodes · 2 shows`.
   - Secondary copy: `catalog schedule · sources checked on play`.
   - Never say `source confirmed` for catalog-only release state.

4. Implementation order
   - Ship release reconciliation first.
   - Then ship binge handoff/provider health from `.plans/binge-playback-handoff-provider-health.md`.
   - The systems share budget and diagnostics principles, but they should not block each other.

5. Overfetch tests
   - Add tests that assert max catalog loader calls for large history sets.
   - A large history set must batch/dedupe; it must not create one API call per row.

6. User override
   - Automatic release targets are suggestions, not traps.
   - The user can still choose provider, source, refresh, recover, restart, or ignore release badges.

7. Failure copy
   - Use `release unknown`, stale/cached copy, or quiet absence of badge for catalog uncertainty.
   - Reserve alarming/degraded wording for evidence-backed provider/player health, not catalog cache age alone.

## Edge Cases

- Rewatching older episodes: anchor uses highest watched cursor, not most recent row.
- Unfinished current episode: resume remains first; new-count still compares against the highest started/watched cursor.
- Missing external IDs: skip reconciliation and surface no badge; do not search providers to fill identity.
- AniList ongoing show: use `nextAiringEpisode - 1` for latest aired.
- AniList finished show: use total episode count if available; otherwise unknown.
- Same-day future release: if release time is later today, status is upcoming until the timestamp passes.
- Date-only TMDB release: treat local date as released on that date, matching existing `classifyReleaseStatus`.
- Season rollover: v1 should not guess. Add TV details support so S1E12 can progress to S2E1 with a comparable cursor.
- Specials / episode zero: exclude from "new since" unless catalog marks them as normal season episodes.
- Timezone changes: cache keys should use local date windows, but projections should store ISO timestamps and recompute labels at render time.
- Failed catalog call: keep old projection, bump error count, back off.
- Cache prune: surfaces degrade to no badge until background reconciliation repopulates.
- Muted title: do not surface shelf or notification signals.
- Provider-confirmed playable notification dismissed: do not hide catalog shelf state unless the user muted the title.

## Architectural Improvements To Fold In

1. Add a shared episode cursor helper
   - Compare `{season, episode, absoluteEpisode}` consistently.
   - Use it in history reconciliation, continuation projection, calendar row joins, and history labels.

2. Add a projection repository instead of reading schedule cache keys directly
   - Schedule cache answers "what did the upstream say?"
   - Release progress answers "what does this mean for this user's history?"

3. Extend `CatalogScheduleService` with a batch progress API
   - `getReleaseProgressForTitles(candidates, signal)`
   - It should internally use source-specific batching and cache reads.

4. Unify the duplicated continuation/reconciliation concepts
   - `history-reconciliation.ts` and `continuation-policy.ts` overlap.
   - Keep one domain projection for resume/upcoming/new/caught-up, then adapt it to browse/history/playback UI.

5. Keep provider availability experimental and separate
   - Provider availability can enrich a release after catalog says it aired.
   - It must stay budgeted, cancellable, and off by default.

6. Add diagnostics
   - Record candidate count, fetched count, cache hit count, skipped reasons, and next due time.
   - Redact raw payloads.

## Implementation Slices After Approval

1. Domain tests for episode cursor and projection math.
2. Storage migration and repository for `release_progress_cache`.
3. `ReleaseReconciliationService` with mocked catalog loaders.
4. AniList batch progress loader using existing schedule cache and in-flight dedupe.
5. TMDB season-level progress loader with strict fetch budget.
6. Background trigger wiring through `BackgroundWorkScheduler`.
7. Browse idle/history/calendar joins against cached projections.
8. Diagnostics and failure/backoff tests.
9. Manual smoke for E6 -> E8 using mocked/fixed catalog data, then one opt-in live catalog smoke.

## Related Plan

Playback prefetch, provider fallback, title-scoped health, mpv handoff copy, IntroDB/AniSkip timing readiness, and future download-next behavior are handled in `.plans/binge-playback-handoff-provider-health.md`.
