# Download, Offline Library, And Onboarding Plan

Status: in progress

This plan carries forward the approved download/offline/onboarding design into the canonical `.plans` tree.

## Goal

Add local downloads, an offline library, and a first-run/setup flow without slowing normal search or playback.

## Non-Negotiables

- No startup network probe.
- No download work unless the user explicitly opts in.
- No corrupt file should look complete.
- Download state must persist in SQLite.
- UI renders state; services own process/file mechanics.
- `ffmpeg` is optional for playback and required only for downloads.

## Slice 1: Capability And Config

- Add flat config fields:
  - `onboardingVersion`
  - `downloadsEnabled`
  - `downloadPath`
  - `downloadOnboardingDismissed` (or rename to `suppressOfflinePrompt` if we standardize later)
- Add a pure `FeatureGate` service for `downloads` and `autoSkip`.
- Extend dependency checks to detect `ffmpeg` without blocking playback.
- Add unit tests for config normalization and feature-gate decisions.

Current progress: download config fields (`onboardingVersion` included), non-blocking `ffmpeg` capability detection, pure download feature gate, persisted `download_jobs` table/repository (with runtime lifecycle and intent fields), retry/reconcile-capable `DownloadService`, `/downloads` job management panel, CLI `--setup`, `--download`, and validated `--offline` listing are implemented.

## Slice 2: Download Persistence

- Add a `download_jobs` table through `@kunai/storage`.
- Add repository methods for enqueue, update progress, complete, fail, abort, and list by title.
- Add migration/idempotency tests.

Current progress: `download_jobs` now includes runtime lifecycle columns (`attempt`, `max_attempts`, `next_retry_at`, heartbeat/failure metadata), durable download intent fields, repository retry/requeue/pause/failed/running queries, and storage tests covering queue lifecycle.

## Slice 3: Download Service

- Add `DownloadService` with bounded concurrency.
- Spawn `ffmpeg` with stream headers and `-progress pipe:1`.
- Write to `.tmp.*` and rename only on clean exit.
- Implement abort cleanup, retry backoff, and restart reconciliation.
- Add process/output parser tests with fake subprocess ports.

Current progress: in-process worker now owns active ffmpeg process handles, supports real cancellation with SIGTERM-to-SIGKILL escalation, pauses active jobs on app shutdown without spending retry budget, parses ffmpeg progress output, schedules bounded retry backoff, re-resolves stale stream URLs before processing, validates completed artifacts, and reconciles stale running jobs on startup. Dedicated unit tests cover gate reject, success, retry scheduling, artifact validation, stream re-resolve, destination override, pause, and cancellation behavior.

## Slice 4: Shell Integration

- Add a non-destructive download action only when a playable stream exists.
- Show confirmation before starting large/unknown-size downloads.
- Surface progress in a bounded shell panel or notification rail.
- Add quit behavior for active downloads: keep, wait, or cancel.

Current progress: download enqueue now checks gates before queue insertion (truthful user feedback), command palette includes `/download` and `/downloads`, browse/download-only mode can queue without launching mpv, shell panel supports retry/cancel/delete actions, completed jobs expose play/re-download/delete actions, diagnostics panel includes failed counts, and quit/Ctrl+C/signal flow uses the download pause cleanup path.

## Slice 5: Offline Library

- Add `--offline` argument parsing after the service layer is ready.
- Build a library screen from completed `download_jobs`.
- Reuse playback launch policy for local files.
- Validate file presence before playback.

Current progress: `--offline` and `/library` now validate file readability/shape (`ready`, `missing`, `invalid-file`), and completed artifacts can be played, retried, revealed, or deleted from the shell.

## Slice 6: Onboarding

- Add `--setup`.
- Run first-run setup only when `onboardingVersion` is absent or stale.
- Keep setup skippable except for required `mpv`.
- Add optional shell completion generation after CLI flag surface stabilizes.

## Deferred

- Background daemon.
- Batch downloads.
- YouTube downloads.
- Cloud download queue.

## Canonical Doc

See [.docs/download-offline-onboarding.md](../.docs/download-offline-onboarding.md).
