# Offline Continuity And Smart Continue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicit, capacity-safe offline-continuation platform and smart Continue read model without adding hidden provider, catalog, or filesystem work.

**Architecture:** Preserve `download_jobs` as the attempt/work ledger while adding durable offline asset and per-title policy storage, bounded runway/storage-budget services, and extending the existing continuation and release-reconciliation seams. Provider work is admitted only through confirmed download intent or an enrolled offline-title policy; UI surfaces consume local or cached projections.

**Tech Stack:** Bun, TypeScript, Ink, SQLite via `@kunai/storage`, existing service/container patterns, `bun:test`.

---

## Implementation Status

**Last reconciled:** 2026-05-24

Landed in scoped commits:

- `74074cdf feat: establish capacity-safe offline asset foundation`
- `e7fa5d18 feat: fill enrolled offline continuation runway safely`
- `8e6ae10 feat: add power-aware smart continuation`

Implemented:

- Hidden passive work removed from download-only, browse enrichment, and streamed playback auto-download paths.
- Download admission now has an indexed episode-intent lookup before enqueueing duplicate work.
- Durable offline asset, sidecar/artwork, per-title policy, and maintenance job storage exists.
- Completed download jobs lazily adopt into the offline asset model and browse enrichment reads recorded status without filesystem validation.
- Storage budget policy blocks automatic runway work when local capacity is too low.
- Offline runway refill is title-enrollment driven, scheduler-deduped, and catalog/cache based; it does not scan all history or call providers from UI paths.
- Offline maintenance is persisted and local-first; Power Saver suppresses optional repair/artwork work.
- Continue projection can surface offline-ready next episodes and cached `N new` badges while preserving unfinished resume precedence.
- Release reconciliation candidates carry attention priority for selected, enrolled, visible, stale, and dormant titles.
- Power Saver setting suppresses passive release reconciliation, next-episode prefetch, recommendation warming, runway refill, and optional artwork preparation.
- Manual download-only actions now present a confirmation profile before enqueue, optionally enroll
  a title for bounded offline continuation, and no longer query anime provider episode lists merely
  to reach confirmation. CLI `--download` also defers anime provider-native mapping until after
  the user confirms the profile.
- History's Continue Watching section now consumes bulk local/cached continuation projections,
  ranks downloaded-next and cached `N new` rows without provider/filesystem work, reads only the
  next ready offline candidate per title, and keeps local playback copy explicit through `/library`.
- History activation and queue shortcuts target the projected episode instead of the prior watched
  anchor when an offline-ready or catalog-new projection is selected.
- Support bundles now summarize offline runway, capacity pauses, and bounded maintenance passes
  through redacted diagnostics taxonomy entries.

Remaining before calling the full platform complete:

- Manual download confirmation currently reviews inherited playback preferences; editable subtitle,
  artwork, destination, and cleanup profiles remain a dedicated premium-management pass.
- Offline library/download-manager UI still needs title-level cleanup policy editing and a direct
  History-row local-play action from the History surface; low-space queue copy and repair affordances
  are now explicit.
- Manual product smoke with real mpv/download/offline playback remains release-time verification, not a deterministic unit gate.

---

## Read First

Before changing code, read these in order:

1. [offline-continuity-and-smart-continue-platform.md](./offline-continuity-and-smart-continue-platform.md) - approved product and architecture decisions.
2. [architecture.md](../.docs/architecture.md) and [runtime-boundary-map.md](../.docs/runtime-boundary-map.md) - runtime ownership and side-effect boundaries.
3. [engineering-guide.md](../.docs/engineering-guide.md) and [testing-strategy.md](../.docs/testing-strategy.md) - service extraction and verification conventions.
4. [ux-architecture.md](../.docs/ux-architecture.md) and [download-offline-onboarding.md](../.docs/download-offline-onboarding.md) - shell and offline behavior.
5. [playback-timing-and-aniskip.md](../.docs/playback-timing-and-aniskip.md) - downloaded timing metadata and autoskip behavior.
6. [background-release-reconciliation.md](./background-release-reconciliation.md) and [binge-playback-handoff-provider-health.md](./binge-playback-handoff-provider-health.md) - already-landed seams this feature extends.
7. [plan-implementation-truth.md](./plan-implementation-truth.md) - code-versus-plan truth before claiming a slice complete.

## Execution Rules

- Implement tasks in order. Every task is independently testable and gets its own scoped commit.
- Do not call providers from render paths, typing, row movement, browse enrichment, history projection, calendar projection, or passive release reconciliation.
- Do not call catalog APIs from rendering. UI may read cache/projections; one coordinator may refresh due data in the background.
- Do not make downloaded video replacement, fresh provider resolve, or new runway work happen because a legacy config value happened to be non-`off`.
- Do not expose stream URLs, provider headers, or raw resolve payloads in diagnostics or UI.
- Do not change global provider preferences because an offline download or fallback succeeded.
- Do not make manual `Next` act like auto-next. Existing explicit playback intent and timing/source rules remain authoritative.
- Automated tests use fake catalog/provider/loaders and temporary local files only. Live provider or proxy smoke remains an explicit manual release action.
- Other agents may be changing Sakura/UI files. Read current contents before editing and commit only files in the active task.

## Existing Seams To Extend

