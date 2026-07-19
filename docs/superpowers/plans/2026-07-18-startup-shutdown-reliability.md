# Startup and Shutdown Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the verified startup-latency optimization and make every handled Kunai exit fast, coordinated, bounded, and safe for playback, configuration, download, queue, and diagnostic state.

**Architecture:** Keep the existing direct Bun development entrypoint and demand-loaded root-overlay boundary. Add one pure, testable shutdown coordinator in the app/session layer; route shell, normal, signal, and fatal exits through it; let services own quiescence, persistence, and resource cleanup behind explicit methods. Restore the terminal before slow cleanup, preserve critical state before terminating external processes or closing SQLite, and retain synchronous child-process kill backstops.

**Tech Stack:** Bun, TypeScript, React/Ink, SQLite through `@kunai/storage`, Bun test runner through repository scripts, tmux for real-terminal startup/shutdown smoke.

## Global Constraints

- Runtime commands use `bun`, `bunx`, and `bun run`; never invoke `bun test` directly.
- Do not modify Notifications Inbox implementation files or tests. In particular, do not edit `apps/cli/src/app-shell/use-notifications-overlay-input.ts` or `apps/cli/test/unit/app-shell/use-notifications-overlay-input.test.ts`.
- Preserve unrelated changes in `apps/docs/package.json`, `apps/docs/lib/generated-metadata.json`, `bun.lock`, root `package.json` dependency/version/catalog hunks, and `.plans/HANDOFF-2026-07-17.md`.
- The startup task owns only the root `package.json` `scripts.dev` hunk.
- Do not use live Kunai config, data, cache, watch history, or download state for manual probes. Use an empty XDG shadow profile.
- Active playback shutdown policy is **save then stop**: checkpoint the latest known position/watch time before closing mpv.
- Shutdown policy is **critical data first**: restore the terminal immediately, preserve critical state, then give integrations bounded best-effort cleanup.
- Normal quit exits `0`; `SIGINT` exits `130`; `SIGTERM` exits `143`; `SIGHUP` exits `129`; fatal exceptions/rejections exit nonzero.
- Do not build a generic lifecycle framework. Add only the boundaries required by this plan.
- Do not commit implementation changes unless the user separately authorizes implementation commits. Each task ends with a diff/status checkpoint instead.

---

## File Structure

### New files

- `apps/cli/src/app/session/shutdown-coordinator.ts` — pure shutdown intent/state machine, phase ordering, re-entry, fatal escalation, and global deadline.
- `apps/cli/src/app/session/shutdown-request.ts` — process-local request bridge used by Ink surfaces without importing `main.ts`.
- `apps/cli/src/services/continuation/active-playback-checkpoint.ts` — session-scoped registry for exactly one active playback checkpoint callback.
- `apps/cli/test/unit/app/shutdown-coordinator.test.ts` — pure coordinator behavior and deadline tests.
- `apps/cli/test/unit/app-shell/shutdown-request-routing.test.tsx` — focused Ink/input routing coverage where source-level tests are insufficient.
- `apps/cli/test/unit/services/continuation/active-playback-checkpoint.test.ts` — active checkpoint registration, replacement, and idempotence.
- `apps/cli/test/unit/container/dispose-container.test.ts` — disposal ordering, isolation, and idempotence.
- `apps/cli/test/integration/process-shutdown.test.ts` — subprocess signal exit-code and terminal/process cleanup assertions using shadow XDG directories.

### Modified files

- `package.json` — keep only `scripts.dev = "bun apps/cli/src/main.ts"` from startup work.
- `apps/cli/src/main.ts` — replace the guarded-shutdown implementation with coordinator wiring and route normal, signal, and fatal exits through it.
- `apps/cli/src/app-shell/ink-shell.tsx` — remove shell-local exit handlers and request coordinated shutdown.
- `apps/cli/src/app-shell/shell-frame.tsx`
- `apps/cli/src/app-shell/browse-shell.tsx`
- `apps/cli/src/app-shell/loading-shell.tsx`
- `apps/cli/src/app-shell/checklist-shell.tsx` — replace `requestHardExit` imports/calls with the shared request bridge.
- `apps/cli/src/app-shell/graceful-exit.ts` — delete after all callers move to `shutdown-request.ts`.
- `apps/cli/src/app/session/SessionController.ts` — split synchronous quiescence from external resource release.
- `apps/cli/src/app/playback/PlaybackPhase.ts` — register and clear the active ledger checkpoint and checkpoint abort paths.
- `apps/cli/src/container/types.ts` — expose `activePlaybackCheckpoint` on `Container`.
- `apps/cli/src/container/bootstrap-services.ts` — construct and return `ActivePlaybackCheckpoint`.
- `apps/cli/src/container/dispose-container.ts` — idempotent, independently isolated disposal with scheduler quiescence.
- `apps/cli/src/domain/queue/QueueService.ts` — persist current session as recoverable when pending items remain, otherwise closed.
- `apps/cli/src/services/persistence/ConfigService.ts` — add `flushPending(): Promise<void>`.
- `apps/cli/src/services/persistence/ConfigServiceImpl.ts` — immediate pending-save flush with rejection propagation.
- `apps/cli/src/services/download/DownloadService.ts` — close work admission before snapshotting jobs and honor a bounded shutdown budget.
- `apps/cli/src/services/background/BackgroundWorkScheduler.ts` — reject new work and abort queued/running background work during shutdown.
- `apps/cli/src/services/update/BinaryAutoUpdater.ts` — stop the process-lifetime update interval during quiescence.
- `apps/cli/src/services/update/native-installer/version-lock.ts` — remove competing signal exits and expose coordinated lifetime-lock release.
- Existing focused test files listed in each task below.

