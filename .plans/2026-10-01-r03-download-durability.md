# R03 — Durable download ownership and artifact cleanup

Status: READY FOR ASSIGNMENT; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Keep one durable worker per job, schedule due work fairly, and retain ownership until every deletion succeeds.
**Architecture:** SQLite owns claims/eligibility; service coordinates transitions; process runner owns a job's staging artifacts; UI receives truthful deletion results.
**Tech stack:** Bun, SQLite, yt-dlp, filesystem/process ports, two-connection integration fixtures.
**Spec:** Audit A04/A20/A21/A22; [offline contract](../.docs/download-offline-onboarding.md), [concurrent ownership ADR](../.docs/adr/0003-concurrent-instance-state-ownership.md).
**Dependencies:** Reserve the next unreleased data migration with coordinator. R04/R08 consume the frozen API.

## Review focus

1. A losing worker cannot pause/requeue/finish another worker's claim.
2. Due eligibility is applied before the query limit, so deferred jobs cannot starve ready jobs.
3. Delete success means owned media and sidecars are gone; failures retain management/cleanup ownership.
4. Pause/retry retains valid owned partials; terminal deletion removes yt-dlp .part/.ytdl and fragment artifacts safely.
5. Destination collisions, disk exhaustion, path loss, cancellation and restart preserve recoverable state.

## Shared contract to reserve before implementation

Coordinator approves names/serialization with storage and existing ports; R04/R08 consume the same result:

```ts
type DownloadClaimRef = {
  readonly jobId: string;
  readonly ownerToken: string;
  readonly generation: number;
};
type DownloadDeleteResult =
  | { readonly status: "deleted"; readonly jobId: string }
  | {
      readonly status: "retained";
      readonly jobId: string;
      readonly reason: "artifact-removal-failed" | "owned-by-other-worker";
      readonly remainingPaths: readonly string[];
    };
```

remainingPaths are internal cleanup diagnostics, never raw paths in analytics/public logs. A retained row with partly removed artifacts is marked unavailable for playback and remains visible for cleanup retry. ENOENT counts as absent; permission/IO errors do not. Do not overload “cancelled” to mean deleted.

## R03.1 — Claims and due queue (A20/A21)

Allowed edits: `packages/storage/src/repositories/download-jobs.ts`, reserved `packages/storage/src/migrations.ts`, `apps/cli/src/services/download/DownloadService.ts`; existing storage admission and CLI download service tests; create `packages/storage/test/download-job-ownership.test.ts`.

- [ ] Seed 50 queued jobs whose nextRetryAt is in the future and job 51 due now. Execute one tick; job 51 must run. Anchor the injected clock after seeded dates.
- [ ] Hold worker B's preflight; worker A claims and starts; release B with a preflight error. B must not change A's running state or create another process. Repeat with success and restart using two SQLite connections to the same temporary DB.
- [ ] Query durable eligibility in SQL before LIMIT: queued status and due retry time. Stable ordering breaks ties. Services supply any explicit policy filters as data; storage must not read app config/provider runtime. If service-only exclusions remain, scan bounded keyset batches so excluded rows cannot hide due work. Do not fetch an arbitrary prefix and filter it afterward.
- [ ] Claim before expensive side effects or make every preflight outcome conditional on the unchanged preclaim state. Preserve the current markRunning CAS; extend fencing to pause, failure, completion, cancellation, retry and claim release.
- [ ] Persist ownerToken and generation; every worker transition compares them. User cancellation goes through an explicit intent path, not an unguarded worker update.
- [ ] Define stale-claim recovery using durable ownership/expiry and actual child/process containment. A lease expiring does not magically terminate an old writer: each claimant uses a unique staging directory; only the current claim may activate the destination.
- [ ] Update ADR0003 to reflect current download CAS and remaining external sync limitations, coordinating R05. Test each competing transition and recovery from an abandoned claim.

## R03.2 — Artifact ownership and truthful deletion (A04/A22)

Allowed edits: `apps/cli/src/services/download/DownloadService.ts`, `apps/cli/src/services/ytdlp/YtDlpService.ts`, `packages/storage/src/repositories/download-jobs.ts`/`offline-assets.ts` under coordinator review; cleanup and yt-dlp tests. Optional create: `apps/cli/src/services/download/download-artifact-manifest.ts` if manifest ownership is chosen; a job-owned staging directory does not require another manifest abstraction.

- [ ] Inject EACCES when removing the completed media. Assert retained result, no deleted event, retained row, visible retry and unavailable asset when appropriate. Repeat mixed success: media removed, subtitle failure; retain cleanup owner.
- [ ] Produce actual yt-dlp-style .part/.ytdl/fragment files in a temporary owned directory. Pause/retry retains them; terminal delete removes them; failed cleanup retains ownership. Avoid a subprocess sleep to synchronize: use a controlled completion/abort port.
- [ ] Use a job/claim-owned staging directory or persisted manifest rather than an unrestricted glob near the final destination. Validate paths against that ownership root and reject traversal/symlink escape. Never delete neighboring user files.
- [ ] Stop/settle the owned process before cleaning files. Stage deletion intent durably; remove physical artifacts; confirm absence; then remove asset/job metadata and emit deleted. Crash/restart replays cleanup idempotently. Define any new cleanup state in schema, row mapping and recovery readers.
- [ ] Commit the final artifact only after validation and claim ownership check. Do not overwrite an existing user destination; keep the final media/subtitle activation protocol recoverable if a rename fails.
- [ ] Update all deletion callers/events to consume DownloadDeleteResult. Coordinate R08 shell work; a caller cannot announce success on retained.

## R03.3 — Extract only after characterization

Use [boundary/adaptive owner](./boundary-hardening-and-adaptive-downloads.md). Current concurrency is already adaptive; its historical sequential/16-fragment observations must be reconciled before execution.

- [ ] After regressions pass, separate due queue/claim repository, job execution, process/artifact mechanics and pure capacity/failure policies only where a stable interface removes duplication. Keep CLI-local services until a second real consumer exists.
- [ ] Audit OfflineMaintenanceService's actual scheduling/callers. Wire a necessary repair path or remove unreachable scaffolding with consumer evidence; do not create a perpetual scheduler merely to use an existing class.
- [ ] Preserve configured 1–5 worker bounds and total fragment/resource budgets; measure under R09 instead of raising concurrency optimistically.

## Verification and closure

```sh
bun run --cwd packages/storage test
bun run --cwd packages/storage typecheck
bun run --cwd apps/cli test:file -- test/unit/services/download test/unit/services/offline/offline-repair-outcome.test.ts
bun run --cwd apps/cli typecheck
```

Update download/offline docs and ADR under one owner. Run runbook gates. Native qualification covers installed yt-dlp, cancellation/restart, full disk/path loss and Windows file-lock behavior. Report local fixtures and actual subprocess evidence separately. Freeze exported results/migration SHA before R04/R08 begin.
