# Audit — New-Episode Detection for Airing Series & Anime

Read-only audit of how Kunai detects, deduplicates, surfaces, and caches newly-aired
episodes for ongoing titles. All citations are `file:line` against the tree at audit time.

## 1. End-to-End Flow (detection → dedup → surface)

### Trigger / enqueue

- New-episode reconciliation is a background job, never a startup network call.
  Triggers come from three sites:
  - Browse/startup idle: `apps/cli/src/app/SearchPhase.ts:189` (`startup` first, then `browse-idle`).
  - History open: `apps/cli/src/app-shell/root-overlay-shell.tsx:712` and
    `apps/cli/src/app-shell/workflows.ts:1308` (`history`).
  - Post-playback: `apps/cli/src/app/PlaybackPhase.ts:1918`.
- `enqueueReleaseReconciliation` (`apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts:28`)
  converts history entries to `ReleaseReconciliationHistoryRow`s (`:86`), assigns an
  `attention` priority per title (offline-enrolled > continue-visible > dormant; `:45`),
  honors power-saver mode (`:34`), and pushes a job onto `backgroundWorkScheduler`
  lane `attention-refresh` (`:56`).

### Planning / candidate selection

- `planReleaseReconciliationCandidates` (`ReleaseReconciliationPlanner.ts:38`):
  - Skips movies and titles with no `anilist`/`tmdb` catalog id (`:45`, `:58`,
    `getCatalogIdentity` `:167`).
  - Groups history rows by `source:catalogId` and picks the **highest watched
    episode cursor** as the anchor (`pickHighestEpisodeCursor` `:82`,
    `episode-cursor.ts:49`).
  - Skips titles whose cached projection is **not due** (`nextCheckAt > now`, `:88`)
    and applies per-trigger budgets (`RECONCILIATION_TRIGGER_BUDGETS` `:16`:
    startup 25, history/calendar 50, post-playback 1).
  - Sorts candidates by attention rank, then due time, then recency (`:118`).

### Fetch (catalog progress)

- `loadCatalogProgress` (`catalog-progress.ts:25`) splits candidates by source:
  - AniList: batched (50/batch, max 2 batches = 100 ids) via
    `prefetchAnimeReleaseProgressForTitles` then `peekAnimeReleaseProgress`
    (`CatalogScheduleService.ts:149`, `:139`). Underlying query reads
    `episodes status nextAiringEpisode{airingAt episode}`
    (`loadAniListReleaseProgressBatch` `:499`).
  - TMDB: per-title, capped at 5 (`TMDB_TITLE_LIMIT`), via `getSeriesReleaseProgress`
    which fetches one season's episode list and partitions aired vs upcoming by
    `air_date <= today` (`loadTmdbSeriesReleaseProgress` `:699`).

### Compute new-episode count + write projection

- `buildProjection` (`ReleaseReconciliationService.ts:155`):
  `newEpisodeCount = max(0, latestAiredEpisode − anchorEpisode)` (`:157`);
  status is `new-episodes` / `upcoming` / `caught-up` / `unknown` (`:161`).
- Persisted via `ReleaseProgressCacheRepository.upsert` keyed by `title_id`
  (single row per title, `release-progress-cache.ts:67`,
  `ON CONFLICT(title_id)`).

### Dedup

- **Candidate dedup**: history rows collapse to one candidate per
  `source:catalogId` (planner `:64`).
- **Projection dedup**: one cache row per `title_id` (upsert, `:94`).
- **Notification dedup**: `deriveNotifications` builds a `dedupKey` of
  `titleId:season:episode:providerId` (`NotificationEngine.ts:52`).
- **Calendar list dedup**: `dedupeScheduleItems` on
  `source:titleId:season:episode:releaseAt` (`CatalogScheduleService.ts:657`).

### Surface

- Browse "today/new" count: `releaseProgressCache.summarizeActive()` sums
  `new_episode_count` over rows with `status='new-episodes'` and
  `stale_after_at > now` (`SearchPhase.ts:181`, repo `summarizeActive` `:168`).
- History "New episodes" tab + `+N new` badges: `isHistoryNewEpisode` reconciles
  per title against the cached release as a `nextRelease`
  (`history-view.ts:94`, `121`); projection→release mapping in
  `releaseProgressToContinueHistoryRelease` (`root-history-bridge.ts:127`).
- Continue badge / freshness: `continuation-policy.ts:188` (`"N new"` badge,
  `stale` freshness).
