# History & Continuation Read Model — Phase 1a (Core engine & service) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the correct continuation core — a finished-state authority util, a pure projection engine with the Netflix anchor rule, and a repository-backed `ContinueWatchingService` — purely additively, leaving the existing facade working so the build stays green at every commit.

**Architecture:** A pure decision function (`projectContinuation`) operates on `HistoryProgress` rows from `@kunai/storage` and returns a structured `ContinuationDecision` (no display strings, no IO). A thin `ContinueWatchingService` wraps `HistoryRepository` and the engine to provide per-title and recency-row reads. Phase 1b (separate plan) migrates callers onto this and deletes the legacy `HistoryStore` facade + `reconcileContinueHistory`.

**Tech Stack:** TypeScript, Bun, `bun:test`, SQLite via `@kunai/storage` (`openKunaiDatabase`, `runMigrations`, `HistoryRepository`).

**Spec:** `docs/superpowers/specs/2026-05-28-history-continuation-read-model-design.md`

---

## Background the engineer needs

- `HistoryProgress` is the lossless SQLite row type, exported from `@kunai/storage`. Shape (relevant fields):
  `titleId: string`, `mediaKind: MediaKind`, `title: string`, `season?: number`, `episode?: number`, `absoluteEpisode?: number`, `positionSeconds: number`, `durationSeconds?: number`, `completed: boolean`, `providerId?: ProviderId`, `updatedAt: string` (ISO), `createdAt: string`.
- `HistoryRepository` (from `@kunai/storage`) methods used here: `upsertProgress(input)`, `getProgress(title, episode?)`, `getLatestForTitle(titleId)`, `listRecent(limit=20)`, `listByTitle(titleId, limit=500)`.
- Tests use `bun:test` (`import { expect, test } from "bun:test"`). DB-backed tests open an in-memory DB: `const db = openKunaiDatabase(":memory:"); runMigrations(db, "data");` then `new HistoryRepository(db)`. See `apps/cli/test/unit/domain/queue/QueueService.test.ts` for the pattern.
- Run tests for one file with: `bun test apps/cli/test/unit/<path>` from repo root (the `apps/cli` package script is `bun test test/unit test/integration`). To run a single file you can do `cd apps/cli && bun test test/unit/services/continuation/<file>`.
- Path alias `@/` maps to `apps/cli/src/`. `@kunai/storage` is the storage package.
- **Do not modify** `reconcileContinueHistory`, `HistoryStore`, `SqliteHistoryStoreImpl`, `continuation-policy.ts`, or any caller in this phase. Phase 1a is additive only.

---

## File structure (Phase 1a)

- Create `apps/cli/src/services/continuation/history-progress.ts` — finished-state authority + timestamp formatting on `HistoryProgress`.
- Create `apps/cli/src/services/continuation/continuation-engine.ts` — pure `projectContinuation` engine + `ContinuationDecision` types + `groupLatestByTitle` helper.
- Create `apps/cli/src/services/continuation/ContinueWatchingService.ts` — repo-backed reads (`projectTitle`, `recentRow`, `episodeProgress`).
- Modify `apps/cli/src/container.ts` — register `continueWatchingService` (additive field).
- Tests:
  - `apps/cli/test/unit/services/continuation/history-progress.test.ts`
  - `apps/cli/test/unit/services/continuation/continuation-engine.test.ts`
  - `apps/cli/test/unit/services/continuation/continue-watching-service.test.ts`

---

## Task 1: Finished-state authority util

**Files:**

- Create: `apps/cli/src/services/continuation/history-progress.ts`
- Test: `apps/cli/test/unit/services/continuation/history-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";

import { formatTimestamp, isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

function row(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("isFinished trusts the completed flag even when duration is unknown", () => {
  expect(isFinished(row({ completed: true, durationSeconds: 0, positionSeconds: 5 }))).toBe(true);
  expect(isFinished(row({ completed: true, durationSeconds: undefined }))).toBe(true);
});

test("isFinished with duration 0 and no completed flag is not finished", () => {
  expect(isFinished(row({ completed: false, durationSeconds: 0, positionSeconds: 9999 }))).toBe(
    false,
  );
  expect(isFinished(row({ completed: false, durationSeconds: undefined }))).toBe(false);
});

test("isFinished falls back to the 95% ratio only when duration is positive", () => {
  expect(isFinished(row({ completed: false, durationSeconds: 1000, positionSeconds: 960 }))).toBe(
    true,
  );
  expect(isFinished(row({ completed: false, durationSeconds: 1000, positionSeconds: 500 }))).toBe(
    false,
  );
});

test("formatTimestamp renders mm:ss and h:mm:ss", () => {
  expect(formatTimestamp(75)).toBe("1:15");
  expect(formatTimestamp(3725)).toBe("1:02:05");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test test/unit/services/continuation/history-progress.test.ts`