---

### Task 1: Finish and verify the startup optimization

**Files:**

- Modify: `package.json:61-63`
- Verify: `apps/cli/src/app-shell/root-content-shell.tsx`
- Verify: `apps/cli/src/app-shell/root-overlay-loader.tsx`
- Verify: `apps/cli/src/app-shell/ink-shell.tsx`
- Test: `apps/cli/test/unit/architecture/dev-entrypoint.test.ts`
- Test: `apps/cli/test/unit/app-shell/root-overlay-loader.test.tsx`

**Interfaces:**

- Consumes: existing `RootOverlayLoader` component and root shell startup path.
- Produces: direct root development entrypoint and verified lazy-overlay behavior; no new runtime API.

- [ ] **Step 1: Protect unrelated root package hunks**

Run:

```sh
git diff -- package.json apps/docs/package.json apps/docs/lib/generated-metadata.json bun.lock > "$CLAUDE_JOB_DIR/tmp/protected-package-wip.patch"
git status --short
```

Expected: the patch records all pre-existing package/dependency WIP; no file is modified by this step.

- [ ] **Step 2: Verify the root development script contains only the intended startup change**

The owned hunk must be:

```json
{
  "scripts": {
    "dev": "bun apps/cli/src/main.ts"
  }
}
```

Do not modify dependency, catalog, or workspace fields in `package.json`.

- [ ] **Step 3: Run the focused startup tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/architecture/dev-entrypoint.test.ts \
  test/unit/architecture/boundary-imports.test.ts \
  test/unit/app/bootstrap/startup-setup.test.ts \
  test/unit/app/search/search-startup-policy.test.ts \
  test/unit/app-shell/root-overlay-loader.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx \
  test/unit/services/diagnostics/cli-startup-milestone.test.ts
```

Expected: all listed tests pass and the loader test proves Escape closes the loading scaffold.

- [ ] **Step 4: Stop only the stale profiling session if it exists**

Run:

```sh
if tmux has-session -t kunai-debug-lazy-1784270556233673286 2>/dev/null; then
  tmux kill-session -t kunai-debug-lazy-1784270556233673286
fi
```

Expected: only that exact session is removed; other tmux sessions remain untouched.

- [ ] **Step 5: Create an empty completed-onboarding shadow profile**

Run:

```sh
SHADOW="$CLAUDE_JOB_DIR/tmp/startup-shadow"
rm -rf "$SHADOW"
mkdir -p "$SHADOW/config/kunai" "$SHADOW/data/kunai" "$SHADOW/cache/kunai"
printf '%s\n' '{"onboardingVersion":2,"downloadOnboardingDismissed":true}' \
  > "$SHADOW/config/kunai/config.json"
```

Expected: no live user path is read or written.

- [ ] **Step 6: Drive the corrected startup path in tmux**

Launch with:

```sh
tmux new-session -d -s kunai-startup-smoke \
  "env XDG_CONFIG_HOME='$SHADOW/config' XDG_DATA_HOME='$SHADOW/data' XDG_CACHE_HOME='$SHADOW/cache' BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun run dev"
```

Verify in the attached session:

1. `Search title` is the first useful surface.
2. Immediate typing remains visible.
3. Open `/notifications` only as a generic root-overlay loader smoke.
4. If the loading scaffold appears, press Escape and confirm it closes.
5. Reopen the overlay and confirm it renders.
6. Open Help or History.
7. Confirm there is no blank terminal, duplicate footer, lost input, or crash.

Do not inspect or change Notifications Inbox behavior.

- [ ] **Step 7: Record three controlled cold samples**

For each sample, recreate only the shadow cache directory, launch with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, and record the first useful Search paint timestamp using the existing startup milestone/debug output. Save results to:

```text
$CLAUDE_JOB_DIR/tmp/startup-cold-samples.txt
```

Record all three samples and compare them to the 2.1–2.2 second baseline. Do not claim a stable threshold from one run.

- [ ] **Step 8: Check the startup diff**

Run:

```sh
git diff --check
git diff -- package.json apps/cli/src/app-shell/root-content-shell.tsx \
  apps/cli/src/app-shell/root-overlay-loader.tsx apps/cli/src/app-shell/ink-shell.tsx \
  apps/cli/test/unit/architecture/dev-entrypoint.test.ts \
  apps/cli/test/unit/app-shell/root-overlay-loader.test.tsx
git status --short
```

Expected: no unrelated package hunk changed and no Notifications file appears in the startup diff.

---

### Task 2: Add the pure shutdown coordinator

**Files:**

- Create: `apps/cli/src/app/session/shutdown-coordinator.ts`
- Create: `apps/cli/test/unit/app/shutdown-coordinator.test.ts`
- Later remove/replace: shutdown state in `apps/cli/src/main.ts:86-148`

**Interfaces:**

- Produces:

```ts
export type ShutdownIntent = {
  readonly reason: string;
  readonly exitCode: number;
  readonly fatal?: boolean;
};

