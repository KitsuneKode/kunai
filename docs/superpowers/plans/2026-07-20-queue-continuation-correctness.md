# Queue and Continuation Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume queue entries exactly once only after confirmed playback startup, restore interrupted work deterministically, resume exact episodes, prevent rejected history from leaking through shutdown, and align Continue, History, and post-play behavior.

**Architecture:** Storage owns compare-and-set queue transitions; domain adapters own exact media identity; the playback application layer owns claim/acknowledge/rollback policy; mpv infra emits `playback-started`; continuation services project one conservative user-visible decision.

**Tech Stack:** Bun, TypeScript, SQLite, React, Ink, fake-player and render-capture test harnesses.

## Global Constraints

- Queue lifecycle is exactly `pending -> in-flight -> played`.
- Only `playback-started` acknowledges an item; process spawn and IPC connection are insufficient.
- Every queue handoff carries exact queue ID and absolute anime episode identity.
- Pre-start failure restores the same row and position.
- Crash/handled shutdown preserves in-flight work as recoverable.
- Finished content without authoritative release evidence is up to date, not a fabricated next episode.
- Use no live providers.
- Do not use worktrees.
- Preserve unrelated release-note/reference working-tree paths.

---

### Task 1: Persist the queue playback state machine

**Files:**

- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/repositories/queue.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `packages/storage/test/queue-playback-lifecycle.test.ts`

**Interfaces:**

```ts
export type QueueItemStatus = "pending" | "in-flight" | "played" | "skipped" | "failed";

export interface QueuePlaybackFailureRecord {
  readonly code:
    | "search-cancelled"
    | "episode-cancelled"
    | "provider-exhausted"
    | "mpv-launch-failed"
    | "playback-aborted"
    | "handoff-failed";
  readonly stage: "handoff" | "episode-selection" | "provider-resolution" | "player-launch";
  readonly at: string;
  readonly detail?: string;
}
```

`QueuePlaybackFailureRecord` is exported by `@kunai/storage`; the storage package must not import CLI-domain types. Task 2 exposes the CLI name as a type-only alias:

```ts
export type QueuePlaybackFailureContext = QueuePlaybackFailureRecord;
```

- [ ] **Step 1: Add compare-and-set tests**

```ts
test("acknowledges only the exact in-flight id", () => {
  const a = enqueue(repo, "session", "a");
  const b = enqueue(repo, "session", "b");
  repo.markInFlight(b.id, "session", "2026-07-20T10:00:00.000Z");

  expect(repo.acknowledgePlaybackStarted(a.id, "session", NOW)).toBe(false);
  expect(repo.acknowledgePlaybackStarted(b.id, "session", NOW)).toBe(true);
  expect(repo.getById(a.id)?.status).toBe("pending");
  expect(repo.getById(b.id)?.status).toBe("played");
});

test("pre-start rollback preserves position and failure context", () => {
  const first = enqueue(repo, "session", "first");
  const second = enqueue(repo, "session", "second");
  repo.markInFlight(first.id, "session", NOW);
  repo.restoreInFlightToPending(first.id, "session", {
    code: "mpv-launch-failed",
    stage: "player-launch",
    at: NOW,
  });
  expect(repo.getAllForSession("session").map((row) => row.id)).toEqual([first.id, second.id]);
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd packages/storage test -- test/queue-playback-lifecycle.test.ts
```

Expected: migration/transition methods do not exist.

- [ ] **Step 3: Add migration 026**

```sql
ALTER TABLE playlist_queue ADD COLUMN in_flight_at TEXT;
ALTER TABLE playlist_queue ADD COLUMN last_failure_json TEXT;
ALTER TABLE playback_queue_sessions ADD COLUMN last_activity_at TEXT;
UPDATE playback_queue_sessions SET last_activity_at = updated_at
WHERE last_activity_at IS NULL;
```

Add indexes for `(session_id, status, queue_position, added_at)` and recoverable session activity.

- [ ] **Step 4: Implement compare-and-set SQL**

Use `WHERE id = ? AND session_id = ? AND status = 'pending'` for claim, `status = 'in-flight'` for rollback/acknowledgement, and update `last_activity_at` only for real queue activity.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd packages/storage test -- test/queue-playback-lifecycle.test.ts
bun run --cwd packages/storage typecheck
git add packages/storage/src/migrations.ts \
  packages/storage/src/repositories/queue.ts \
  packages/storage/src/index.ts \
  packages/storage/test/queue-playback-lifecycle.test.ts
