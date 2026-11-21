# Split `DownloadService.ts` into focused download modules

## Status

- **Status**: READY (line-count ratchet active at 3,087 lines)
- **Category**: tech-debt / structure
- **Target**: `apps/cli/src/services/download/DownloadService.ts` (3,087 lines)

## Why this matters

`DownloadService.ts` combines queue orchestration with recovery, `yt-dlp` process
execution, artifact publication/ffprobe validation, subtitle sidecar downloads,
and pure failure classification in one 3,087-line module. Extracting those
clusters into sibling modules under `apps/cli/src/services/download/` keeps
`DownloadService` focused on queue scheduling and public lifecycle APIs without
changing external behavior.

## Extraction seams (verified against `DownloadService.ts`)

1. **`download-recovery.ts`** — recovery, sidecar repair, and shutdown pausing:
   - `repairRepairableSidecars` (`:697`)
   - `pauseActiveJobsForShutdown` (`:1323`)
   - `resumeEligiblePausedJobs` (`:2352`) and `reconcileInterruptedJobs` (`:2362`)
2. **`ytdlp-runner.ts`** — stream resolution, `yt-dlp` process spawning, and progress tracking:
   - `executeYtDlpDownload` (`:1581`)
3. **`download-finalize.ts`** — artifact publication, `ffprobe` validation, and final job status persistence:
   - `publishClaimedArtifact` (`:1470`)
   - `validateCompletedArtifact` (`:1940`) and `validateCompletedArtifactInner` (`:1955`)
   - `persistCompletedDownloadWithSidecarResult` (`:2193`)
4. **`download-subtitles.ts`** — guarded subtitle sidecar fetch and metadata staging:
   - `downloadSubtitleIfAvailable` (`:2094`)
   - `resolveSubtitleLanguage` (`:3059`) and `buildRepairableSidecarResult` (`:3069`)
5. **`download-failure-analysis.ts`** — pure failure classification (zero I/O, direct unit tests):
   - `analyzeDownloadFailure` (`:2951`) and `isDiskExhaustionMessage` (`:3039`)
   - Re-export `analyzeDownloadFailure` from `DownloadService.ts` if existing callers or tests import it from there.

## Constraints and verification

- Keep `DownloadService`'s public API and job state-machine transitions unchanged.
- Extract one seam at a time; run `bun run typecheck --force`, `bun run lint`, and `bun run test --force` after each slice.
- Lower the `DownloadService.ts` pin in `apps/cli/test/unit/architecture/file-size-ratchet.test.ts` as each slice lands.