| Concern             | Existing seam                                                                            | Direction                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Download attempts   | `DownloadService`, `DownloadJobsRepository`                                              | Keep as job ledger; remove unbounded/scanning admission work.                        |
| Offline playback    | `OfflineLibraryService`, `OfflineLibraryEngine`, `SourceSelectionEngine`                 | Move durable library truth to assets while preserving local-only behavior.           |
| Continue projection | `ContinuationProjectionService`, `continuation-policy.ts`, `ContinuationEngine`          | Extend; do not create a competing smart-continue service.                            |
| Release state       | `ReleaseReconciliationService`, `ReleaseReconciliationPlanner`, `release_progress_cache` | Add attention priority and enrolled-title triggers without provider traffic.         |
| Background work     | `BackgroundWorkScheduler`                                                                | Reuse coalescing queue and explicit lanes for runway/maintenance.                    |
| Shell surfaces      | `panel-data.ts`, `root-overlay-shell.tsx`, `library-shell.tsx`, `workflows.ts`           | Project actions/status from services; do not calculate network policy in components. |
| Configuration       | `ConfigService`, `ConfigStore`, `ConfigServiceImpl`                                      | Add global bounds/modes; keep per-title runway authority in SQLite.                  |

## File Ownership Map

The following files are expected to be added or modified. If implementation reveals a smaller established seam, prefer it and update this plan plus the truth index in the same task.

### Storage And Persistence

- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/src/repositories/download-jobs.ts`
- Create: `packages/storage/src/repositories/offline-assets.ts`
- Create: `packages/storage/src/repositories/offline-title-policies.ts`
- Create: `packages/storage/src/repositories/offline-maintenance-jobs.ts`
- Test: `packages/storage/test/storage.test.ts`

### Services And Domain

- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/download/download-scope-policy.ts`
- Create: `apps/cli/src/services/download/StorageBudgetPolicy.ts`
- Create: `apps/cli/src/services/offline/OfflineAssetService.ts`
- Create: `apps/cli/src/services/offline/OfflineRunwayService.ts`
- Create: `apps/cli/src/services/offline/OfflineMaintenanceService.ts`
- Create: `apps/cli/src/services/offline/offline-runway-policy.ts`
- Modify: `apps/cli/src/services/offline/OfflineLibraryService.ts`
- Modify: `apps/cli/src/services/offline/offline-sync-policy.ts`
- Modify: `apps/cli/src/services/catalog/ResultEnrichmentService.ts`
- Modify: `apps/cli/src/services/continuation/ContinuationProjectionService.ts`
- Modify: `apps/cli/src/services/continuation/continuation-policy.ts`
- Modify: `apps/cli/src/domain/continuation/ContinuationEngine.ts`
- Modify: `apps/cli/src/services/release-reconciliation/types.ts`
- Modify: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationPlanner.ts`
- Modify: `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`

### Application And Shell

- Modify: `apps/cli/src/app/DownloadOnlyPhase.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/library-shell.tsx`
- Modify: `apps/cli/src/app-shell/download-manager-shell.tsx`
- Modify only if needed by the projection: `apps/cli/src/app-shell/browse-idle-actions.ts`

### Tests

- Create: `apps/cli/test/unit/app/download-only-phase.test.ts`
- Modify: `apps/cli/test/unit/services/download/download-service.test.ts`
- Create: `apps/cli/test/unit/services/download/storage-budget-policy.test.ts`
- Modify: `apps/cli/test/unit/services/offline/offline-library-service.test.ts`
- Create: `apps/cli/test/unit/services/offline/offline-asset-service.test.ts`
- Create: `apps/cli/test/unit/services/offline/offline-runway-policy.test.ts`
- Create: `apps/cli/test/unit/services/offline/offline-runway-service.test.ts`
- Modify: `apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts`
- Modify: `apps/cli/test/unit/services/continuation/continuation-policy.test.ts`
- Modify: `apps/cli/test/unit/domain/continuation/continuation-engine.test.ts`
- Modify: `apps/cli/test/unit/services/release-reconciliation/release-reconciliation-planner.test.ts`
- Modify: `apps/cli/test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts`
- Modify: `apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts`
- Modify: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`
- Modify: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`

---

## Task 0: Remove Hidden Or Wasteful Work Before Adding Capability

**Why first:** Current code can discover anime episodes before download eligibility is known, validates many local files during browse enrichment, and lets ordinary streamed playback launch auto-download. These violate the approved authority/cost boundary today.

**Files:**

- Create: `apps/cli/test/unit/app/download-only-phase.test.ts`
- Modify: `apps/cli/src/app/DownloadOnlyPhase.ts`
- Modify: `apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts`
- Modify: `apps/cli/src/services/catalog/ResultEnrichmentService.ts`
- Modify: `apps/cli/src/services/offline/OfflineLibraryService.ts`
- Modify: `apps/cli/test/unit/app/playback-phase-events.test.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Modify: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`
- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/library-shell.tsx`

- [ ] **Step 0.1: Write a failing no-provider-before-gate test.**

Create a focused test with a disabled download feature and a provider whose `listEpisodes` increments a counter:

```ts
test("does not discover episodes when download enqueue is disabled", async () => {
  let episodeCalls = 0;
  const result = await executeDownloadOnlyWith({
    eligibility: { allowed: false, code: "disabled", reason: "disabled" },
    provider: {
      listEpisodes: async () => {
        episodeCalls += 1;
        return [];
      },
    },
  });

  expect(result.value).toBe("back");
  expect(episodeCalls).toBe(0);
});
```

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/app/download-only-phase.test.ts
```

Expected: FAIL because `DownloadOnlyPhase` currently calls `provider.listEpisodes()` before `getEnqueueEligibility()`.

- [ ] **Step 0.2: Move eligibility ahead of any episode/provider work.**

In `DownloadOnlyPhase.execute`, fetch state only as necessary to emit feedback, then return on rejected eligibility before obtaining a provider or discovering episodes:

```ts
const eligibility = container.downloadService.getEnqueueEligibility();
if (!eligibility.allowed) return rejectDownloadOnlyEnqueue(...);

const provider = container.providerRegistry.get(state.provider);
const animeEpisodes = isAnime && provider?.listEpisodes
  ? await provider.listEpisodes(...).catch(() => null)
  : undefined;