export type ShutdownRuntime = {
  quiesce(intent: ShutdownIntent): Promise<void>;
  restoreTerminal(intent: ShutdownIntent): Promise<void>;
  preserveCriticalState(intent: ShutdownIntent): Promise<void>;
  releaseExternalResources(intent: ShutdownIntent, signal: AbortSignal): Promise<void>;
  dispose(intent: ShutdownIntent): Promise<void>;
  recordFailure(phase: ShutdownPhase, error: unknown): void;
  unrefStdin(): void;
  exit(code: number): void;
};

export type ShutdownCoordinator = {
  request(intent: ShutdownIntent): Promise<void>;
  isShuttingDown(): boolean;
};

export function createShutdownCoordinator(
  runtime: ShutdownRuntime,
  options?: { readonly deadlineMs?: number },
): ShutdownCoordinator;
```

- [ ] **Step 1: Write coordinator tests first**

Create tests covering ordered phases, one in-flight promise, fatal exit-code escalation, per-phase failure isolation, and force deadline. The core order assertion is:

```ts
expect(calls).toEqual([
  "quiesce:SIGINT",
  "terminal:SIGINT",
  "preserve:SIGINT",
  "release:SIGINT",
  "dispose:SIGINT",
  "stdin:unref",
  "exit:130",
]);
```

The escalation test starts a normal request, blocks `preserveCriticalState`, submits `{ fatal: true, exitCode: 1 }`, releases the gate, and expects one cleanup sequence with `exit:1`.

The failure-isolation test throws from `restoreTerminal` and asserts `preserve`, `release`, and `dispose` still execute and `recordFailure("restore-terminal", error)` is called.

Use fake timers for the force deadline so the test does not wait four real seconds.

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/shutdown-coordinator.test.ts
```

Expected: FAIL because `shutdown-coordinator.ts` does not exist.

- [ ] **Step 3: Implement the coordinator**

Use one internal `inFlight` promise, mutable `finalExitCode`, and a deadline `AbortController`. Run every phase through an isolated helper:

```ts
async function runPhase(
  phase: ShutdownPhase,
  run: () => Promise<void>,
  runtime: ShutdownRuntime,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    runtime.recordFailure(phase, error);
  }
}
```

`request()` must update `finalExitCode` before returning the existing promise:

```ts
if (intent.fatal || intent.exitCode !== 0) {
  finalExitCode = finalExitCode === 0 ? intent.exitCode : Math.max(finalExitCode, intent.exitCode);
}
if (inFlight) return inFlight;
```

Start the deadline once. On timeout, abort the release signal, unref stdin, and call `exit(finalExitCode)`. In the normal path, clear the timer, unref stdin, and exit exactly once.

- [ ] **Step 4: Run coordinator tests**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/app/shutdown-coordinator.test.ts
```

Expected: PASS with no real-time four-second delay.

- [ ] **Step 5: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/app/session/shutdown-coordinator.ts \
  apps/cli/test/unit/app/shutdown-coordinator.test.ts
git status --short
```

Expected: only the coordinator and its test are new for this task.

---

### Task 3: Route every Ink exit through the shared request bridge

**Files:**

- Create: `apps/cli/src/app/session/shutdown-request.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx:519-557,974,1338-1341,1618-1621,2066-2075`
- Modify: `apps/cli/src/app-shell/shell-frame.tsx:1-190`
- Modify: `apps/cli/src/app-shell/browse-shell.tsx:83,994-998`
- Modify: `apps/cli/src/app-shell/loading-shell.tsx:5,406-410`
- Modify: `apps/cli/src/app-shell/checklist-shell.tsx:1,82-87`
- Delete: `apps/cli/src/app-shell/graceful-exit.ts`
- Create: `apps/cli/test/unit/app-shell/shutdown-request-routing.test.tsx`
- Modify: source/import guard tests if an existing architecture test is the better seam.

**Interfaces:**

- Consumes: `ShutdownIntent` from Task 2.
- Produces:

```ts
export type ShutdownRequestHandler = (intent: ShutdownIntent) => void | Promise<void>;
export function bindShutdownRequestHandler(handler: ShutdownRequestHandler): () => void;
export function requestAppShutdown(intent?: Partial<ShutdownIntent>): void;
```

- [ ] **Step 1: Write bridge and routing tests first**

Test bridge binding without exiting the process:

```ts
const received: ShutdownIntent[] = [];
const unbind = bindShutdownRequestHandler((intent) => received.push(intent));
requestAppShutdown({ reason: "shell-quit", exitCode: 0 });
expect(received).toEqual([{ reason: "shell-quit", exitCode: 0, fatal: false }]);
unbind();
```

Add a focused Ink test proving Ctrl+C from a nested surface invokes the bound handler once. Add a source guard asserting no app-shell file imports `graceful-exit` or calls `process.exit()` for interactive quit.

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app-shell/shutdown-request-routing.test.tsx \
  test/unit/app-shell/input-router.useinput.test.tsx