Expected: FAIL — cannot resolve module `@/services/continuation/history-progress`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/services/continuation/history-progress.ts
import type { HistoryProgress } from "@kunai/storage";

const FINISHED_RATIO = 0.95;

/**
 * Single authority for "is this episode finished".
 * The persisted `completed` flag (written richly from credits/threshold/EOF) wins.
 * The 95% ratio is only a fallback when a positive duration is known.
 */
export function isFinished(progress: HistoryProgress): boolean {
  if (progress.completed) return true;
  const duration = progress.durationSeconds ?? 0;
  if (duration <= 0) return false;
  return progress.positionSeconds / duration >= FINISHED_RATIO;
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test test/unit/services/continuation/history-progress.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/continuation/history-progress.ts apps/cli/test/unit/services/continuation/history-progress.test.ts
git commit -m "feat(continuation): finished-state authority util on HistoryProgress"
```

---

## Task 2: Pure projection engine + types + grouping helper

**Files:**

- Create: `apps/cli/src/services/continuation/continuation-engine.ts`
- Test: `apps/cli/test/unit/services/continuation/continuation-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";

import {
  groupLatestByTitle,
  projectContinuation,
} from "@/services/continuation/continuation-engine";
import type { HistoryProgress } from "@kunai/storage";

function row(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("resumes the most-recent episode when it is unfinished", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [
      row({ episode: 3, positionSeconds: 400, updatedAt: "2026-05-03T00:00:00.000Z" }),
      row({ episode: 2, completed: true, updatedAt: "2026-05-02T00:00:00.000Z" }),
    ],
  });
  expect(decision.state).toBe("resume");
  expect(decision).toMatchObject({ season: 1, episode: 3, positionSeconds: 400 });
});

test("does NOT resume an older abandoned episode when the most-recent is finished", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [
      row({ episode: 5, completed: true, updatedAt: "2026-05-05T00:00:00.000Z" }),
      row({ episode: 3, positionSeconds: 400, updatedAt: "2026-05-02T00:00:00.000Z" }),
    ],
  });
  expect(decision.state).not.toBe("resume");
  expect(decision.state).toBe("up-to-date");
});

test("finished anchor with +N aired episodes surfaces new-episodes", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 5, completed: true })],
    releaseProgress: { newEpisodeCount: 3 },
  });
  expect(decision.state).toBe("new-episodes");
  expect(decision).toMatchObject({ newEpisodeCount: 3 });
});

test("finished anchor with a sequel signal surfaces new-season", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    newSeason: { season: 2 },
  });
  expect(decision.state).toBe("new-season");
});

test("offline-ready next episode takes precedence over release signals", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 5, completed: true })],
    releaseProgress: { newEpisodeCount: 3 },
    offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 6, jobId: "job-1" }] },
  });
  expect(decision.state).toBe("offline-ready");
  expect(decision).toMatchObject({ season: 1, episode: 6, jobId: "job-1" });
});

test("finished anchor with only an upcoming release is airing-weekly", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    nextRelease: {
      season: 1,
      episode: 13,
      released: false,
      availableAt: "2026-06-01T00:00:00.000Z",
    },
  });
  expect(decision.state).toBe("airing-weekly");
  expect(decision).toMatchObject({ season: 1, episode: 13 });
});

test("finished anchor with a released next episode is next-up", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    nextRelease: { season: 1, episode: 13, released: true },
  });
  expect(decision.state).toBe("next-up");
  expect(decision).toMatchObject({ season: 1, episode: 13 });
});

test("no rows for the title is empty", () => {
  expect(projectContinuation({ titleId: "tmdb:1", rows: [] }).state).toBe("empty");
});