```

Run the new test again and retain existing download tests.

- [ ] **Step 0.3: Replace browse-time filesystem validation with a persisted-status peek.**

Change the enrichment dependency from `validateCompletedArtifacts` to a read-only bounded method, initially implemented against currently persisted artifact status and later backed by `offline_assets`:

```ts
readonly offlineLibraryService: Pick<OfflineLibraryService, "peekRecordedArtifactStatuses">;

const offlineEntries = await this.deps.offlineLibraryService.peekRecordedArtifactStatuses(
  missing.map((result) => result.id),
);
```

Test assertions:

```ts
test("does not validate files while enriching browse results", async () => {
  let peekCalls = 0;
  const service = new ResultEnrichmentService({
    historyStore: { getAll: async () => ({}) },
    offlineLibraryService: {
      peekRecordedArtifactStatuses: async () => {
        peekCalls += 1;
        return [];
      },
    },
  });
  await service.enrichResults([result()]);
  expect(peekCalls).toBe(1);
});
```

Delete the test stubs that teach browse enrichment to run `validateCompletedArtifacts`.

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/catalog/result-enrichment-service.test.ts test/unit/services/offline/offline-library-service.test.ts
```

- [ ] **Step 0.4: Disable streamed-playback auto-download authority.**

Delete the post-stream-playback enqueue branch in `PlaybackPhase`; online playback may expose an explicit action later, but cannot itself create download work. Keep manual `/download` and existing downloaded playback behavior intact.

Add a test around a completed online playback event:

```ts
expect(downloadService.enqueue).not.toHaveBeenCalled();
expect(downloadService.processQueue).not.toHaveBeenCalled();
```

The existing `autoDownload` config fields are legacy input. On load, normalize persisted `"next"`/`"season"` to inactive behavior and expose one clear migration notice that the old streaming-driven automation is disabled until the user explicitly enrolls a title; never translate it into enrolled title policies. In the UI replace the toggle/cycle control with copy directing users to future per-title `Keep watching offline` enrollment.

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/app/playback-phase-events.test.ts test/unit/services/persistence/ConfigServiceImpl.test.ts test/unit/app-shell/overlay-panel.test.ts
```

- [ ] **Step 0.5: Commit the authority/cost correction.**

```sh
git add apps/cli/src/app/DownloadOnlyPhase.ts apps/cli/src/services/catalog/ResultEnrichmentService.ts apps/cli/src/services/offline/OfflineLibraryService.ts apps/cli/src/app/PlaybackPhase.ts apps/cli/src/services/persistence apps/cli/src/app-shell/overlay-panel.tsx apps/cli/src/app-shell/library-shell.tsx apps/cli/test/unit
git commit -m "fix: remove implicit offline work from passive flows"
```

---

## Task 1: Add Indexed Download Admission Without Episode-By-Episode Scans

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/repositories/download-jobs.ts`
- Modify: `packages/storage/test/storage.test.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/test/unit/services/download/download-service.test.ts`

- [ ] **Step 1.1: Write failing repository and service tests for bounded admission.**

Cover an active duplicate, a completed playable duplicate, and a different episode:

```ts
expect(repo.findBlockingEpisodeIntent({ titleId: "t", season: 1, episode: 2 })?.id).toBe("ready");
expect(repo.findBlockingEpisodeIntent({ titleId: "t", season: 1, episode: 3 })).toBeUndefined();
```

At service level, assert `enqueue` rejects duplicate intent without calling resolve/downloader dependencies.

Run:

```sh
bun run --cwd packages/storage test -- test/storage.test.ts
bun run --cwd apps/cli test:unit -- test/unit/services/download/download-service.test.ts
```

Expected: FAIL because `hasJobForEpisode` currently materializes up to 1,000 jobs and there is no indexed lookup.

- [ ] **Step 1.2: Add the query-supporting index in migration `016_data_download_job_episode_intent_index`.**

```sql
CREATE INDEX IF NOT EXISTS idx_download_jobs_episode_intent
  ON download_jobs(title_id, media_kind, season, episode, status, updated_at DESC);
```

Add a repository method that selects one blocking row:

```ts
findBlockingEpisodeIntent(input: {
  titleId: string;
  season?: number;
  episode?: number;
}): DownloadJobRecord | undefined;
```

Blocking statuses remain `queued`, `running`, `completed`, `completed-with-notes`, and `repairable`. A later explicit replace/redownload action must be deliberate, not an accidental duplicate enqueue.

- [ ] **Step 1.3: Route service admission through the repository lookup.**

Replace `listActive(500)`/`listCompleted(500)` scans. Make `enqueue` itself check the indexed intent before provider resolution, so UI callers cannot bypass the cost/authority check.

Use a single-runtime guard around admission until Task 2 makes `offline_assets` the canonical unique ready asset owner. Do not pretend this step is cross-process locking.

- [ ] **Step 1.4: Verify and commit.**

```sh
bun run --cwd packages/storage test -- test/storage.test.ts
bun run --cwd apps/cli test:unit -- test/unit/services/download/download-service.test.ts
git add packages/storage/src/migrations.ts packages/storage/src/repositories/download-jobs.ts packages/storage/test/storage.test.ts apps/cli/src/services/download/DownloadService.ts apps/cli/test/unit/services/download/download-service.test.ts
git commit -m "perf: index offline download admission by episode"
```

---

## Task 2: Introduce Durable Offline Asset And Title Policy Storage

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Create: `packages/storage/src/repositories/offline-assets.ts`
- Create: `packages/storage/src/repositories/offline-title-policies.ts`
- Create: `packages/storage/src/repositories/offline-maintenance-jobs.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/storage.test.ts`
- Modify: `apps/cli/src/container.ts`

- [ ] **Step 2.1: Write failing storage contract tests.**

Tests must cover:

- one durable playable asset per canonical title/episode/profile identity;
- separately stored subtitle/timing/artwork metadata;
- per-title enrollment and runway/cleanup profile;
- maintenance job dedupe by asset and operation;
- no stream URL or provider headers in the offline asset rows.

Representative API:

```ts
const asset = assets.upsertPlayable({
  titleId: "anilist:1",
  mediaKind: "anime",
  season: 1,
  episode: 5,
  filePath: "/tmp/ep5.mp4",
  profileKey: "original:en:best",
  state: "ready",
  originJobId: "job-1",
  byteSize: 42,
  updatedAt: now,
});
expect(asset.filePath).toBe("/tmp/ep5.mp4");
expect(JSON.stringify(asset)).not.toContain("streamUrl");
```

Run:

```sh
bun run --cwd packages/storage test -- test/storage.test.ts
```

Expected: FAIL because these tables/repositories do not exist.

- [ ] **Step 2.2: Add migration `017_data_offline_library_assets`.**

Use additive tables:

```sql
CREATE TABLE IF NOT EXISTS offline_assets (
  id TEXT PRIMARY KEY,
  title_id TEXT NOT NULL,
  title_name TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  season INTEGER,
  episode INTEGER,
  profile_key TEXT NOT NULL,
  origin_job_id TEXT REFERENCES download_jobs(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  state TEXT NOT NULL,
  byte_size INTEGER,
  duration_ms INTEGER,
  last_validated_at TEXT,
  protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(title_id, media_kind, season, episode, profile_key)
);

CREATE TABLE IF NOT EXISTS offline_asset_tracks (
  asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  language TEXT NOT NULL,
  file_path TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, kind, language)
);

CREATE TABLE IF NOT EXISTS offline_asset_artwork (
  asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, kind)
);

CREATE TABLE IF NOT EXISTS offline_title_policies (
  title_id TEXT PRIMARY KEY,
  media_kind TEXT NOT NULL,
  title_name TEXT NOT NULL,
  enrolled INTEGER NOT NULL DEFAULT 0,
  runway_target INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  cleanup_json TEXT NOT NULL,
  paused_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offline_maintenance_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES offline_assets(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_maintenance_active_operation
  ON offline_maintenance_jobs(asset_id, operation)
  WHERE status IN ('queued', 'running');
```

Add indexes for title episode lookup, ready assets, enrolled title policies, and queued maintenance jobs. The partial maintenance uniqueness prevents duplicated active repair work while allowing a later explicit retry after completion or failure.

- [ ] **Step 2.3: Implement narrow repositories and exports.**

Repositories expose typed local-state methods only:

```ts
assets.findReadyForEpisodes(titleId, cursors);
assets.listTitleAssets(titleId);
assets.upsertPlayable(input);
assets.markValidation(id, state, validatedAt);
policies.get(titleId);
policies.listEnrolled(limit);
policies.upsert(input);
maintenance.enqueueUnique(input);
maintenance.listRunnable(limit);
```

Keep download provider secrets in `download_jobs` only; the asset manifest is a durable user library index, not a resolve trace.

- [ ] **Step 2.4: Wire repositories in `container.ts` without UI use yet.**

Construct repositories from the existing data DB and provide them only to subsequent services. No startup scan and no provider call is allowed during container creation.

- [ ] **Step 2.5: Verify and commit.**

```sh
bun run --cwd packages/storage test -- test/storage.test.ts
bun run --cwd packages/storage typecheck
bun run --cwd apps/cli typecheck
git add packages/storage/src packages/storage/test/storage.test.ts apps/cli/src/container.ts
git commit -m "feat: add durable offline asset and policy storage"
```

---

## Task 3: Adopt Completed Jobs Into The Manifest And Make Offline Reads Cheap

**Files:**

- Create: `apps/cli/src/services/offline/OfflineAssetService.ts`
- Modify: `apps/cli/src/services/offline/OfflineLibraryService.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/container.ts`
- Create: `apps/cli/test/unit/services/offline/offline-asset-service.test.ts`
- Modify: `apps/cli/test/unit/services/offline/offline-library-service.test.ts`
- Modify: `apps/cli/test/unit/services/catalog/result-enrichment-service.test.ts`

- [ ] **Step 3.1: Write failing adoption and cache-only read tests.**

Required behavior:

```ts
test("adopts a completed legacy job idempotently without resolving a provider", async () => {
  await service.adoptCompletedJob(job({ id: "job-1", status: "completed" }));
  await service.adoptCompletedJob(job({ id: "job-1", status: "completed" }));
  expect(assets.listTitleAssets("title-1")).toHaveLength(1);
  expect(resolveCalls).toBe(0);
});

test("browse status reads manifest state without statting video files", async () => {
  const rows = await service.peekRecordedArtifactStatuses(["title-1"]);
  expect(rows[0]?.status).toBe("ready");
  expect(fileValidationCalls).toBe(0);
});
```

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/offline/offline-asset-service.test.ts test/unit/services/offline/offline-library-service.test.ts test/unit/services/catalog/result-enrichment-service.test.ts
```

- [ ] **Step 3.2: Implement idempotent lazy adoption.**

`OfflineAssetService` owns promotion from a completed job to a library asset:

```ts
adoptCompletedJob(job: DownloadJobRecord): Promise<OfflineAssetRecord>
adoptRecentCompletedJobs(limit: number): Promise<AdoptionSummary>
peekStatusesByTitleIds(titleIds: readonly string[]): readonly OfflineStatusRow[]
validateAssetOnOpen(assetId: string): Promise<OfflineAssetRecord>
```

Rules:

- Completion may call `adoptCompletedJob` directly.
- Existing jobs are adopted only on explicit `/library` open or low-priority bounded maintenance, never startup blocking.
- Adoption does not move files, redownload, or resolve providers.
- Opening/playback validates the selected asset; browsing reads the recorded state.

- [ ] **Step 3.3: Switch library and enrichment reads to asset truth.**

`OfflineLibraryService.listCompletedEntries()` may first adopt a bounded recent legacy page, then render asset rows. `getPlayableSource()` validates the chosen local asset before returning it. `ResultEnrichmentService` consumes manifest status only.

- [ ] **Step 3.4: Promote newly completed jobs.**

After `DownloadService` has a completed playable artifact, call asset adoption once; optional sidecar repair can update track state separately.

- [ ] **Step 3.5: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/offline/offline-asset-service.test.ts test/unit/services/offline/offline-library-service.test.ts test/unit/services/catalog/result-enrichment-service.test.ts test/unit/services/download/download-service.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/offline apps/cli/src/services/download/DownloadService.ts apps/cli/src/services/catalog/ResultEnrichmentService.ts apps/cli/src/container.ts apps/cli/test/unit/services
git commit -m "feat: make offline manifest the local library read model"
```

