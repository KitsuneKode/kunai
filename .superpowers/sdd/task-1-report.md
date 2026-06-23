# Task 1 Report: Continue Decision Adapters

Status: DONE_WITH_CONCERNS

## Summary

- Added repository-backed `ContinuationViewDecision` adapters to `ContinueWatchingService`.
- Added `startupCandidate`, `recentDecisions`, and `titleDecision` while keeping existing `projectTitle`, `recentRow`, and `episodeProgress` compatibility.
- Added `projectionFromViewDecision` for projection compatibility, with explicit offline-ready local primary action and online secondary action mapping.
- Updated launch-entry continue selection helpers to apply the newest-anchor rule per logical title key, so they no longer scan back to older abandoned episodes after a newer completed row.

## TDD Evidence

- RED: `bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts` failed because `startupCandidate` did not exist.
- GREEN: `bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/continuation/continuation-policy.test.ts test/unit/app/launch-entry.test.ts` passed with 19 tests and 0 failures.

## Verification

- `bun run fmt` passed.
- `bun run lint` passed with 0 errors; it reported 2 pre-existing warnings in `packages/providers/test/anime-episode-metadata-handoff.test.ts` for unused `init` parameters.
- `bun run typecheck` passed.
- `git diff --check` passed.

## Concerns

- The task intentionally did not wire startup/root/history surfaces to consume the new decision object yet.
- Shell environment prints bash function-import warnings before Bun commands; the commands still executed and returned the statuses above.

## Review Fix Follow-up (2026-06-23)

- Fixed `projectionFromViewDecision(...)` so it now maps preserved `ContinuationViewDecision` states directly into `ContinuationProjection` cases for `resume`, `offline-ready`, `next-up`, `new-episodes`, `airing-weekly`, and `up-to-date` instead of recomputing from a single history row.
- Preserved carried presentation fields on those mapped projections, including `badge`, `detail`, `primaryAction`, `secondaryActions`, and `freshness`.
- Fixed `ContinueWatchingService.toViewDecision(...)` to preserve `releaseProgress.stale` as `freshness: "stale"` instead of collapsing every non-offline decision to `"cached"`.
- Added regression coverage for stale freshness plus non-offline projection preservation (`next-up` and `new-episodes`).

### Focused Review-Fix Test Results

- RED: `bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/continuation/continuation-policy.test.ts` failed with:
  - `titleDecision preserves stale freshness from release progress` expected `"stale"` and received `"cached"`.
  - `projectionFromViewDecision preserves next-up decision details and freshness` received `kind: "up-to-date"` instead of the preserved `next-released` projection.
  - `projectionFromViewDecision preserves new-episodes badge and freshness` received `kind: "up-to-date"` instead of the preserved `new-episodes` projection.
- GREEN: `bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/continuation/continuation-policy.test.ts test/unit/app/launch-entry.test.ts` passed with 22 tests and 0 failures.

## Review Fix Follow-up (2026-06-23)

- Preserved `decision.availableAt` on `ContinuationViewDecision` for airing-weekly continuation states in `ContinueWatchingService.toViewDecision(...)`.
- Updated `projectionFromViewDecision(...)` so airing-weekly view decisions keep `availableAt` when mapped to the `upcoming` projection.
- Added regression coverage for `titleDecision(...).availableAt` and `projectionFromViewDecision(...)` on an airing-weekly decision.

### Focused Review-Fix Test Results

- GREEN: `bun run --cwd apps/cli test:file test/unit/services/continuation/continue-watching-service.test.ts test/unit/services/continuation/continuation-policy.test.ts test/unit/app/launch-entry.test.ts` passed with 24 tests and 0 failures.