```

Expected: FAIL because the bridge is missing and callers still use `requestHardExit`.

- [ ] **Step 3: Implement the request bridge**

Maintain one handler. `requestAppShutdown()` normalizes defaults to:

```ts
{
  reason: "shell-quit",
  exitCode: 0,
  fatal: false,
}
```

If called before binding, fall back to `process.kill(process.pid, "SIGINT")`; never call `process.exit()` from the bridge.

- [ ] **Step 4: Replace all shell-local hard exits**

Replace imports and calls:

```ts
requestHardExit(0);
```

with:

```ts
requestAppShutdown({ reason: "shell-quit", exitCode: 0 });
```

For Ctrl+C use reason `SIGINT` and exit code `130`. Remove the three `registerExitHandler` effects from `AppRoot`; coordinator runtime owns presence, player, and download cleanup.

Delete `apps/cli/src/app-shell/graceful-exit.ts` only after:

```sh
rg -n "requestHardExit|registerExitHandler|graceful-exit" apps/cli/src apps/cli/test
```

returns no matches.

- [ ] **Step 5: Run shell routing tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app-shell/shutdown-request-routing.test.tsx \
  test/unit/app-shell/input-router.useinput.test.tsx \
  test/unit/app-shell/browse-first-paint.useinput.test.tsx
```

Expected: PASS; nested and root surfaces request the same coordinated path.

- [ ] **Step 6: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/app/session/shutdown-request.ts apps/cli/src/app-shell \
  apps/cli/test/unit/app-shell/shutdown-request-routing.test.tsx
git status --short
```

Expected: no Notifications Inbox file is modified.

---

### Task 4: Quiesce session, downloads, background work, and updater

**Files:**

- Modify: `apps/cli/src/app/session/SessionController.ts:28-56`
- Modify: `apps/cli/src/services/download/DownloadService.ts:179-192,576-604,637-680,966-1003`
- Modify: `apps/cli/src/services/background/BackgroundWorkScheduler.ts:41-85,101-142`
- Modify: `apps/cli/src/services/update/BinaryAutoUpdater.ts:24-109`
- Modify: `apps/cli/test/unit/app/session-controller-shutdown.test.ts`
- Modify: `apps/cli/test/unit/services/download/download-service.test.ts`
- Modify: `apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts`
- Modify or create: `apps/cli/test/unit/services/update/BinaryAutoUpdater.test.ts`

**Interfaces:**

- Produces:

```ts
SessionController.beginShutdown(): void;
SessionController.releaseExternalResources(): Promise<void>;

DownloadService.beginShutdown(reason?: string): void;
DownloadService.pauseActiveJobsForShutdown(
  reason?: string,
  options?: { readonly gracefulWaitMs?: number; readonly forceWaitMs?: number; readonly inactiveWaitMs?: number },
): Promise<void>;

BackgroundWorkScheduler.beginShutdown(
  reason?: "container-dispose" | "app-exit",
): void;
BackgroundWorkScheduler.enqueue(item: BackgroundWorkItem): boolean;

BinaryAutoUpdater.stopBackground(): void;
```

- [ ] **Step 1: Write quiescence tests first**

Add assertions that:

- `SessionController.beginShutdown()` calls `player.beginShutdown`, cancels active work, aborts orphan resolve/session work, and is idempotent without releasing mpv/Discord.
- `releaseExternalResources()` uses `Promise.allSettled` and records failures.
- `DownloadService.beginShutdown()` prevents `processQueue()` from claiming queued jobs.
- `pauseActiveJobsForShutdown()` calls `beginShutdown()` before reading running jobs and leaves jobs retryable.
- `BackgroundWorkScheduler.enqueue()` returns `false` after `beginShutdown()` and active work receives an aborted signal.
- `BinaryAutoUpdater.stopBackground()` clears the interval and is idempotent.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app/session-controller-shutdown.test.ts \
  test/unit/services/download/download-service.test.ts \
  test/unit/services/background/BackgroundWorkScheduler.test.ts \
  test/unit/services/update/BinaryAutoUpdater.test.ts
```

Expected: FAIL on missing quiescence APIs.

- [ ] **Step 3: Split SessionController shutdown responsibilities**

Add an idempotent `shutdownStarted` field. `beginShutdown()` performs only synchronous admission/cancellation work:

```ts
public beginShutdown(): void {
  if (this.shutdownStarted) return;
  this.shutdownStarted = true;
  this.container.player.beginShutdown();
  this.container.workControl.cancelActive("shutdown");
  abortOrphanDownloadResolve(this.container);
  this.abortController.abort("shutdown");
}
```

Move player/presence cleanup into `releaseExternalResources()`. Keep `shutdown()` temporarily as a compatibility wrapper calling both methods until Task 7 removes old call sites.

- [ ] **Step 4: Gate new downloads before taking the shutdown snapshot**

Add `private shutdownRequested = false`. `beginShutdown()` sets it and records cancellation requests for current running jobs. `processQueue()` returns immediately when shutting down, and each worker loop checks the flag before calling `processNextQueued()` again.

Pass explicit shutdown waits into `terminateProcess()` rather than allowing two independent 2.5-second waits plus a five-second inactive wait. The defaults used outside shutdown keep existing behavior; shutdown calls provide budgets that fit the coordinator deadline.

- [ ] **Step 5: Quiesce background work**

Track controllers for active items. `beginShutdown()`:

- records shutdown diagnostics once;
- rejects future enqueues by returning `false`;
- aborts active controllers;
- leaves `drain()` responsible for collecting skipped outcomes.

Do not throw from `enqueue()` after shutdown; background callers already ignore its return value and should not crash during teardown.

- [ ] **Step 6: Stop the binary updater interval**

Move the module-level interval lifecycle behind:

```ts
stopBackground(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}
```

Do not cancel an already-running update install in this task; stopping future interval work is the safe bounded change.

- [ ] **Step 7: Run focused tests**

