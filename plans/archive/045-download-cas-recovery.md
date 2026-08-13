# Plan 045: Make download commit and recovery state-safe

> **Drift check:** `git diff --stat 53752c4b..HEAD -- apps/cli/src/services/download/DownloadService.ts apps/cli/test/unit/services/download packages/storage/src/repositories/download-jobs.ts packages/storage/test/storage.test.ts`

**Goal:** A download job has one durable owner, validates before publication, and
recovers a crash-after-rename without redownloading or orphaning a valid artifact.

## Status

- **Priority:** P0
- **Effort:** M
- **Risk:** HIGH
- **Planned at:** `53752c4b`, 2026-08-14

## Invariants

- Claiming is a SQLite compare-and-set from `queued` to `running`; an in-memory set
  is only a same-process optimization.
- A downloaded temp artifact validates before it becomes the public output.
- Reconciliation leaves no expired interrupted job in `running` and never takes a
  freshly heartbeating lease from another Kunai process.
- A valid output paired with an interrupted `running` job is adopted and completed;
  it is never downloaded again.
- An invalid interrupted output is removed before the job is retried or failed.
- Existing completed output is never deleted merely because another claim or commit
  loses its state transition.

## Tasks

- [x] Make `DownloadJobsRepository.markRunning` update only a `queued` row and
      report whether the claim succeeded.
- [x] Add repository tests proving a second process cannot claim a running or
      completed job.
- [x] Have workers stop before network/process work when the durable claim loses.
- [x] Validate the temp artifact before rename and reuse that validation after
      publication.
- [x] Make interrupted-job reconciliation asynchronous, lease-aware, and distinguish
      valid output, invalid output, and missing output.
- [x] Add a crash-after-rename fixture proving valid output is adopted as completed
      without starting `yt-dlp`.
- [x] Add an invalid-output fixture proving the artifact is removed and the job is
      scheduled according to its retry budget.
- [x] Add a fresh-lease fixture proving recovery does not interfere with another
      process's active artifact or temp file.
- [x] Scope temp cleanup to the expired job so one stale row cannot delete a
      fresh owner's temp artifact in the same directory.
- [x] Preserve shutdown pause, sidecar repair, progress, and ordinary completion
      behavior.

## Verification

```sh
bun run --cwd packages/storage test -- storage.test.ts
bun run --cwd apps/cli test -- test/unit/services/download/download-service.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```