---

## Task 4: Add Download Profile Confirmation And Capacity Admission

**Files:**

- Create: `apps/cli/src/services/download/StorageBudgetPolicy.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Modify: `apps/cli/src/app/DownloadOnlyPhase.ts`
- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Create: `apps/cli/test/unit/services/download/storage-budget-policy.test.ts`
- Modify: `apps/cli/test/unit/services/download/download-service.test.ts`
- Modify: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`
- Modify: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`

- [ ] **Step 4.1: Test disk-budget decisions as a pure policy.**

Define decisions independent of filesystem calls:

```ts
type StorageAdmission =
  | { allowed: true; estimatedBytes: number; remainingBytesAfterReserve: number }
  | { allowed: false; reason: "below-reserve" | "unknown-size-too-tight"; requiredBytes: number };
```

Tests cover:

- enough free bytes after configured reserve;
- just-below-reserve rejection;
- unknown episode size using bounded conservative estimate;
- protected/current/unwatched assets not being offered for cleanup automatically.

Run:

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/download/storage-budget-policy.test.ts
```

- [ ] **Step 4.2: Add global bounded configuration.**

Add only global defaults to JSON config:

```ts
offlineFreeSpaceReserveBytes: number;
offlineUnknownEpisodeEstimateBytes: number;
offlineDefaultRunwayTarget: number;
```

Clamp values in `ConfigServiceImpl`; do not store per-title enrollment in config. Per-title policy stays in `offline_title_policies`.

- [ ] **Step 4.3: Require a profile/space confirmation for manual download.**

Introduce a confirmation model before `DownloadOnlyPhase` enqueues:

```ts
type DownloadConfirmationProfile = {
  audioPreference: string;
  subtitlePreference: string;
  qualityPreference?: string;
  cacheArtwork: boolean;
  outputDirectory?: string;
  enrollKeepWatchingOffline: boolean;
  runwayTarget?: number;
};
```

It inherits current language preferences but is editable before confirmation. Show disk outcome and profile in the overlay; no provider resolve occurs until confirmation succeeds.

- [ ] **Step 4.4: Enforce capacity twice.**

Admission checks free space before queuing; the worker checks again before starting a queued download. A failure becomes a paused/blocked reason with one clear surface, not rapid retries.

Tests:

- manual confirmation cancelled means zero provider calls;
- low-space admission means zero provider calls;
- space disappears after enqueue means job pauses without retry storm.

- [ ] **Step 4.5: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/download/storage-budget-policy.test.ts test/unit/services/download/download-service.test.ts test/unit/services/persistence/ConfigServiceImpl.test.ts test/unit/app-shell/overlay-panel.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/download apps/cli/src/services/persistence apps/cli/src/app/DownloadOnlyPhase.ts apps/cli/src/app-shell apps/cli/test/unit
git commit -m "feat: confirm offline downloads with capacity admission"
```

---

## Task 5: Implement Enrolled Offline Runway And Cleanup Policy

**Files:**

- Create: `apps/cli/src/services/offline/offline-runway-policy.ts`
- Create: `apps/cli/src/services/offline/OfflineRunwayService.ts`
- Modify: `apps/cli/src/services/offline/offline-sync-policy.ts`
- Modify: `apps/cli/src/services/offline/OfflineLibraryService.ts`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Create: `apps/cli/test/unit/services/offline/offline-runway-policy.test.ts`
- Create: `apps/cli/test/unit/services/offline/offline-runway-service.test.ts`
- Modify: `apps/cli/test/unit/services/offline/offline-library-service.test.ts`
- Modify: `apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts`

- [ ] **Step 5.1: Write pure runway and cleanup policy tests.**

Policy input contains only local/cached facts:

```ts
const plan = planOfflineRunway({
  policy: { enrolled: true, target: 3, cleanup: { mode: "keep-last-watched", count: 1 } },
  watchedCursor: { season: 1, episode: 4 },
  readyAssets: [{ season: 1, episode: 5 }],
  availableReleasedEpisodes: [
    { season: 1, episode: 5 },
    { season: 1, episode: 6 },
  ],
  storage: { allowedNewAssets: 1 },
});
expect(plan.enqueue).toEqual([{ season: 1, episode: 6 }]);
```

Cover:

- non-enrolled title queues nothing;
- target is an upper bound, not a command to exceed disk capacity;
- only next unwatched aired/catalog-known episodes are eligible;
- currently playing, unwatched runway, pinned/protected, and repair-in-progress assets never auto-delete;
- watched cleanup honors per-title retention and grace.

- [ ] **Step 5.2: Implement `OfflineRunwayService` as the sole automatic download authority.**

Service contract:

```ts
evaluateTitle(titleId: string, trigger: "offline-playback-complete" | "policy-change" | "maintenance"): Promise<OfflineRunwayResult>
enqueueEvaluation(titleId: string, trigger: OfflineRunwayTrigger): void
```

Rules:

- Requires an enrolled policy record.
- Uses local history, manifest, release projection/catalog cache, and storage budget before any provider work.
- Enqueues provider-backed download only for approved deficits.
- Dedupes by work ID `offline-runway:${titleId}`.
- An offline-playback completion may promote the title immediately; online playback cannot.

- [ ] **Step 5.3: Add scheduler behavior and tests.**

Use an explicit lane no higher than user-requested downloads and below playback-critical work. Either add `"offline-runway"` between user-requested download and recommendations, or reuse `"user-requested-download"` with a lower per-item priority only if the scheduler already supports that cleanly.

Tests assert:

- explicit user download runs before runway fill;
- duplicate runway triggers coalesce;
- cancelled/Power Saver blocked work does not execute.

- [ ] **Step 5.4: Trigger runway only from offline continuation and settings.**

In `playCompletedDownload()` or its service-level completion callback, enqueue a runway evaluation after local history is persisted. In the settings/title action flow, enabling or editing enrollment enqueues one evaluation. Do not restore the removed online `PlaybackPhase` auto-download branch.

- [ ] **Step 5.5: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/offline/offline-runway-policy.test.ts test/unit/services/offline/offline-runway-service.test.ts test/unit/services/offline/offline-library-service.test.ts test/unit/services/background/BackgroundWorkScheduler.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/offline apps/cli/src/services/background apps/cli/src/container.ts apps/cli/src/app-shell/workflows.ts apps/cli/test/unit
git commit -m "feat: fill enrolled offline continuation runway safely"
```

