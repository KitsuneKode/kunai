# DownloadService decomposition — process management vs yt-dlp execution

Status: TODO — written for audit-4 follow-up. 2316 lines in one file
(`apps/cli/src/services/download/DownloadService.ts`, measured this pass).

## Why this matters

The class mixes two different lifecycles:

- **Process/queue management** — admission, scheduling, recovery:
  `enqueue`, `selectEligibleQueuedJob`, `resumeEligiblePausedJobs`,
  `reconcileInterruptedJobs`, `rescheduleInterruptedJob`, `startHeartbeat`,
  `collectActiveProcesses`, `cancel`, disk admission (`statfs`,
  `evaluateStorageForPath`, `estimateActiveReservationBytes`,
  `offlineFreeSpaceReserveBytes`), artifact validation and repair
  (`validateCompletedArtifact`, `markArtifactValidated`,
  `repairArtifactMetadata`, `persistValidatedArtifactMetadata`).
- **yt-dlp execution** — the actual download run, subtitle fetch
  (`downloadSubtitleIfAvailable`), offline artwork (`prepareOfflineArtwork`),
  sidecar repair (`repairSidecars`).

Bugs in the first half are lifecycle/crash-recovery bugs; bugs in the second
are provider-network bugs. They get reviewed, tested, and reasoned about
differently — one 2.3k-line file makes every change a merge-conflict and
every characterization test a monster.

## Scope sketch

1. `download/` directory already exists — split along the seam above:
   `DownloadQueueService` (admission/scheduler/recovery/heartbeat) and
   `DownloadRunner` (yt-dlp invocation + subtitle/artwork sidecars). Keep the
   public `DownloadService` facade stable for callers this cycle.
2. Move-first candidates are the pure-ish helpers with no process state:
   `resolveOutputPath`, `resolveDefaultDownloadDirectory`,
   `formatDiskExhaustedMessage`, `formatInsufficientDiskMessage`,
   `downloadTitleAliases`.
3. Characterization test first — the download lifecycle is crash-recovery
   sensitive (claim/lease/recover). Net the current behavior before the split,
   not after.
4. Coordinate with `boundary-hardening-and-adaptive-downloads.md` — its
   adaptive-download review will land in the same file; whoever goes second
   rebases.

## Evidence

- `apps/cli/src/services/download/DownloadService.ts` — 2316 lines; method
  inventory in the split list above (grep of `private`/`async` methods).