test("groupLatestByTitle keeps one most-recent row per title, recency-ordered", () => {
  const grouped = groupLatestByTitle([
    row({ titleId: "a", updatedAt: "2026-05-01T00:00:00.000Z" }),
    row({ titleId: "a", updatedAt: "2026-05-04T00:00:00.000Z" }),
    row({ titleId: "b", updatedAt: "2026-05-03T00:00:00.000Z" }),
  ]);
  expect(grouped.map((r) => r.titleId)).toEqual(["a", "b"]);
  expect(grouped[0]?.updatedAt).toBe("2026-05-04T00:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test test/unit/services/continuation/continuation-engine.test.ts`
Expected: FAIL — cannot resolve module `@/services/continuation/continuation-engine`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/services/continuation/continuation-engine.ts
import type { HistoryProgress } from "@kunai/storage";

import { isFinished } from "./history-progress";

export type ContinuationStateKind =
  | "resume"
  | "next-up"
  | "new-episodes"
  | "new-season"
  | "airing-weekly"
  | "up-to-date"
  | "offline-ready"
  | "empty";

export type ContinuationNextRelease = {
  readonly season: number;
  readonly episode: number;
  readonly released: boolean;
  readonly availableAt?: string;
};

export type NewSeasonSignal = {
  readonly season: number;
  readonly availableAt?: string;
};

export type OfflineEpisodeRef = {
  readonly season: number;
  readonly episode: number;
  readonly jobId?: string;
};

export type ContinuationDecision = {
  readonly state: ContinuationStateKind;
  readonly titleId: string;
  readonly title?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly positionSeconds?: number;
  readonly jobId?: string;
  readonly newEpisodeCount?: number;
  readonly availableAt?: string;
  /** The most-recent (anchor) row the decision was made from, when one exists. */
  readonly anchor?: HistoryProgress;
};

export type ProjectContinuationInput = {
  readonly titleId: string;
  readonly rows: readonly HistoryProgress[];
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly newSeason?: NewSeasonSignal | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly OfflineEpisodeRef[];
  } | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
};

/**
 * Pure continuation decision. Anchors on the MOST-RECENT episode for the title
 * (Netflix/Crunchyroll rule): resume it if unfinished, otherwise advance. Never
 * scans back to an older abandoned episode.
 */
export function projectContinuation(input: ProjectContinuationInput): ContinuationDecision {
  const rows = input.rows
    .filter((row) => row.titleId === input.titleId)
    .slice()
    .sort(byUpdatedAtDesc);
  const anchor = rows[0];
  if (!anchor) return { state: "empty", titleId: input.titleId };

  if (!isFinished(anchor)) {
    return {
      state: "resume",
      titleId: input.titleId,
      title: anchor.title,
      season: anchor.season,
      episode: anchor.episode,
      positionSeconds: anchor.positionSeconds,
      anchor,
    };
  }

  const localNext = (input.offline?.readyNextEpisodes ?? [])
    .filter((episode) => isEpisodeAfterAnchor(episode, anchor))
    .sort((left, right) => left.season - right.season || left.episode - right.episode)[0];
  if (localNext) {
    return {
      state: "offline-ready",
      titleId: input.titleId,
      title: anchor.title,
      season: localNext.season,
      episode: localNext.episode,
      jobId: localNext.jobId,
      anchor,
    };
  }

  if (input.releaseProgress && input.releaseProgress.newEpisodeCount > 0) {
    return {
      state: "new-episodes",
      titleId: input.titleId,
      title: anchor.title,
      newEpisodeCount: input.releaseProgress.newEpisodeCount,
      anchor,
    };
  }

  if (input.newSeason) {
    return {
      state: "new-season",
      titleId: input.titleId,
      title: anchor.title,
      season: input.newSeason.season,
      availableAt: input.newSeason.availableAt,
      anchor,
    };
  }

  if (input.nextRelease?.released) {
    return {
      state: "next-up",
      titleId: input.titleId,
      title: anchor.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      anchor,
    };
  }

  if (input.nextRelease) {
    return {
      state: "airing-weekly",
      titleId: input.titleId,
      title: anchor.title,
      season: input.nextRelease.season,
      episode: input.nextRelease.episode,
      availableAt: input.nextRelease.availableAt,
      anchor,
    };
  }

  return { state: "up-to-date", titleId: input.titleId, title: anchor.title, anchor };
}

/** One most-recent row per titleId, ordered newest-first by updatedAt. */
export function groupLatestByTitle(rows: readonly HistoryProgress[]): HistoryProgress[] {
  const latest = new Map<string, HistoryProgress>();
  for (const row of rows) {
    const current = latest.get(row.titleId);
    if (!current || Date.parse(row.updatedAt) > Date.parse(current.updatedAt)) {
      latest.set(row.titleId, row);
    }
  }
  return [...latest.values()].sort(byUpdatedAtDesc);
}

function byUpdatedAtDesc(left: HistoryProgress, right: HistoryProgress): number {
  return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
}

function isEpisodeAfterAnchor(
  episode: { readonly season: number; readonly episode: number },
  anchor: HistoryProgress,
): boolean {
  const anchorSeason = anchor.season ?? 1;
  const anchorEpisode = anchor.episode ?? anchor.absoluteEpisode ?? 0;
  return (
    episode.season > anchorSeason ||
    (episode.season === anchorSeason && episode.episode > anchorEpisode)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test test/unit/services/continuation/continuation-engine.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/continuation/continuation-engine.ts apps/cli/test/unit/services/continuation/continuation-engine.test.ts
git commit -m "feat(continuation): pure projection engine with Netflix anchor rule"
```

---

## Task 3: ContinueWatchingService (repo-backed reads)

**Files:**

- Create: `apps/cli/src/services/continuation/ContinueWatchingService.ts`
- Test: `apps/cli/test/unit/services/continuation/continue-watching-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";

import { ContinueWatchingService } from "@/services/continuation/ContinueWatchingService";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeRepo(): HistoryRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

test("projectTitle anchors on the most-recent episode for the title", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Example" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1000,
    durationSeconds: 1000,
    completed: true,
    updatedAt: "2026-05-02T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Example" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 300,
    durationSeconds: 1400,
    completed: false,
    updatedAt: "2026-05-03T00:00:00.000Z",
  });

  const service = new ContinueWatchingService(repo);
  const decision = service.projectTitle("tmdb:1");
  expect(decision.state).toBe("resume");
  expect(decision).toMatchObject({ episode: 3, positionSeconds: 300 });
});

test("recentRow returns one anchor per title, recency-ordered", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "a", kind: "series", title: "A" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  repo.upsertProgress({
    title: { id: "b", kind: "series", title: "B" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 100,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-04T00:00:00.000Z",
  });

  const service = new ContinueWatchingService(repo);
  const rows = service.recentRow(10);
  expect(rows.map((r) => r.titleId)).toEqual(["b", "a"]);
});

test("episodeProgress returns every stored episode for the title", () => {
  const repo = makeRepo();
  for (const episode of [1, 2, 3]) {
    repo.upsertProgress({
      title: { id: "tmdb:1", kind: "series", title: "Example" },
      episode: { season: 1, episode },
      positionSeconds: 100,
      durationSeconds: 1000,
      completed: false,
      updatedAt: `2026-05-0${episode}T00:00:00.000Z`,
    });
  }
  const service = new ContinueWatchingService(repo);
  expect(service.episodeProgress("tmdb:1").length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cli && bun test test/unit/services/continuation/continue-watching-service.test.ts`
Expected: FAIL — cannot resolve module `@/services/continuation/ContinueWatchingService`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/cli/src/services/continuation/ContinueWatchingService.ts
import type { HistoryProgress, HistoryRepository } from "@kunai/storage";

import {
  groupLatestByTitle,
  projectContinuation,
  type ContinuationDecision,
  type ContinuationNextRelease,
  type NewSeasonSignal,
} from "./continuation-engine";

export type ContinuationSignals = {
  readonly nextRelease?: ContinuationNextRelease | null;
  readonly newSeason?: NewSeasonSignal | null;
  readonly offline?: {
    readonly enrolled: boolean;
    readonly readyNextEpisodes: readonly { season: number; episode: number; jobId?: string }[];
  } | null;
  readonly releaseProgress?: { readonly newEpisodeCount: number; readonly stale?: boolean } | null;
};

/**
 * Repository-backed continuation reads. IO + orchestration only; all decisions
 * delegate to the pure `projectContinuation` engine. Reads local data only and
 * never triggers a network fetch.
 */
export class ContinueWatchingService {
  constructor(private readonly historyRepository: HistoryRepository) {}

  /** Continuation decision for a single title, anchored on its most-recent episode. */
  projectTitle(titleId: string, signals: ContinuationSignals = {}): ContinuationDecision {
    const rows = this.historyRepository.listByTitle(titleId);
    return projectContinuation({ titleId, rows, ...signals });
  }

  /** Continue Watching list: one anchor per title, recency-ordered. */
  recentRow(
    limit: number,
    signalsByTitle?: (titleId: string) => ContinuationSignals,
    scanLimit = 500,
  ): ContinuationDecision[] {
    const anchors = groupLatestByTitle(this.historyRepository.listRecent(scanLimit)).slice(
      0,
      limit,
    );
    return anchors.map((anchor) =>
      projectContinuation({
        titleId: anchor.titleId,
        rows: [anchor],
        ...(signalsByTitle?.(anchor.titleId) ?? {}),
      }),
    );
  }

  /** Every stored episode row for a title (for episode-picker progress dots). */
  episodeProgress(titleId: string): readonly HistoryProgress[] {
    return this.historyRepository.listByTitle(titleId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/cli && bun test test/unit/services/continuation/continue-watching-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/continuation/ContinueWatchingService.ts apps/cli/test/unit/services/continuation/continue-watching-service.test.ts
git commit -m "feat(continuation): ContinueWatchingService repo-backed reads"
```

---

## Task 4: Register the service in the container (additive)

**Files:**

- Modify: `apps/cli/src/container.ts`

Context: `container.ts:275-276` already constructs `historyRepository` and `historyStore`. The `ContinuationProjectionService` is constructed at `container.ts:475` and exposed on the container interface around `:209`. We add `continueWatchingService` alongside, using the existing `historyRepository`.

- [ ] **Step 1: Add the import**

Near the other continuation import (`container.ts:76`):

```ts
import { ContinueWatchingService } from "./services/continuation/ContinueWatchingService";
```

- [ ] **Step 2: Add the interface field**

Next to `continuationProjectionService` on the container interface (`container.ts:209`):

```ts
  readonly continueWatchingService: ContinueWatchingService;
```

- [ ] **Step 3: Construct it**

Next to `const continuationProjectionService = new ContinuationProjectionService();` (`container.ts:475`):

```ts
const continueWatchingService = new ContinueWatchingService(historyRepository);
```

- [ ] **Step 4: Expose it on the returned object**

Next to `continuationProjectionService,` in the returned container object (`container.ts:583`):

```ts
    continueWatchingService,
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/container.ts
git commit -m "feat(container): register ContinueWatchingService"
```

---

## Task 5: Phase gate — full verification

- [ ] **Step 1: Run the continuation unit tests**

Run: `cd apps/cli && bun test test/unit/services/continuation`
Expected: PASS — all of Tasks 1-3 green (history-progress: 4, continuation-engine: 9, continue-watching-service: 3).

- [ ] **Step 2: Typecheck, lint, full test, build**

Run (from repo root):

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Expected: all PASS. No existing test should change — Phase 1a is additive (the legacy facade and `reconcileContinueHistory` are untouched).

- [ ] **Step 3: Confirm no regressions to existing snapshots**

The `apps/cli/test/__captures__/history-continue.*.txt` captures must be unchanged (we touched no view code). If any capture changed, STOP — something non-additive happened; revert and investigate.

- [ ] **Step 4: Final commit (if lint/fmt adjusted anything)**

```bash
git add -A
git commit -m "chore(continuation): phase 1a verification" || echo "nothing to commit"
```

---

## Self-review notes (for the author)

- **Spec coverage:** §3.1 finished-rule → Task 1. §3.2 anchor rule + engine → Task 2. §3.3 showcase states → `ContinuationStateKind` (Task 2; badge _strings_ are deferred to Phase 1b's `badgesFor` adapter, per spec §3.4). §3.4 service surface → Task 3. Container wiring → Task 4.
- **Out of scope (Phase 1b):** caller migration, view-model rewrite off `HistoryEntry`, deletion of `HistoryStore`/`SqliteHistoryStoreImpl`/`HistoryStoreImpl`/`reconcileContinueHistory`/`container.historyStore`, the write-path move at `PlaybackPhase.ts:1917`, and `groupLatestByTitle` adoption by raw-row callers. These all depend on the new service existing, which Phase 1a delivers.
- **Out of scope (Plan 2):** the `newSeason` and `releaseProgress` _data_ are consumed here but produced/validated by Plan 2; in Phase 1a they are simply optional inputs exercised by unit tests.
- **Type consistency:** `projectContinuation` / `groupLatestByTitle` / `ContinuationDecision` / `ContinueWatchingService.{projectTitle,recentRow,episodeProgress}` names are used identically across Tasks 2-4.