- Watchlist `+N new`: `workflows.ts:2766`.
- Calendar "`N new for you`": `calendar-results.ts:92`, with a **second write
  path** that synthesizes projections directly from calendar items (`:45`–`:83`).

## 2. Gaps & Edge Cases for Long-Running Anime

### High severity

- **AniList only ever sees the current cour.** `latestAiredEpisode` is derived
  purely from `nextAiringEpisode.episode − 1` while airing, or `media.episodes`
  when `FINISHED` (`CatalogScheduleService.ts:526`–`:539`). AniList models each
  season/cour as a **separate media id**. So:
  - When a season finishes and a new cour starts under a new AniList id, the user's
    history row (anchored to the old id via `externalIds.anilistId` /
    `anilist:<id>`, planner `:170`) keeps pointing at the finished media and will
    report `caught-up` forever. The new cour is invisible. There is **no
    sequel/`relations` traversal** anywhere.
- **Absolute vs season+episode mismatch (TMDB).** TMDB progress is computed only
  within `anchorSeason` (`loadTmdbSeriesReleaseProgress` requires `input.season`,
  `:703`; `catalog-progress.ts:61` skips candidates without `anchorSeason`).
  New episodes of a **later season** are never detected for TMDB titles — only the
  anchored season is queried. A user caught up on S2E10 will not see S3E1.
