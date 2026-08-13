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
- Startup reconciliation leaves no interrupted job in `running`.
- A valid output paired with an interrupted `running` job is adopted and completed;
  it is never downloaded again.
- An invalid interrupted output is removed before the job is retried or failed.
- Existing completed output is never deleted merely because another claim or commit
  loses its state transition.

## Tasks

- [ ] Make `DownloadJobsRepository.markRunning` update only a `queued` row and
      report whether the claim succeeded.
- [ ] Add repository tests proving a second process cannot claim a running or
      completed job.
- [ ] Have workers stop before network/process work when the durable claim loses.
- [ ] Validate the temp artifact before rename and reuse that validation after
      publication.
- [ ] Make startup interrupted-job reconciliation asynchronous and distinguish
      valid output, invalid output, and missing output.
- [ ] Add a crash-after-rename fixture proving valid output is adopted as completed
      without starting `yt-dlp`.
- [ ] Add an invalid-output fixture proving the artifact is removed and the job is
      scheduled according to its retry budget.
- [ ] Preserve shutdown pause, sidecar repair, progress, and ordinary completion
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