Run the Step 2 command again.

Expected: PASS; download and background admission close synchronously.

- [ ] **Step 8: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/app/session/SessionController.ts \
  apps/cli/src/services/download/DownloadService.ts \
  apps/cli/src/services/background/BackgroundWorkScheduler.ts \
  apps/cli/src/services/update/BinaryAutoUpdater.ts \
  apps/cli/test/unit/app/session-controller-shutdown.test.ts \
  apps/cli/test/unit/services/download/download-service.test.ts \
  apps/cli/test/unit/services/background/BackgroundWorkScheduler.test.ts
git status --short
```

---

### Task 5: Preserve playback, config, and queue state before resource teardown

**Files:**

- Create: `apps/cli/src/services/continuation/active-playback-checkpoint.ts`
- Create: `apps/cli/test/unit/services/continuation/active-playback-checkpoint.test.ts`
- Modify: `apps/cli/src/services/persistence/ConfigService.ts:39-47`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts:140-143,659-693`
- Modify: `apps/cli/test/unit/services/persistence/config-save-debounce.test.ts`
- Modify: `apps/cli/src/domain/queue/QueueService.ts:23-29,176-197`
- Modify: `apps/cli/test/unit/domain/queue/QueueService.test.ts`
- Modify: `apps/cli/src/container/types.ts:153-170`
- Modify: `apps/cli/src/container/bootstrap-services.ts:254-304,397-467`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts:202,1909-1945,1978-1987,3160-3168`
- Add focused playback test in the nearest existing `PlaybackPhase`/history ledger test seam.

**Interfaces:**

- Produces:

```ts
export class ActivePlaybackCheckpoint {
  register(checkpoint: () => void): () => void;
  flush(): void;
  clear(): void;
}

ConfigService.flushPending(): Promise<void>;

QueueService.prepareForShutdown(at?: string): "recoverable" | "closed";
```

- [ ] **Step 1: Write active playback checkpoint tests**

Test that:

```ts
const checkpoints: string[] = [];
const active = new ActivePlaybackCheckpoint();
const unregister = active.register(() => checkpoints.push("first"));
active.flush();
unregister();
active.flush();
expect(checkpoints).toEqual(["first"]);
```

Also test that registering a new callback replaces the prior callback and that a stale unregister function cannot clear the replacement.

- [ ] **Step 2: Write config flush tests**

Add tests proving:

1. `flushPending()` immediately persists without waiting 300 ms.
2. Multiple save callers share the same write.
3. Store rejection rejects both `save()` and `flushPending()`.
4. Calling `flushPending()` with no pending write is a no-op.

Use a deferred fake store rather than real timers for rejection propagation.

- [ ] **Step 3: Write queue shutdown tests**

In `QueueService.test.ts`, create an active current session with one pending item and assert:

```ts
expect(service.prepareForShutdown("2026-07-18T00:00:00.000Z")).toBe("recoverable");
expect(repo.getQueueSession("current")?.status).toBe("recoverable");
```

Create an empty active session and assert it becomes `closed` with `closedAt` set.

- [ ] **Step 4: Run the new tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/services/continuation/active-playback-checkpoint.test.ts \
  test/unit/services/persistence/config-save-debounce.test.ts \
  test/unit/domain/queue/QueueService.test.ts
```

Expected: FAIL on missing APIs.

- [ ] **Step 5: Implement ActivePlaybackCheckpoint**

Use a monotonically increasing registration token so stale cleanup cannot remove a newer callback:

```ts
export class ActivePlaybackCheckpoint {
  private registration = 0;
  private checkpoint: (() => void) | null = null;

  register(checkpoint: () => void): () => void {
    const registration = ++this.registration;
    this.checkpoint = checkpoint;
    return () => {
      if (this.registration === registration) this.checkpoint = null;
    };
  }

  flush(): void {
    this.checkpoint?.();
  }

  clear(): void {
    this.registration += 1;
    this.checkpoint = null;
  }
}
```

Construct it in `bootstrapServices`, return it, and add it to `Container`.

- [ ] **Step 6: Register the playback ledger checkpoint**

When `PlaybackPhase` creates a `PlaybackHistoryLedger`, register `() => ledger.checkpoint()`. Store the unregister callback on the phase. Clear it after normal `finalize()` and on every cancellation/error path after issuing one last `checkpoint()`.

The shutdown order must allow `container.activePlaybackCheckpoint.flush()` before `player.releasePersistentSession()`.

- [ ] **Step 7: Refactor config debounce around one pending write**

Add `flushPending()` to the interface. Track resolve and reject callbacks. Move the actual write into a private `persistPendingSave()` that settles the shared pending promise exactly once. The timer calls that helper; `flushPending()` clears the timer and invokes the same helper immediately.

Do not swallow `store.save()` failures. Callers waiting on `save()` or `flushPending()` must receive the rejection so shutdown can record it.

- [ ] **Step 8: Implement queue shutdown state**

`prepareForShutdown(at = new Date().toISOString())` checks `repo.countUnplayed(sessionId)`:

- if greater than zero, call `markQueueSessionRecoverable(sessionId, at)` and return `"recoverable"`;
- otherwise call `closeQueueSession(sessionId, at)` and return `"closed"`.

Do not generate Notifications during shutdown; startup recovery remains responsible for signals.

- [ ] **Step 9: Run focused persistence tests**

Run the Step 4 command plus the focused playback test chosen in Step 6.