git commit -m "feat(queue): persist in-flight playback lifecycle"
```

### Task 2: Carry exact queue playback intent

**Files:**

- Create: `apps/cli/src/domain/queue/queue-playback-intent.ts`
- Modify: `apps/cli/src/domain/queue/QueueService.ts`
- Modify: `apps/cli/src/domain/media/media-item-adapters.ts`
- Modify: `apps/cli/src/domain/types.ts`
- Create: `apps/cli/test/unit/domain/queue/queue-playback-intent.test.ts`
- Modify: `apps/cli/test/unit/domain/queue/QueueService.test.ts`

**Interfaces:**

```ts
export interface QueuePlaybackIntent {
  readonly queueEntryId: string;
  readonly titleId: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly source: "queue" | "auto-next" | "post-play";
}
```

```ts
beginPlayback(id: string, source: QueuePlaybackIntent["source"], at?: string):
  QueuePlaybackIntent | undefined;
acknowledgePlaybackStarted(intent: QueuePlaybackIntent, at?: string): boolean;
rollbackBeforeStart(intent: QueuePlaybackIntent, failure: QueuePlaybackFailureContext): boolean;
```

- [ ] **Step 1: Add identity and exact-claim tests**

```ts
test("intent carries absolute anime episode", () => {
  expect(queuePlaybackIntentFromEntry(ANIME_ENTRY, "queue")).toMatchObject({
    queueEntryId: "queue-17",
    titleId: "anilist:16498",
    absoluteEpisode: 13,
  });
});