---

## Task 6: Make Repair And Maintenance Explicit, Durable, And Local-First

**Files:**

- Modify: `apps/cli/src/services/offline/OfflineAssetService.ts`
- Create: `apps/cli/src/services/offline/OfflineMaintenanceService.ts`
- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/app-shell/download-manager-shell.tsx`
- Create: `apps/cli/test/unit/services/offline/offline-maintenance-service.test.ts`
- Modify: `apps/cli/test/unit/services/download/download-service.test.ts`
- Modify: `apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts`

- [ ] **Step 6.1: Test the repair authority table.**

Required cases:

| Repair                             | Automatic?                                            | Provider/network allowed?         |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------- |
| Validate selected local file       | Yes                                                   | No                                |
| Generate thumbnail locally         | Yes when enabled                                      | No                                |
| Adopt existing sidecar path        | Yes                                                   | No                                |
| Retry known subtitle/poster URL    | Only with policy and network allowed                  | Bounded metadata/artifact request |
| Replace video or re-resolve stream | No, unless enrolled runway creates a new approved job | Provider authority required       |

Tests must assert that missing video never causes an automatic provider re-resolve and that Power Saver suppresses optional network repair.

- [ ] **Step 6.2: Implement maintenance jobs from persisted state.**

`OfflineMaintenanceService` pulls bounded `offline_maintenance_jobs`, records outcome, and updates asset/track/artwork state. It must not scan the whole download directory on startup.

```ts
processNext(limit: number, context: { networkAllowed: boolean; powerSaver: boolean }): Promise<Summary>
scheduleForAsset(assetId: string, operation: OfflineMaintenanceOperation): void
```

- [ ] **Step 6.3: Show actionable state, not vague degradation.**

Download manager/library rows distinguish:

- `ready`;
- `ready - subtitle repair available`;
- `missing file - repair locally or redownload`;
- `paused - low disk space`;
- `waiting - Power Saver blocks optional repair`.

Do not show `degraded` merely because work took time.

- [ ] **Step 6.4: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/offline/offline-maintenance-service.test.ts test/unit/services/download/download-service.test.ts test/unit/services/background/BackgroundWorkScheduler.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services apps/cli/src/container.ts apps/cli/src/app-shell/download-manager-shell.tsx apps/cli/test/unit
git commit -m "feat: add bounded offline repair and maintenance jobs"
```

---

## Task 7: Extend Existing Continue Projection Into The Single Smart Read Model

**Files:**

- Modify: `apps/cli/src/services/continuation/continuation-policy.ts`
- Modify: `apps/cli/src/services/continuation/ContinuationProjectionService.ts`
- Modify: `apps/cli/src/domain/continuation/ContinuationEngine.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/test/unit/services/continuation/continuation-policy.test.ts`
- Modify: `apps/cli/test/unit/domain/continuation/continuation-engine.test.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [ ] **Step 7.1: Write failing projection precedence tests.**

Expand the existing projection input with local availability, catalog-derived new count, policy, and action evidence:

```ts
const projected = service.project({
  titleId: "anilist:1",
  entries,
  releaseProgress: { newEpisodeCount: 3, latestReleasedEpisode: 8 },
  offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 5 }] },
});
expect(projected.primaryAction.kind).toBe("play-local");
expect(projected.badge).toBe("3 new");
```

Precedence:

1. resume partially watched local/current episode;
2. play ready next unwatched offline asset;
3. start next catalog-aired episode after explicit online selection;
4. upcoming release/caught up state;
5. browse offline/manage downloads actions where applicable.

Catalog release state never claims provider playability.

- [ ] **Step 7.2: Extend, do not duplicate, `ContinuationProjectionService`.**

Keep a pure policy mapper in `continuation-policy.ts`; let the service gather already-materialized local/cached facts. Return a single presentation-ready model shared by Continue Watching and History:

```ts
type ContinuationProjection = {
  state: "resume" | "offline-ready" | "new-aired" | "upcoming" | "caught-up";
  badge?: string;
  primaryAction: ContinuationAction;
  secondaryActions: readonly ContinuationAction[];
  freshness: "local" | "cached" | "stale";
};
```

Adapt existing union consumers carefully rather than leaving two competing representations alive.

- [ ] **Step 7.3: Separate Continue Watching ranking from chronological History.**

- Continue Watching orders actionable rows: resume, offline-ready, `N new`, upcoming/caught-up.
- History stays chronological with filters and may show the same cached badge/action.
- Selecting `N new` starts from the next unwatched aired episode only after explicit user selection; the normal provider resolve path runs then.

Update `buildHistoryPickerOptions()` to take projections rather than re-deriving action policy inside the renderer.

- [ ] **Step 7.4: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/continuation/continuation-policy.test.ts test/unit/domain/continuation/continuation-engine.test.ts test/unit/app-shell/panel-data.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/continuation apps/cli/src/domain/continuation apps/cli/src/app-shell/panel-data.ts apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/src/main.ts apps/cli/test/unit
git commit -m "feat: unify smart continue and history projections"
```