Expected: PASS; active playback can be checkpointed without waiting for mpv to return.

- [ ] **Step 10: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/services/continuation \
  apps/cli/src/services/persistence/ConfigService.ts \
  apps/cli/src/services/persistence/ConfigServiceImpl.ts \
  apps/cli/src/domain/queue/QueueService.ts apps/cli/src/container/types.ts \
  apps/cli/src/container/bootstrap-services.ts apps/cli/src/app/playback/PlaybackPhase.ts \
  apps/cli/test/unit/services/continuation \
  apps/cli/test/unit/services/persistence/config-save-debounce.test.ts \
  apps/cli/test/unit/domain/queue/QueueService.test.ts
git status --short
```

Expected: no Notifications source or test file is changed.

---

### Task 6: Coordinate lifetime-lock release and make container disposal resilient

**Files:**

- Modify: `apps/cli/src/services/update/native-installer/version-lock.ts:122-154`
- Modify: `apps/cli/src/services/update/native-installer/index.ts`
- Modify: `apps/cli/test/unit/services/update/native-installer/version-lock.test.ts`
- Modify: `apps/cli/src/container/dispose-container.ts`
- Create: `apps/cli/test/unit/container/dispose-container.test.ts`

**Interfaces:**

- Produces:

```ts
export async function releaseCurrentVersionLock(): Promise<void>;

export async function disposeContainer(container: Container | null | undefined): Promise<void>;
```

`disposeContainer` keeps its public signature but becomes concurrent-call-safe and independently isolated.

- [ ] **Step 1: Write version-lock lifecycle tests**

Acquire a lifetime lock using a temporary versioned layout and executable path, assert the lock file exists, call `releaseCurrentVersionLock()`, and assert it is removed. Assert a second release is a no-op.

Add a source/runtime assertion that `lockCurrentVersion()` no longer registers `SIGINT` or `SIGTERM` handlers and never calls `process.exit()`.

- [ ] **Step 2: Write container disposal tests**

Create a minimal fake container/handle set and assert order:

```ts
expect(calls).toEqual([
  "scheduler:shutdown",
  "scheduler:drain",
  "diagnostics:flush",
  "data:close",
  "cache:close",
  "observer:unbind",
]);
```

Make data DB close throw and assert cache close plus observer unbind still occur. Call `disposeContainer()` twice concurrently and assert every resource runs once.

- [ ] **Step 3: Run tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/services/update/native-installer/version-lock.test.ts \
  test/unit/container/dispose-container.test.ts
```

Expected: FAIL on missing release API/idempotence behavior.

- [ ] **Step 4: Replace competing lifetime-lock signal handlers**

Store the acquired release callback in module state. `releaseCurrentVersionLock()` atomically clears the stored callback before awaiting it, so concurrent releases invoke it once. Remove `process.once("SIGINT")`, `process.once("SIGTERM")`, and asynchronous `exit` cleanup from `lockCurrentVersion()`.

Export the release function from `native-installer/index.ts`.

- [ ] **Step 5: Make container disposal idempotent and isolated**

Add a `WeakMap<Container, Promise<void>>` for in-flight disposal. Delete the registered handles only after capturing them, then run each operation through a local best-effort helper. Always unbind the network observer in `finally`.

Call `backgroundWorkScheduler.beginShutdown("container-dispose")` before `drain()`.

- [ ] **Step 6: Run focused tests**

Run the Step 3 command again.

Expected: PASS; no signal listener can preempt coordinated shutdown.

- [ ] **Step 7: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/services/update/native-installer \
  apps/cli/src/container/dispose-container.ts \
  apps/cli/test/unit/services/update/native-installer/version-lock.test.ts \
  apps/cli/test/unit/container/dispose-container.test.ts
git status --short
```

---

### Task 7: Wire the coordinator into main and remove duplicate shutdown paths

**Files:**

- Modify: `apps/cli/src/main.ts:86-148,504-543,880-964`
- Modify: `apps/cli/test/unit/app/crash-handler-shutdown.test.ts`
- Modify: `apps/cli/test/unit/architecture/boundary-imports.test.ts` if needed.

**Interfaces:**

- Consumes: coordinator from Task 2, request bridge from Task 3, quiescence APIs from Task 4, persistence APIs from Task 5, lock/disposal APIs from Task 6.
- Produces: one configured process shutdown path for normal, shell, signal, and fatal exits.

- [ ] **Step 1: Rewrite crash-handler tests around the coordinator runtime**

Replace tests importing `runGuardedShutdown` with tests of the configured main runtime or exported test seam. Assert the concrete phase order:

1. controller/download/scheduler/updater quiescence;
2. shell shutdown;
3. playback/config/download/queue/diagnostic preservation;
4. player/presence/download/lifetime-lock external release;
5. container disposal;
6. final exit.

Add fatal escalation and conventional signal-code cases.

- [ ] **Step 2: Run the focused main tests and confirm failure**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app/crash-handler-shutdown.test.ts \
  test/unit/app/shutdown-coordinator.test.ts
```

Expected: FAIL because `main.ts` still exposes the old guarded runtime.

- [ ] **Step 3: Build the concrete runtime in main.ts**

Create one coordinator after process globals are declared. Runtime phases perform:

