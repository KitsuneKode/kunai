# Release Reconciliation And Experience Workplan

Status: core workstreams implemented 2026-05-24; future product polish remains optional

## Goal

Ship catalog-only "N new" reconciliation in the safest possible way, then use the same projection-and-budget pattern to improve browse, history, calendar, playback, mpv, source controls, and diagnostics without hidden API/provider churn.

## Architecture

The immediate feature is a cache-first reconciliation pipeline:

```text
history/followed/watchlist candidates
  -> episode cursor policy
  -> catalog schedule batch loaders
  -> release_progress_cache
  -> cheap UI joins in browse idle, history, calendar
```

The larger product direction is:

```text
volatile upstream/provider work happens behind explicit refresh budgets
stable UI reads cheap local projections
diagnostics explain freshness, skipped work, and next action
```

This keeps Kunai fast while making the shell feel smarter over time.

## Workstream 1: Release Reconciliation Core

### 1. Episode cursor policy

Files:

- Create: `apps/cli/src/domain/media/episode-cursor.ts`
- Test: `apps/cli/test/unit/domain/media/episode-cursor.test.ts`

Purpose:

- Compare season/episode/absolute episode consistently.
- Pick the watched anchor from many history rows.
- Avoid regressions where rewatching E2 hides that E6 was already watched.

Acceptance:

- Highest watched cursor wins over most recent watched row.
- Unfinished rows can still be resume targets without corrupting new-count math.
- Specials/episode zero are excluded unless explicitly normal.

### 2. Release progress cache

Files:

- Modify: `packages/storage/src/migrations.ts`
- Create: `packages/storage/src/repositories/release-progress-cache.ts`
- Modify: `packages/storage/src/index.ts`
- Test: `packages/storage/test/release-progress-cache.test.ts`

Purpose:

- Store derived per-title release progress in the cache DB.
- Keep `history_progress` as watched facts only.

Acceptance:

- `upsert`, `getByTitleIds`, `listDue`, `summarizeActive`, `pruneExpired` are available.
- Queries are bounded and indexed by `next_check_at`, `status`, and `title_id`.
- Cache prune removes stale projections without touching history.

### 3. Candidate planner and budget policy

Files:

- Create: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationPlanner.ts`
- Create: `apps/cli/src/services/release-reconciliation/ReleaseRefreshBudget.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/release-reconciliation-planner.test.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/release-refresh-budget.test.ts`

Purpose:

- Decide which titles are eligible before any network work.
- Enforce per-trigger and per-source budgets.

Acceptance:

- Muted, movie, missing-identity, too-soon, and budget-exhausted candidates are skipped with reasons.
- Cached due checks are O(rows), not O(rows \* APIs).
- Budget tests prove max calls for startup, browse, history, and calendar triggers.

### 4. Catalog progress loaders

Files:

- Modify: `apps/cli/src/services/catalog/CatalogScheduleService.ts`
- Create: `apps/cli/src/services/release-reconciliation/catalog-progress.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/catalog-progress.test.ts`

Purpose:

- Convert catalog data into latest-aired and next-airing facts.
- Batch AniList and constrain TMDB season fetches.

Acceptance:

- AniList uses batched `id_in` chunks and can compute `latestAired = nextAiringEpisode - 1`.
- Finished AniList shows use total episode count only when catalog supplies it.
- TMDB computes latest aired from one season payload per title-season.
- Season rollover is represented as unknown until TV details support lands; no blind S+1 guessing.

### 5. Reconciliation service

Files:

- Create: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts`
- Modify: `apps/cli/src/container.ts`
- Test: `apps/cli/test/unit/services/release-reconciliation/ReleaseReconciliationService.test.ts`

Purpose:

- Orchestrate candidates, cache, catalog loaders, stale-preserving writes, and diagnostics.

Acceptance:

- Cached projections render with zero network calls.
- Failure keeps the last good projection and schedules backoff.
- `429`/timeout/source failure reduces current pass budget.
- Diagnostics include candidate count, cache hits, fetch count, skipped reasons, stale count, and next due time.

### 6. Background trigger wiring

Files:

- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts` only if a new lane or metrics are needed.
- Modify: `apps/cli/src/app/SearchPhase.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Test: targeted unit tests around trigger planning where available.

Purpose:

- Run reconciliation from safe moments without blocking startup, typing, playback, or list movement.

Acceptance:

- Startup enqueues after shell readiness and never awaits reconciliation.
- Browse idle reads cache first and enqueues at most one low-budget stale refresh.
- `/history` paints cached rows first, then updates once after a bounded refresh.
- `/calendar` opportunistically writes projections from already-fetched calendar rows with no extra catalog calls.
- Post-playback enqueues only the just-watched title.

### 7. Surface joins

Files:

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/browse-idle-actions.ts`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx`
- Modify: `apps/cli/src/app-shell/root-history-bridge.ts`
- Modify: `apps/cli/src/app/calendar-results.ts`
- Test: existing browse idle, history bridge, and calendar unit tests.

Purpose:

- Surface `N new` from local projection data only.

Acceptance:

- Browse idle says `N new episodes · M shows`, with copy that does not imply source confirmation.
- History rows show `N new since E#`, `caught up · next Fri`, or `release unknown`.
- Calendar marks matching watched/followed rows as new when the calendar episode is newer than the anchor.
- Provider-confirmed notifications remain separate.

