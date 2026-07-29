# Release Reconciliation Implementation Handoff

Status: implementation complete; manual live smoke remains optional

## Completed In This Slice

- Added shared episode cursor helper:
  - `apps/cli/src/domain/media/episode-cursor.ts`
  - `apps/cli/test/unit/domain/media/episode-cursor.test.ts`
- Added cache DB release progress storage:
  - `packages/storage/src/repositories/release-progress-cache.ts`
  - `packages/storage/src/migrations.ts`
  - `packages/storage/src/index.ts`
  - `packages/storage/test/storage.test.ts`
- Added release reconciliation planner and service:
  - `apps/cli/src/services/release-reconciliation/types.ts`
  - `apps/cli/src/services/release-reconciliation/ReleaseReconciliationPlanner.ts`
  - `apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts`
  - `apps/cli/test/unit/services/release-reconciliation/release-reconciliation-planner.test.ts`
  - `apps/cli/test/unit/services/release-reconciliation/ReleaseReconciliationService.test.ts`
- Wired container with:
  - `releaseProgressCache`
  - `releaseReconciliationService`
- Changed browse idle to read catalog-new count from `releaseProgressCache.summarizeActive()` instead of provider-confirmed notifications.
- Changed browse idle copy to:
  - `N new episode(s)`
  - `catalog schedule · sources checked on play`
- Changed history overlay to read `releaseProgressCache.getByTitleIds(...)` once per render and removed the blocking on-open schedule prefetch.
- Changed calendar results to read cached release progress once for the visible week and surface `N new` in the subtitle and row badge.
- Added browse-idle background reconciliation enqueue through `BackgroundWorkScheduler` on the `attention-refresh` lane.
- Fixed the planner to treat `anime` history rows as episodic release candidates instead of skipping them.

## Verified

- `bun run typecheck`
- `bun run lint` (passes with existing unrelated app-shell warnings only)
- `bun run fmt`
- `bun run test` from `packages/storage`
- `bun run test:unit ...` targeted CLI tests for:
  - episode cursor
  - release reconciliation planner
  - release reconciliation service
  - browse idle actions
  - calendar results

## Important Current Behavior

- Release progress is derived cache data, not history.
- Catalog-only `N new` does not imply playability.
- Browse idle, history overlay, and calendar badges are cache-only at render time.
- The reconciliation service uses bounded catalog loader calls per pass in tests.
- Existing projections are preserved on catalog loader failure; newly observed titles receive unknown/backoff projections rather than immediate repeated requests.
- Browse-idle reconciliation is background scheduled and not awaited by the UI.
- The container's current real loader path is catalog-only:
  - AniList calls `CatalogScheduleService.prefetchAnimeReleaseProgressForTitles(ids, signal)` and reads cached progress results.
  - TMDB performs bounded, sequential season-level progress reads for known IDs.
  - Neither path scrapes or resolves playback providers.

## Completed Follow-Up Hardening

- Extracted shared background reconciliation enqueue logic and wired startup/browse idle, history, and post-playback triggers.
- Removed the root history overlay's direct AniList refresh; first paint now joins only `release_progress_cache`.
- Calendar opportunistically materializes released rows already present in its loaded schedule window without an additional request.
- Calendar maps AniList/TMDB schedule identities through stored external IDs before writing projections, preserving provider-native history keys.
- Added AniList batching guardrails (two batches of fifty) and TMDB season-level progress reads capped at five due titles per pass.
- Added finished-series AniList totals, typed catalog failure backoff, and one coalescing scheduler identity for overlapping refresh triggers.
- Added title-safe history continuation mapping: multiple aired episodes select the first unwatched episode, never mutate history.
- Changed watchlist enrichment to one history read and one projection map read rather than per-title history queries.
- Added bounded release-refresh diagnostic operations and cache maintenance pruning for derived rows.

## Explicit Non-Blockers

- TMDB season rollover remains unknown until title-details support can compare S1 to S2 without guessing, as locked in the plan.
- Live catalog/provider/mpv smoke remains opt-in near release to avoid unnecessary upstream traffic; deterministic gates cover the implemented policy.

## Safe Delegation Slices

These can be assigned to other agents without overlapping the core files above:

1. History UI worker
   - Owns:
     - `apps/cli/src/app-shell/root-history-bridge.ts`
     - `apps/cli/test/unit/app-shell/root-history-bridge.test.ts`
     - optional tests for `apps/cli/src/app-shell/workflows.ts` if an existing seam is found
   - Should not edit:
     - storage migrations
     - release reconciliation service
     - container
   - Note:
     - the plain history overlay now reads `releaseProgressCache`; root history picker still has richer `nextReleases` copy that can be adapted to projections.

2. Calendar UI worker
   - Owns:
     - `apps/cli/src/app/calendar-results.ts`
     - `apps/cli/test/unit/app/calendar-results.test.ts`
   - Should not edit:
     - storage migrations
     - release reconciliation service
   - Note:
     - basic `N new` subtitle/badge support is already in place; remaining work is richer watched/followed grouping and opportunistic projection writes from calendar rows already loaded.

3. Background trigger worker
   - Owns:
     - `apps/cli/src/app/SearchPhase.ts`
     - `apps/cli/src/app/PlaybackPhase.ts`
     - trigger tests they add
   - Should coordinate with history worker before editing `workflows.ts`.

4. Playback handoff worker
   - Owns the separate plan:
     - `.plans/binge-playback-handoff-provider-health.md`
   - Should wait until release reconciliation surface wiring is stable unless explicitly parallelized.

## Suggested Next Command

Before a new agent resumes, run:

```sh
bun run typecheck
bun run lint
bun run --cwd packages/storage test
bun run --cwd apps/cli test:unit test/unit/services/release-reconciliation test/unit/domain/media/episode-cursor.test.ts test/unit/app-shell/browse-idle-actions.test.ts test/unit/app/calendar-results.test.ts
```