```ts
quiesce: async () => {
  globalController?.beginShutdown();
  globalContainer?.downloadService.beginShutdown("download paused by shutdown");
  globalContainer?.backgroundWorkScheduler.beginShutdown("app-exit");
  globalContainer?.binaryAutoUpdater.stopBackground();
},
restoreTerminal: async () => {
  await shutdownShell();
},
preserveCriticalState: async () => {
  await Promise.allSettled([
    Promise.resolve().then(() => globalContainer?.activePlaybackCheckpoint.flush()),
    globalContainer?.config.flushPending(),
    globalContainer?.downloadService.pauseActiveJobsForShutdown("download paused by shutdown", {
      gracefulWaitMs: 500,
      forceWaitMs: 500,
      inactiveWaitMs: 500,
    }),
    Promise.resolve().then(() => globalContainer?.queueService.prepareForShutdown()),
    Promise.resolve().then(() => globalContainer?.diagnosticsService.flush()),
  ]);
},
releaseExternalResources: async (_intent, signal) => {
  await Promise.allSettled([
    globalController?.releaseExternalResources(),
    releaseCurrentVersionLock(),
  ]);
  signal.throwIfAborted();
},
dispose: async () => {
  await disposeContainer(globalContainer);
},
```

Do not duplicate presence shutdown outside `SessionController.releaseExternalResources()`.

Record phase failures through `diagnosticsService.record(...)` when available, otherwise logger/console.

- [ ] **Step 4: Bind shell requests to the coordinator**

At CLI initialization, bind:

```ts
unbindShutdownRequest = bindShutdownRequestHandler((intent) => shutdownCoordinator.request(intent));
```

Ensure unbinding occurs during final disposal or test reset. The shell never imports `main.ts`.

- [ ] **Step 5: Route normal and fatal completion through the coordinator**

Replace the cleanup body after `globalController.run()` with:

```ts
await shutdownCoordinator.request({ reason: "normal exit", exitCode: 0 });
```

Replace the catch cleanup body with:

```ts
console.error("Fatal error:", error);
await shutdownCoordinator.request({ reason: "fatal error", exitCode: 1, fatal: true });
```

Do not call `process.exit()` directly in those live-application paths.

- [ ] **Step 6: Use conventional signal statuses**

Register:

```ts
process.on("SIGINT", () => void requestSignalShutdown("SIGINT", 130));
process.on("SIGTERM", () => void requestSignalShutdown("SIGTERM", 143));
process.on("SIGHUP", () => void requestSignalShutdown("SIGHUP", 129));
```

Uncaught exceptions and unhandled rejections request fatal exit `1`. Keep synchronous `process.on("exit")` child-process kill backstops.

- [ ] **Step 7: Track lifetime-lock acquisition before release**

Store the startup lifetime-lock promise in a module-level variable. The external-release phase awaits acquisition before calling `releaseCurrentVersionLock()` so shutdown cannot race a late lock acquisition.

Do not await version cleanup or old-binary cleanup on the startup critical path.

- [ ] **Step 8: Remove old shutdown code**

Delete `shutdownInProgress`, `GuardedShutdownRuntime`, `createGuardedShutdownRuntime`, `runGuardedShutdown`, and its old test reset seam. Search:

```sh
rg -n "runGuardedShutdown|GuardedShutdownRuntime|shutdownInProgress|requestHardExit|registerExitHandler" apps/cli/src apps/cli/test
```

Expected: no matches.

- [ ] **Step 9: Run focused main/session tests**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app/shutdown-coordinator.test.ts \
  test/unit/app/crash-handler-shutdown.test.ts \
  test/unit/app/session-controller-shutdown.test.ts \
  test/unit/app-shell/shutdown-request-routing.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Check the task diff**

Run:

```sh
git diff --check -- apps/cli/src/main.ts apps/cli/src/app/session \
  apps/cli/test/unit/app/crash-handler-shutdown.test.ts
git status --short
```

Expected: Notifications Inbox files remain untouched.

---

### Task 8: Add process-level signal and preservation coverage

**Files:**

- Create: `apps/cli/test/integration/process-shutdown.test.ts`
- Modify focused fixtures/helpers only if required; keep them under `apps/cli/test/integration/`.

**Interfaces:**

- Consumes: fully wired runtime from Task 7.
- Produces: subprocess evidence for real signal codes, bounded exit, shadow persistence, and no orphaned child process.

- [ ] **Step 1: Write a subprocess fixture strategy**

Use `Bun.spawn` with isolated environment variables:

```ts
const child = Bun.spawn(["bun", "apps/cli/src/main.ts"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: shadowConfig,
    XDG_DATA_HOME: shadowData,
    XDG_CACHE_HOME: shadowCache,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
```

Create completed-onboarding config before spawning. Never use the live profile.

- [ ] **Step 2: Add real signal exit-code cases**

Wait for the Search milestone, send `SIGINT`, `SIGTERM`, and `SIGHUP` in separate subprocesses, and assert exit codes `130`, `143`, and `129`. Apply a test-local timeout shorter than ten seconds and always force-kill the child in `finally` if it remains alive.

- [ ] **Step 3: Add terminal and storage assertions**

Capture output and assert shutdown does not end with an obvious alternate-screen/raw-mode escape imbalance. Reopen the shadow SQLite databases after exit to prove they are readable. Inspect current queue-session state and assert it is `recoverable` when a pending fixture item exists or `closed` when empty.

- [ ] **Step 4: Add bounded failure coverage through a test seam**

