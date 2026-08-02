# Download Artifact Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make downloads recoverable and truthful when optional artifacts such as subtitles or artwork are missing.

**Architecture:** Treat video as the required artifact and subtitles/artwork/metadata as separately tracked sidecars. Missing optional sidecars should produce notes and repair actions, not poison a valid video download.

**Tech Stack:** `packages/storage`, `apps/cli/src/services/download`, download panels.

---

## Agent Tracking Header

```text
SLICE_ID: P5
SLICE_STATUS: implemented
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-05-19
SLICE_CURRENT_TASK: none
SLICE_BLOCKERS: none
```

## File Ownership

Modify:

- `packages/storage/src/repositories/download-jobs.ts`
- `packages/storage/src/migrations.ts`
- `packages/storage/test/storage.test.ts`
- `apps/cli/src/services/download/DownloadService.ts`
- `apps/cli/test/unit/services/download/download-service.test.ts`
- `apps/cli/test/unit/services/download/subtitle-artifact-path.test.ts`
- download panel/status files under `apps/cli/src/app-shell/` only after service tests pass.

Do not change provider resolution in this slice.

## Target States

- `completed`: required video and required sidecars are ready.
- `completed-with-notes`: required video is ready, optional sidecars are missing.
- `repairable`: required video is ready, expected sidecars failed and can be retried.
- `failed`: required video failed.
- `aborted`: user or shutdown aborted the job.

## Tasks

### P5-T1: Expand Storage Statuses Additively

- [x] Extend `DownloadJobStatus` with `completed-with-notes` and `repairable`.
- [x] Extend artifact status with `optional-missing`, `expected-missing`, `failed`, and `not-applicable`.
- [x] Add nullable repair metadata through a new migration.
- [x] Add storage tests for old rows and new statuses.
- [x] Run `bun run --cwd packages/storage test`.
- [x] Commit with message `feat(storage): add repairable download artifact states`.

### P5-T2: Teach DownloadService Sidecar Semantics

- [x] Mark hardsub/no-external-subtitle as `not-applicable` or `optional-missing`.
- [x] Mark expected soft subtitle failure as `repairable` without redownloading video.
- [x] Keep required video failure as `failed`.
- [x] Add service tests for hardsub, softsub missing, optional artwork missing, and repair retry.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(downloads): preserve video when sidecars fail`.

### P5-T3: Surface Recovery Clearly

- [x] Update `/downloads` or download panel copy to separate video failure from sidecar notes.
- [x] Add diagnostics copy for repairable sidecars.
- [x] Run `bun run --cwd apps/cli test:unit`.
- [x] Commit with message `feat(downloads): show repairable sidecar status`.

## Implementation Notes

- Storage migration `015_data_download_jobs_repair_metadata` is additive and does not rewrite existing rows.
- `DownloadService.retry()` repairs `repairable` and `completed-with-notes` sidecars without re-running `yt-dlp`; only ordinary failed/aborted jobs are requeued for a full download.
- `/downloads`, diagnostics, and offline-library copy now distinguish required video failure from optional sidecar notes.

## Stop Conditions

- Stop if a migration would rewrite or delete existing download rows.
- Stop if a video download failure could be reported as completed.
- Stop if subtitle absence is ambiguous between hardsub-not-needed and expected-softsub-missing.

## Acceptance Tests

- Hardsub video does not fail because no external subtitle exists.
- Softsub expected-missing can be repaired without redownloading video.
- Restart after crash can continue or repair from artifact state.