test("beginPlayback claims requested row, not head", () => {
  const first = enqueue(repo, "first");
  const selected = enqueue(repo, "selected");
  expect(service.beginPlayback(selected.id, "queue")?.queueEntryId).toBe(selected.id);
  expect(repo.getById(first.id)?.status).toBe("pending");
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/queue/queue-playback-intent.test.ts \
  test/unit/domain/queue/QueueService.test.ts
```

- [ ] **Step 3: Implement adapters and remove head-based advance**

Attach `queuePlaybackIntent` to `TitleInfo`; add `absoluteEpisode` to `EpisodeInfo`; delete `QueueService.advance()` after all callers migrate.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/queue/queue-playback-intent.test.ts \
  test/unit/domain/queue/QueueService.test.ts
bun run typecheck
git add apps/cli/src/domain/queue/queue-playback-intent.ts \
  apps/cli/src/domain/queue/QueueService.ts \
  apps/cli/src/domain/media/media-item-adapters.ts \
  apps/cli/src/domain/types.ts \
  apps/cli/test/unit/domain/queue/queue-playback-intent.test.ts \
  apps/cli/test/unit/domain/queue/QueueService.test.ts
git commit -m "feat(queue): carry exact playback intent identity"
```

### Task 3: Claim manual selections before cross-phase handoff

**Files:**

- Modify: `apps/cli/src/app-shell/root-queue-bridge.ts`
- Modify: `apps/cli/src/app-shell/root-overlay-shell.tsx`
- Modify: `apps/cli/src/app-shell/dispatch-palette-command.ts`
- Modify: `apps/cli/src/app/search/SearchPhase.ts`
- Create: `apps/cli/test/unit/app-shell/root-queue-bridge.test.ts`
- Modify: `apps/cli/test/unit/app-shell/dispatch-palette-command.test.ts`

**Interfaces:**

```ts
export interface QueuePlaybackLaunch {
  readonly intent: QueuePlaybackIntent;
  readonly title: string;
}
```

- [ ] **Step 1: Test exact claim and bridge payload**

Assert Enter on row B calls `beginPlayback(B, "queue")`, bridge payload carries ID and absolute episode, failed compare-and-set leaves overlay open, and Escape does not mutate queue state.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/root-queue-bridge.test.ts \
  test/unit/app-shell/dispatch-palette-command.test.ts
```

- [ ] **Step 3: Replace lossy metadata payload**

Resolve the exact row by ID, call `beginPlayback`, and route the returned intent through domain adapters. Do not use a later `peekNext()`.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/root-queue-bridge.test.ts \
  test/unit/app-shell/dispatch-palette-command.test.ts \
  test/unit/app-shell/browse-idle-actions.test.ts
git add apps/cli/src/app-shell/root-queue-bridge.ts \
  apps/cli/src/app-shell/root-overlay-shell.tsx \
  apps/cli/src/app-shell/dispatch-palette-command.ts \
  apps/cli/src/app/search/SearchPhase.ts \
  apps/cli/test/unit/app-shell/root-queue-bridge.test.ts \
  apps/cli/test/unit/app-shell/dispatch-palette-command.test.ts
git commit -m "fix(queue): claim manual selections before playback handoff"
```

### Task 4: Acknowledge only confirmed playback startup

**Files:**

- Create: `apps/cli/src/app/playback/queue-playback-attempt.ts`
- Modify: `apps/cli/src/app/playback/run-mpv-playback-session.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/playback/playback-outcome.ts`
- Create: `apps/cli/test/unit/app/playback/queue-playback-attempt.test.ts`
- Create: `apps/cli/test/unit/app/playback/run-mpv-playback-session.test.ts`

**Interfaces:**

```ts
export interface QueuePlaybackAttempt {
  readonly intent: QueuePlaybackIntent;
  readonly acknowledged: boolean;
  setStage(stage: QueuePlaybackFailureContext["stage"]): void;
  acknowledgeStarted(at?: string): boolean;
  rollbackIfUnacknowledged(code: QueuePlaybackFailureContext["code"], detail?: string): boolean;
}
```

- [ ] **Step 1: Add event-boundary tests**

```ts
test("mpv process start does not acknowledge", async () => {
  const onConfirmedStart = mock();
  await runWithPlayerEvents([{ type: "mpv-process-started" }], { onConfirmedStart });
  expect(onConfirmedStart).not.toHaveBeenCalled();
});

test("playback-started acknowledges once", async () => {
  const onConfirmedStart = mock();
  await runWithPlayerEvents([{ type: "playback-started" }, { type: "playback-started" }], {
    onConfirmedStart,
  });
  expect(onConfirmedStart).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback/queue-playback-attempt.test.ts \
  test/unit/app/playback/run-mpv-playback-session.test.ts
```

- [ ] **Step 3: Add `onConfirmedPlaybackStart`**

Invoke it once only in the real `playback-started` event branch.

- [ ] **Step 4: Wrap PlaybackPhase in one attempt**

Set stages before episode selection/provider/player launch; use one `finally` rollback for all pre-start exits; acknowledgement makes rollback a no-op.

- [ ] **Step 5: Replace auto-next head consumption**

Capture the selected ID, call `beginPlayback(id, "auto-next")` before countdown, roll it back on cancellation, and return a title carrying that exact intent.

- [ ] **Step 6: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback/queue-playback-attempt.test.ts \
  test/unit/app/playback/run-mpv-playback-session.test.ts \
  test/unit/app/playback/playback-phase-outer-loop.test.ts \
  test/unit/domain/queue/QueueService.test.ts
git add apps/cli/src/app/playback/queue-playback-attempt.ts \
  apps/cli/src/app/playback/run-mpv-playback-session.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/src/app/playback/playback-outcome.ts \
  apps/cli/test/unit/app/playback/queue-playback-attempt.test.ts \
  apps/cli/test/unit/app/playback/run-mpv-playback-session.test.ts
git commit -m "fix(playback): acknowledge queue only after mpv starts"
```

### Task 5: Restore interrupted sessions deterministically

**Files:**

- Modify: `apps/cli/src/container/bootstrap-services.ts`
- Modify: `apps/cli/src/domain/queue/restore-queue-session.ts`
- Modify: `apps/cli/src/app-shell/queue-restore.ts`
- Modify: `apps/cli/src/domain/queue/QueueService.ts`
- Modify: `apps/cli/test/unit/domain/queue/restore-queue-session.test.ts`
- Modify: `packages/storage/src/repositories/queue.ts`

- [ ] **Step 1: Add restore-policy matrix tests**

Cover queue-owned in-flight precedence, history before session creation, history after last activity + five minutes, unrelated title identity, absolute episode mismatch, duplicate promotion, non-empty current queue, and in-flight shutdown recovery.

Exact placement assertion:

```ts
expect(service.getAll().map((entry) => entry.titleId)).toEqual([
  "played-current",
  "restored-a",
  "restored-b",
  "current-a",
  "current-b",
]);
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/queue/restore-queue-session.test.ts \
  test/unit/domain/queue/QueueService.test.ts
```

- [ ] **Step 3: Implement exact identity and real window**

Require:

```text
session.createdAt <= history.updatedAt <= session.lastActivityAt + 5 minutes
```

Use in-flight identity first; infer from history only when absent and only among entries belonging to the restored session.

- [ ] **Step 4: Restore as one transaction**

Reparent rows, reset in-flight to pending, assign positions for `[currentPlayed, restoredBlock, currentPending]`, close source session, and return restored IDs.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/domain/queue/restore-queue-session.test.ts \
  test/unit/domain/queue/QueueService.test.ts \
  test/unit/app-shell/queue-view.test.ts
bun run --cwd packages/storage test -- test/queue-playback-lifecycle.test.ts
git add apps/cli/src/container/bootstrap-services.ts \
  apps/cli/src/domain/queue/restore-queue-session.ts \
  apps/cli/src/app-shell/queue-restore.ts \
  apps/cli/src/domain/queue/QueueService.ts \
  apps/cli/test/unit/domain/queue/restore-queue-session.test.ts \
  apps/cli/test/unit/domain/queue/QueueService.test.ts \
  packages/storage/src/repositories/queue.ts \
  packages/storage/test/queue-playback-lifecycle.test.ts
git commit -m "fix(queue): restore interrupted sessions deterministically"
```

### Task 6: Resume only the exact canonical episode

**Files:**

- Modify: `packages/storage/src/repositories/history.ts`
- Modify: `packages/storage/src/repositories/history-title-aliases.ts`
- Modify: `apps/cli/src/app/playback/playback-resume-from-history.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/continuation/ContinueWatchingService.ts`
- Modify: exact `listByTitle` callers
- Modify tests in storage and CLI

**Interfaces:**

```ts
export interface HistoryTitleLookup {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly externalIds?: ExternalIds;
}

listByTitleIdentity(title: HistoryTitleLookup, limit?: number): readonly HistoryProgress[];
getProgressForTitleIdentity(title: HistoryTitleLookup, episode?: EpisodeIdentity):
  HistoryProgress | undefined;
```

- [ ] **Step 1: Add canonical/exact lookup tests**

Test bare TMDB vs `tmdb:` ID, provider alias, exact S1E4 not inheriting S1E3, and absolute E13 distinct from S2E1 without absolute identity.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd packages/storage test -- test/history-backfill.test.ts
bun run --cwd apps/cli test:file -- test/unit/app/playback-resume-from-history.test.ts
```

- [ ] **Step 3: Implement repository identity lookup**

Resolve canonical ID, aliases, then legacy raw ID; always build exact episode keys. Title-level latest history is used only when no explicit episode exists.

- [ ] **Step 4: Update all callers and run**

```bash
bun run --cwd packages/storage test -- \
  test/history-backfill.test.ts \
  test/history-title-aliases.test.ts \
  test/history-ledger-contract.test.ts
bun run --cwd apps/cli test:file -- \
  test/unit/app/playback-resume-from-history.test.ts \
  test/unit/services/continuation/continue-watching-service.test.ts
bun run typecheck
```

- [ ] **Step 5: Commit**

Stage only the exact repository, caller, and test files changed; commit:

```bash
git commit -m "fix(history): resume only the exact selected episode"
```

### Task 7: Discard rejected history checkpoints

**Files:**

- Modify: `apps/cli/src/services/continuation/playback-history-ledger.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Create: `apps/cli/test/unit/services/continuation/playback-history-ledger.test.ts`
- Modify: `apps/cli/test/unit/services/continuation/active-playback-checkpoint.test.ts`

**Interfaces:**

```ts
export class PlaybackHistoryLedger {
  discard(): void;
}
```

- [ ] **Step 1: Add shutdown leakage regression**

```ts
test("rejected short session cannot be flushed on shutdown", () => {
  ledger.start(CONTEXT, 0);
  ledger.onProgress(4, 1400);
  const unregister = active.register(() => ledger.checkpoint());
  ledger.discard();
  unregister();
  active.flush();
  expect(history.listAllProgress()).toEqual([]);
});
```

- [ ] **Step 2: Verify failure, implement scoped cleanup, and run**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/continuation/playback-history-ledger.test.ts \
  test/unit/services/continuation/active-playback-checkpoint.test.ts
```

Implement idempotent `discard()` and a PlaybackPhase helper that unregisters only its own active checkpoint.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/services/continuation/playback-history-ledger.ts \
  apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/services/continuation/playback-history-ledger.test.ts \
  apps/cli/test/unit/services/continuation/active-playback-checkpoint.test.ts
git commit -m "fix(history): discard rejected playback checkpoints"
```

### Task 8: Align Continue and History on conservative policy

**Files:**

- Create: `apps/cli/src/services/continuation/continuation-surface-policy.ts`
- Modify: continuation engine/service/reconciliation/history view/bridge files
- Create: `apps/cli/test/unit/services/continuation/continuation-surface-policy.test.ts`

**Interfaces:**

```ts
export interface ContinuationSurfaceDecision {
  readonly state: "resume" | "next" | "new-episodes" | "upcoming" | "up-to-date" | "empty";
  readonly historyBucket: "continue" | "new-episodes" | "completed";
  readonly actionLabel: "Continue" | "Play next" | "Play local" | "Open";
  readonly target?: EpisodeIdentity;
}
```

- [ ] **Step 1: Add cross-surface agreement tests**

A finished series without release evidence must be up to date and in completed, not optimistic E+1. Unfinished exact episode is Continue; confirmed release is Play next; offline-ready is Play local.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/continuation/continuation-surface-policy.test.ts \
  test/unit/app-shell/history-view.test.ts \
  test/unit/services/continuation/continue-watching-service.test.ts
```

- [ ] **Step 3: Route all visible surfaces through the projection**

Remove or isolate the optimistic increment branch so no startup/history/post-play caller uses it.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/continuation/continuation-surface-policy.test.ts \
  test/unit/services/continuation/continuation-engine.test.ts \
  test/unit/services/continuation/continue-watching-service.test.ts \
  test/unit/app-shell/history-view.test.ts \
  test/unit/domain/continuation/history-reconciliation.test.ts
git commit -m "fix(continuation): align Continue and History policy"
```

### Task 9: Make the post-play queue hero executable

**Files:**

- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/post-play-view.ts`
- Modify: `apps/cli/src/app-shell/playback-mount-shell.tsx`
- Modify: `apps/cli/src/app/playback/run-post-playback-menu.ts`
- Modify post-play tests

**Interfaces:**

```ts
export type PlaybackShellResult =
  | ShellAction
  | {
      readonly type: "play-queue-entry";
      readonly queueEntryId: string;
    };
```

- [ ] **Step 1: Add executable-hero tests**

Assert queue-backed complete/caught-up states put `queue-next` first and resolve Enter/`n` to the captured queue ID.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/post-play-up-next.test.ts \
  test/unit/app-shell/post-play-menu-action.test.ts \
  test/unit/app/playback/run-post-playback-menu.test.ts
```

- [ ] **Step 3: Add exact queue action**

Snapshot queue ID/label from one `peekNext()`, render the action, call `beginPlayback(id, "post-play")`, and never substitute a reordered head.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/post-play-up-next.test.ts \
  test/unit/app-shell/post-play-menu-action.test.ts \
  test/unit/app-shell/post-play-view.test.ts \
  test/unit/app/playback/run-post-playback-menu.test.ts
git commit -m "fix(post-play): execute the advertised queued item"
```

### Task 10: Document and integration-test the queue contract

**Files:**

- Modify: `.docs/architecture.md`
- Modify: `.docs/runtime-boundary-map.md`
- Modify: `.docs/testing-strategy.md`
- Create: `apps/cli/test/integration/queue-playback-lifecycle.test.ts`

- [ ] **Step 1: Add deterministic fake-player integration smoke**

Prove manual claim/ack, auto-next exact ID, failed launch rollback, crash leaves in-flight, restart restores exact row first, and shell returns after playback.

- [ ] **Step 2: Run focused and repository gates**

```bash
bun run --cwd apps/cli test:integration -- test/integration/queue-playback-lifecycle.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
```

- [ ] **Step 3: Commit**

```bash
git add .docs/architecture.md .docs/runtime-boundary-map.md \
  .docs/testing-strategy.md \
  apps/cli/test/integration/queue-playback-lifecycle.test.ts
git commit -m "test(queue): prove playback acknowledgement and recovery"
```