---

## Task 8: Prioritize Catalog-Only Reconciliation By Attention And Offline Policy

**Files:**

- Modify: `apps/cli/src/services/release-reconciliation/types.ts`
- Modify: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationPlanner.ts`
- Modify: `apps/cli/src/services/release-reconciliation/enqueue-release-reconciliation.ts`
- Modify: `apps/cli/src/services/release-reconciliation/ReleaseReconciliationService.ts`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/test/unit/services/release-reconciliation/release-reconciliation-planner.test.ts`
- Modify: `apps/cli/test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts`
- Modify: `apps/cli/test/unit/services/release-reconciliation/ReleaseReconciliationService.test.ts`
- Modify: `apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts`

- [ ] **Step 8.1: Test prioritized, bounded candidate planning.**

Add candidate attention:

```ts
type ReleaseReconciliationAttention =
  | "selected-title"
  | "offline-enrolled"
  | "continue-visible"
  | "visible-stale"
  | "dormant-history";
```

Tests:

- selected stale title beats offline enrolled, which beats visible Continue, which beats dormant history;
- 30 dormant seasonal titles do not all refresh on every browse open;
- duplicate trigger promotion upgrades one queued work item rather than creating extra calls;
- cache-fresh/title-not-due remains zero-loader work;
- only catalog loaders are invoked; no provider service is a dependency.

- [ ] **Step 8.2: Extend planner inputs and stable priority ordering.**

Add attention context alongside history rows. Replace alphabetical candidate ordering with:

```ts
attentionRank(left) - attentionRank(right) ||
  dueAt(left) - dueAt(right) ||
  updatedAt(right) - updatedAt(left) ||
  catalogKey(left).localeCompare(catalogKey(right));
```

Preserve existing trigger budgets and typed failure backoff. An enrolled title still fetches only when due.

- [ ] **Step 8.3: Support stale-on-demand promotion.**

When an episode/season picker opens for a selected title and its projection is stale, enqueue one title-promoted catalog reconciliation work item. It reads cache immediately and refreshes behind the UI; it does not block opening the picker and does not resolve providers.

Runway evaluation consumes the refreshed projection on its next scheduler turn, rather than inventing a second catalog fetch path.

- [ ] **Step 8.4: Keep all UI joins cache-only.**

Browse idle, History, Calendar, and Continue read `release_progress_cache` and the smart projection. No surface gets a catalog loader dependency.

- [ ] **Step 8.5: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/release-reconciliation/release-reconciliation-planner.test.ts test/unit/services/release-reconciliation/enqueue-release-reconciliation.test.ts test/unit/services/release-reconciliation/ReleaseReconciliationService.test.ts test/unit/services/background/BackgroundWorkScheduler.test.ts test/unit/app-shell/panel-data.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/release-reconciliation apps/cli/src/services/background apps/cli/src/container.ts apps/cli/test/unit
git commit -m "feat: prioritize bounded release reconciliation by attention"
```

---

## Task 9: Deliver Unified Offline UX, Enrollment, Zen, And Power Saver

**Files:**

- Modify: `apps/cli/src/services/persistence/ConfigService.ts`
- Modify: `apps/cli/src/services/persistence/ConfigStore.ts`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts`
- Modify: `apps/cli/src/app-shell/library-shell.tsx`
- Modify: `apps/cli/src/app-shell/download-manager-shell.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/browse-idle-actions.ts`
- Modify: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`
- Modify: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`
- Modify: `apps/cli/test/unit/app-shell/browse-idle-actions.test.ts`
- Modify: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [ ] **Step 9.1: Write UX model tests before changing components.**

The component layer must receive explicit row/action models. Test:

- offline title row offers `Play`, `Keep watching offline`, `Change download profile`, `Cleanup`, and `Repair` only when valid;
- local playback never silently falls through to online playback;
- `N new` is shown as catalog-derived and only online play selection resolves a provider;
- low storage and paused optional work have specific copy;
- Zen hides chrome only; Power Saver suppresses optional background/fetch actions.

- [ ] **Step 9.2: Add configuration for modes, not per-title authority.**

```ts
zenMode: boolean;
powerSaverMode: boolean;
powerSaverAllowManualArtwork: boolean;
```

`minimalMode` may be migrated/aliased to `zenMode` if current product behavior matches; do not retain two confusing presentation settings.

- [ ] **Step 9.3: Build title-scoped enrollment and profile actions.**

In offline/library/details workflows, provide explicit actions:

- `Keep watching offline` / `Stop keeping offline`;
- `Download next episode` / `Download episodes...`;
- `Change download profile`;
- `Cleanup settings`;
- `Protect` / `Remove protection`;
- `Repair local files` or `Redownload...` where status requires it.

The confirmation view must show selected language/subtitle/quality, requested runway, estimated storage decision, and whether artwork/timing/subtitles will be retained.

- [ ] **Step 9.4: Make offline mode feel like the same app, constrained by capability.**

Use the same title/detail/progress/action language as online surfaces. Offline view may show cached/local artwork and timing; it must not show unavailable search/online actions as if they will work locally. Offer a deliberate `Go online` action rather than silent fallback.