### 8. Verification

Commands:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `bun run test`

Manual smoke:

- Fixed-clock E6 -> E8 unit or integration fixture.
- Cached browse idle with no network calls.
- `/history` first paint from cache, then one bounded refresh.
- `/calendar` updates projections from loaded schedule rows.
- One optional live catalog smoke only after deterministic tests are green.

## Workstream 2: API And Compute Safety Improvements

These are not optional polish; they protect the feature from becoming wasteful.

1. Add a shared "refresh budget" utility for catalog/recommendation/provider-availability workers.
2. Add diagnostics panels for cache age, next check, skipped reason, and last reconciliation error.
3. Add tests that fail if a surface performs per-row catalog calls.
4. Prefer stale-while-revalidate everywhere a projection can be locally useful.
5. Keep provider availability sync off by default and separate from catalog-aired state.

## Workstream 3: UX Improvements Found During The Scan

### High priority

1. Browse idle "For you now" shelf
   - Merge continue watching, playlist next, and catalog-new episodes into one prioritized return-loop model.
   - Never hide resume behind a release badge.

2. History as the command center
   - Add row state clarity: `resume`, `new since`, `caught up`, `release unknown`.
   - Selecting a new row should target the next unwatched aired episode, but resolution remains explicit.

3. Calendar "for you" grouping
   - Calendar already has schedule rows. Add a local projection join so watched/followed shows float into a "For you" band without extra fetching.

4. Diagnostics explanation
   - Add a small "Release sync" diagnostic section: last run, fetched, skipped, source budgets, next due.
   - This prevents the user from wondering whether "N new" is stale or broken.

### Medium priority

5. Source/quality/subtitle chooser polish
   - Use existing cached source inventory views.
   - Show source, quality, audio, hard-sub, soft-sub facts without refetching.
   - Make "current" and "selection changed" states obvious.

6. mpv/player health strip
   - Surface automatic reconnect, cache buffering, recovery/fallback, and subtitle attach state in calm copy.
   - Use existing mpv IPC telemetry and diagnostics events; do not poll in render paths.

7. Post-playback recommendation context
   - Keep recommendation actions in the post-playback panel.
   - Recommendations should queue/detail/download only through explicit actions and cached metadata first.

8. Playback action vocabulary cleanup
   - Keep `resume`, `restart/replay`, `recover`, `refresh`, and `fallback` visibly distinct.
   - This is especially important once history rows can target a newer episode.

### Lower priority

9. First-run dependency and capability clarity
   - mpv, ffprobe, image preview, and IPC capability should feel like app setup, not surprise runtime failure.

10. Offline/new episode bridge

- Later, once release projection is stable, add explicit "download next unwatched" actions.
- Do not auto-resolve providers from a release badge.

## Workstream 4: Engine And Playback Improvements To Consider Next

1. Playback source inventory cache wiring
   - Source/quality/subtitle changes should use cached inventory first.
   - Re-resolve only when the selected mode was not included in inventory.

2. Provider fallback transparency
   - When fallback happens, show which provider/source failed and what Kunai is trying next.
   - Keep detailed evidence in diagnostics, compact copy in shell.

3. mpv reconnect and recover UX
   - In-process reconnect is already documented. The shell should make reconnect attempts visible without feeling alarming.
   - Manual recover should mean fresh provider resolve; reconnect should mean same URL reload.

4. Prefetch governance
   - Near-EOF next-episode prefetch, recommendation warmup, release reconciliation, and provider availability need one coherent background-work budget story.
   - Playback-critical work should always outrank warmups.

5. Player capability snapshots
   - A cheap local snapshot of active stream, cache, subtitles, selected source, buffering, and reconnect count can power playback UI, diagnostics, and support bundles.

Detailed playback handoff, provider fallback, title-scoped health, adaptive prefetch timing, and IntroDB/AniSkip readiness decisions are now locked in `.plans/binge-playback-handoff-provider-health.md`.

## Suggested Order

1. Ship Workstream 1 through cached browse/history/calendar labels.
2. Add Workstream 2 diagnostics and call-count tests before broadening triggers.
3. Polish browse idle, history, and calendar as one return-loop pass.
4. Implement `.plans/binge-playback-handoff-provider-health.md` as the provider/player-owned follow-up slice.
5. Then do source/quality/subtitle chooser polish because it reuses the same "cached projection, explicit refresh" principle.
6. Then tighten mpv/player health UX and post-playback recommendations.

## Things Not To Do

- Do not create background provider probes for every followed title.
- Do not make notifications imply playability from catalog-only data.
- Do not update history rows for episodes the user has not watched.
- Do not add per-row `getNextRelease` calls in history or browse.
- Do not start a daemon just for this feature.
- Do not make calendar load providers to prove playability.
- Do not add remote sync/account concepts to solve a local projection problem.

## Review Questions

Resolved:

1. V1 is AniList-first, with TMDB series support allowed only behind known IDs and strict season-level budget.
2. Release progress cache lives in the cache DB as derived data.
3. Browse idle shows total episodes and title count: `N new episodes · M shows`.
4. Catalog-only release state stays shelves/badges in v1; provider-confirmed notifications remain separate.
5. Provider/player handoff work is a separate plan so catalog reconciliation can ship independently.