- **Anime numbering is single-axis.** `buildProjection` compares
  `latestAiredEpisode` (per-cour, 1-based from AniList) directly to
  `anchorEpisode` (the user's watched episode, `:157`). If history stores absolute
  numbering (e.g. ep 64) but AniList reports cour-relative (`nextAiringEpisode` = 5),
  `max(0, 5 − 64)` = 0 → silently `caught-up`. There is no reconciliation between
  `absoluteEpisode` and per-cour `episode`; `latestAiredSeason` is never populated
  for AniList (`:527`).

### Medium severity

- **Fillers / specials / recaps.** Detection is a pure episode-number delta. A
  filler or recap bumps `nextAiringEpisode.episode`, producing a "new episode" the
  user may not care about. No filler/OVA classification exists.
- **Titles that finished airing.** `FINISHED` with `episodes` known →
  `latestAiredEpisode = media.episodes` (`:535`), which is correct, but if AniList
  reports `episodes: null` (common for long-running/ONA) the title becomes
  `unknown` and surfaces nothing.
- **Mid-season breaks / hiatus.** When a show is on break, AniList has no
  `nextAiringEpisode` and is not `FINISHED` → mapped to `null` (`:541`), so status
  becomes `unknown`. The release-aware refresh cadence collapses to the 2h fallback
  (no `nextAiringAt`), causing repeated polling with no signal.
- **Simulcast delay.** Detection treats `nextAiringEpisode.airingAt` (JP broadcast)
  as the availability time. Provider availability (sub/dub lag) is intentionally
  decoupled (docs say "do not treat airs today as playable"), but the
  `NotificationSignal "new-playable-episode"` (`NotificationEngine.ts:5`) implies a
  provider-confirmed path — no producer of that signal was found in the audited
  scope, so the "playable" notification appears unwired.

### Lower severity

- **TMDB `air_date` is date-only** (`releasePrecision: "date"`), so an episode
  airing later today is classed `released` once the calendar date matches
  (`classifyReleaseStatus` `:435`), risking premature "new episode" for TMDB titles.
- **Title id coupling.** Reconciliation requires an `externalIds.anilistId/tmdbId`
  or a `anilist:`/`tmdb:` prefix (planner `:167`). History rows keyed by a provider
  slug with no external id are silently skipped (`missing-catalog-id`).

## 3. Caching Correctness & Invalidation

### Release-progress cache (`release_progress_cache`, data/cache DB)

- One row per `title_id` (`:94`). Two cadence fields:
  - `nextCheckAt`: when reconciliation may refetch. Set to `nextAiringAt + 15m` if a
    future airing is known, else `now + 2h` (`ReleaseReconciliationService.ts:193`).
  - `staleAfterAt`: `now + 24h` (`DEFAULT_STALE_TTL_MS` `:16`). `summarizeActive`
    and `activeNewEpisodeCount` (`calendar-results.ts:191`) ignore rows past stale.
- **Failure backoff**: 15/30/60/120-minute escalating backoff on `errorCount`
  (`:18`, `handleLoadFailure` `:104`). A first failure on a never-seen title writes a
  placeholder `unknown` row (`:114`).
- **Pruning**: `pruneExpired` deletes rows with `stale_after_at <= now`
  (`release-progress-cache.ts:189`) — no caller for it was found in the audited
  scope, so stale rows may accumulate (only filtered at read time).

### Schedule cache (`schedule_cache`, cache DB)

- Generic key/value with `expires_at`, lazy expiry on read (`schedule-cache.ts:67`,
  `isExpired`). TTLs assigned by `CatalogScheduleService`:
  - next-release / progress: `NEXT_RELEASE_TTL_MS` = 2h (`:3`), but release-aware:
    upcoming items live until `releaseAt + 15m safety` (`ttlForScheduleValue` `:461`),
    released items get 24h (`HISTORICAL_RELEASE_TTL_MS`).
  - releasing-today / window: 30m (`RELEASING_TODAY_TTL_MS` `:4`).
- In-memory `Map` cache sits in front of persistent cache; `loadCached` does
  memory → persistent → inflight-dedup → fetch (`:350`). `prefetch*` uses a
  refresh threshold of `TTL/2` to refetch early (`:152`, `:215`).

### Correctness concerns

- **Two writers, divergent fingerprints.** Both `ReleaseReconciliationService`
  (`sourceFingerprint = anilist|tmdb:...`) and `loadCalendarResults`
  (`sourceFingerprint = calendar:...`, `calendar-results.ts:78`) upsert the same
  `title_id` row with `ON CONFLICT` overwrite. Whichever runs last wins, and the
  calendar path sets `nextCheckAt = now` (`:75`), which **forces immediate
  re-reconciliation** and can defeat the planner's not-due skip.
- **`sourceFingerprint` is stored but never compared.** It is intended to detect
  whether the upstream state changed but is never read to gate writes or
  notifications, so it provides no dedup value today.
- **`buildLocalWindow` clamps to 14 days** (`:453`) but `loadCalendarResults`
  requests 7; fine, but the day-key cache (`window:<mode>:<dateKey>:<days>`) is keyed
  to the local start-of-day, so a window crossing midnight reuses yesterday's bucket
  until 30m TTL lapses.
- **Stale never invalidated proactively** — only filtered at read and pruned by an
  uncalled method (see above).

## Prioritized Recommendations

1. **Fix cross-season/cour detection (highest impact).**
   - AniList: traverse `Media.relations` (SEQUEL edges) so a finished cour's history
     anchor can discover the next cour's media id and `nextAiringEpisode`. Without
     this, ongoing-anime detection is broken for any multi-cour show.
   - TMDB: when the anchored season is `caught-up`/finished, also probe the next
     season number (`anchorSeason + 1`) for `season_number` existence before
     declaring `caught-up`.
2. **Reconcile numbering axes.** Normalize history `absoluteEpisode` vs AniList
   cour-relative `episode` before the `latestAiredEpisode − anchorEpisode` subtraction
   (`ReleaseReconciliationService.ts:157`), or carry `latestAiredSeason` for AniList.
   Guard against negative/zero deltas caused by axis mismatch rather than silently
   treating them as `caught-up`.
3. **Unify the projection writers.** Make `loadCalendarResults` go through the
   reconciliation service (or a shared `applyProgress` helper) instead of
   hand-rolling a `calendar:`-fingerprinted row with `nextCheckAt = now`
   (`calendar-results.ts:62`–`:82`). Today the two paths race on the same row.
4. **Actually use `sourceFingerprint`.** Compare the new fingerprint to the stored
   one to (a) suppress duplicate "new episode" surfacing and (b) skip writes when
   nothing changed — this is the natural dedup seam already modeled but unused.
5. **Schedule pruning.** Call `release-progress-cache.pruneExpired` (and confirm
   `schedule_cache.pruneExpired`) on a maintenance tick so stale rows do not
   accumulate indefinitely.
6. **Classify non-canonical episodes.** Add at least a coarse filler/recap/OVA flag
   from AniList format/airing data so the new-episode delta does not fire on recaps.
7. **Harden TMDB date precision.** For `releasePrecision: "date"` episodes, treat
   "today" as upcoming until end-of-day in the user's locale to avoid premature
   `released` (`classifyReleaseStatus` `:435`).
8. **Wire or remove the playable-episode notification path.** The
   `new-playable-episode` `NotificationSignal` (`NotificationEngine.ts:5`) has no
   producer in scope; either connect it to a provider-availability check or drop it
   to avoid implying a capability that does not exist.