Use an environment-gated test-only delay/failure seam only if the existing dependency-injection seam cannot exercise a slow cleanup in-process. Prefer coordinator fake-runtime tests; do not add production behavior controlled by an undocumented environment variable unless necessary.

Assert a slow release phase cannot prevent the deadline exit and that preservation was invoked before timeout.

- [ ] **Step 5: Run the integration test**

Run:

```sh
bun run --cwd apps/cli test:file test/integration/process-shutdown.test.ts
```

Expected: PASS on Linux with no lingering child process or shadow DB lock.

- [ ] **Step 6: Run the complete focused shutdown suite**

Run:

```sh
bun run --cwd apps/cli test:file \
  test/unit/app/shutdown-coordinator.test.ts \
  test/unit/app/crash-handler-shutdown.test.ts \
  test/unit/app/session-controller-shutdown.test.ts \
  test/unit/app-shell/shutdown-request-routing.test.tsx \
  test/unit/services/continuation/active-playback-checkpoint.test.ts \
  test/unit/services/persistence/config-save-debounce.test.ts \
  test/unit/services/download/download-service.test.ts \
  test/unit/services/background/BackgroundWorkScheduler.test.ts \
  test/unit/services/update/native-installer/version-lock.test.ts \
  test/unit/container/dispose-container.test.ts \
  test/unit/domain/queue/QueueService.test.ts \
  test/integration/process-shutdown.test.ts
```

Expected: all pass.

- [ ] **Step 7: Check the task diff**

Run:

```sh
git diff --check
git status --short
```

Expected: no protected unrelated file changed beyond the pre-existing root `package.json` startup hunk.

---

### Task 9: Drive real shutdown behavior and run repository gates

**Files:**

- No planned product source changes unless smoke exposes a defect covered by this specification.
- Record artifacts under `$CLAUDE_JOB_DIR/tmp/`; do not add generated smoke output to the repository.

**Interfaces:**

- Consumes: Tasks 1–8.
- Produces: observed startup/shutdown evidence and final verification report.

- [ ] **Step 1: Recreate a clean shadow profile**

Run:

```sh
SHADOW="$CLAUDE_JOB_DIR/tmp/shutdown-shadow"
rm -rf "$SHADOW"
mkdir -p "$SHADOW/config/kunai" "$SHADOW/data/kunai" "$SHADOW/cache/kunai"
printf '%s\n' '{"onboardingVersion":2,"downloadOnboardingDismissed":true}' \
  > "$SHADOW/config/kunai/config.json"
```

- [ ] **Step 2: Smoke normal and nested exits**

Launch in tmux with shadow XDG variables. Verify:

1. Ctrl+C from Search restores the terminal immediately.
2. `/quit` from a nested surface uses the same path.
3. No duplicate footer or blank terminal remains.
4. Restart succeeds and shadow config/data/cache remain readable.

- [ ] **Step 3: Smoke active playback preservation**

Using only disposable shadow state, start a playable item, let position advance, and request shutdown. Confirm:

- latest resume position is persisted;
- mpv exits after the checkpoint;
- no mpv socket/process remains;
- restarting Kunai shows the preserved continuation state.

If a real provider is unavailable, use the nearest existing deterministic playback fixture/harness rather than live user data.

- [ ] **Step 4: Smoke download preservation**

Using a disposable fixture or controlled short download, request shutdown while active. Confirm:

- no new queued job starts after quiescence;
- the active job becomes paused/retryable;
- yt-dlp/ffmpeg is not orphaned;
- restart can resume or retry it.

- [ ] **Step 5: Re-run startup measurements after shutdown changes**

Repeat the three cold startup samples from Task 1. Confirm shutdown imports or wiring did not regress first Search paint. Report all samples before and after the shutdown implementation.

- [ ] **Step 6: Run repository verification in order**

Run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Expected: every command exits `0`. If formatting changes protected package/dependency files, restore only formatter-introduced changes while retaining their original WIP, using `$CLAUDE_JOB_DIR/tmp/protected-package-wip.patch` as the reference.

- [ ] **Step 7: Verify protected work remains intact**

Run:

```sh
git diff --check
git status --short
git diff -- apps/docs/package.json apps/docs/lib/generated-metadata.json bun.lock package.json
git diff -- apps/cli/src/app-shell/use-notifications-overlay-input.ts \
  apps/cli/test/unit/app-shell/use-notifications-overlay-input.test.ts
```

Expected: protected files retain only their pre-existing/concurrent changes; the two Notifications paths have no diff introduced by this plan.

- [ ] **Step 8: Perform one focused review**

Review only:

- root `package.json` `scripts.dev` hunk;
- startup loader boundary/test files;
- `apps/cli/src/app/session/shutdown-coordinator.ts`;
- `apps/cli/src/app/session/shutdown-request.ts`;
- shell exit-routing hunks;
- session/download/background/config/queue/playback/lifetime-lock/container lifecycle hunks;
- focused shutdown tests.

Do not run a broad audit or create product tasks outside this specification.

- [ ] **Step 9: Prepare the final report without committing**

Report:

- three startup cold samples before/after shutdown work;
- manual startup/overlay outcomes;
- normal, nested, signal, playback, and download shutdown outcomes;
- focused and full test counts;
- typecheck/lint/fmt/build status;
- any skipped smoke and exact reason;
- confirmation that Notifications Inbox and protected package/dependency work were untouched;
- `git status --short` summary.