- [ ] **Step 9.5: Enforce Power Saver at service triggers.**

Power Saver must be checked before enqueuing:

- optional artwork fetch/generation;
- speculative stream prefetch;
- recommendation warming;
- passive release reconciliation;
- optional network sidecar repair;
- runway background refill unless user initiates or explicitly allows it.

Manual download, manual refresh, manual catalog/calendar open, and manual playback remain available with clear acknowledgement.

- [ ] **Step 9.6: Verify and commit.**

```sh
bun run --cwd apps/cli test:unit -- test/unit/services/persistence/ConfigServiceImpl.test.ts test/unit/app-shell/overlay-panel.test.ts test/unit/app-shell/browse-idle-actions.test.ts test/unit/app-shell/panel-data.test.ts test/unit/services/offline/offline-runway-service.test.ts
bun run --cwd apps/cli typecheck
git add apps/cli/src/services/persistence apps/cli/src/app-shell apps/cli/test/unit
git commit -m "feat: deliver offline enrollment and power-aware shell UX"
```

---

## Task 10: Diagnostics, Documentation Truth, And Release Verification

**Files:**

- Modify: `apps/cli/src/services/diagnostics/diagnostic-event.ts`
- Modify as needed: existing diagnostics/support bundle projection files identified from current code
- Modify: `.docs/download-offline-onboarding.md`
- Modify: `.docs/ux-architecture.md`
- Modify: `.plans/plan-implementation-truth.md`
- Modify: `.plans/offline-continuity-and-smart-continue-platform.md`
- Add or modify focused deterministic tests for diagnostics projections

- [ ] **Step 10.1: Add diagnostic evidence without leaking sensitive data.**

Record bounded summary events:

- download authority source: `manual-confirmed` or `offline-enrolled`;
- storage admission: allowed/blocked reason and rounded byte counts;
- runway evaluation: target, ready count, deficit, enqueued count, skip reason;
- adoption/validation/maintenance result counts;
- reconciliation attention tier, cache-hit/fetched/skipped counts;
- Power Saver suppressed work categories.

Never record stream URLs, raw headers, provider cookies, or raw subtitle URLs.

- [ ] **Step 10.2: Add deterministic no-overfetch assertions.**

Tests must prove:

- disabled/cancelled download invokes zero provider episode/resolve calls;
- browse/history/calendar render invokes zero provider calls and zero file-validation walks;
- cached/due-not-reached reconciliation invokes zero catalog loader calls;
- a large dormant history list obeys budget and batching;
- duplicated runway/reconciliation triggers coalesce;
- Power Saver blocks passive background work;
- manual online Next and offline continuation remain explicit, separate intents.

- [ ] **Step 10.3: Update truth docs only after tests pass.**

Update the canonical offline doc and truth index with exactly what landed and any deliberate deferrals, including:

- TMDB cross-season rollover remains deferred unless separately implemented;
- provider/proxy live smoke is manual;
- auto-download authority applies only to enrolled offline continuation;
- legacy `autoDownload` values were not silently granted authority.

- [ ] **Step 10.4: Run full deterministic gates.**

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
git diff --check
```

Expected: all deterministic gates pass. Record pre-existing warnings separately; do not silently expand the change set to unrelated cleanup.

- [ ] **Step 10.5: Manual product smoke, explicitly bounded.**

Use fake/local downloaded artifacts where possible:

1. Open a ready downloaded episode and confirm local playback/history/resume/timing behavior.
2. Finish a downloaded enrolled episode and confirm exactly one runway evaluation and capacity-aware queue decision.
3. Open Continue/History/Calendar with cached release state and confirm `N new` copy does not imply provider confirmation.
4. Enable Power Saver and confirm cached state remains visible while passive work is suppressed.
5. Optionally near release, run one consented live catalog/provider smoke separately from automated tests.

- [ ] **Step 10.6: Commit documentation and diagnostics.**

```sh
git add apps/cli/src/services/diagnostics apps/cli/test/unit .docs/download-offline-onboarding.md .docs/ux-architecture.md .plans/plan-implementation-truth.md .plans/offline-continuity-and-smart-continue-platform.md
git commit -m "docs: record offline continuity implementation truth"
```

---

## Separate Follow-Up: Catalog Proxy Dossier

The bounded investigation of `https://db.videasy.net/3` is deliberately separate from this execution plan. It may improve catalog metadata confidence, but it cannot be treated as playback availability or become a hidden fetch path.

Create a dedicated plan only when starting that investigation. It must cover:

- endpoints and fields used for catalog/schedule metadata;
- cache headers, TTL policy, rate/response behavior, and failure semantics;
- identity mapping quality and TMDB season-rollover evidence;
- redaction and logging policy;
- one bounded manual metadata request at a time;
- explicit proof that browse/history/calendar projections remain cache-only;
- no provider-stream or playback resolution claims from catalog proxy responses.

## Completion Criteria

This platform is complete only when all of the following are true:

- A passive surface cannot start provider resolve, catalog refresh, directory walk, or local file validation.
- A manual download performs no provider work until the user confirms a bounded profile and capacity decision.
- An automatic download can occur only for an enrolled offline-continuation title and an approved runway deficit.
- `download_jobs` remains attempt evidence while the offline asset manifest owns playable local library truth.
- Offline playback validates only the chosen asset at the action boundary and persists ordinary history correctly.
- Continue Watching, History, Browse Idle, and Calendar consume one smart local/cached projection and honestly display `N new`.
- Release reconciliation is attention-prioritized, cache-first, budgeted, coalesced, catalog-only, and never provider-backed.
- Repair, cleanup, storage pause, Zen, and Power Saver are deterministic, user-visible, and tested.
- Full Bun verification passes and truth docs identify any remaining deliberate limitation.
