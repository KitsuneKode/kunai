# CLI Quality Repair Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax.

Goal: Repair confirmed CLI async failures, make manual sync truthful, characterize the playback loop, and make coverage visible in CI.

Architecture: Request identity is the immediate async-cancellation boundary. PlaybackPhase stays the orchestration owner until execution-level tests identify a safe, concrete extraction. Only the cohesive sync workflow is split from the shell workflow module.

Tech Stack: Bun 1.3, TypeScript, React 19, Ink, Bun test, local render-capture, Turbo, oxlint, oxfmt.

## Global Constraints

- Work in the current main checkout. .run.toml is tracked configuration.
- Use bun run and the local render-capture harness. Do not add ink-testing-library.
- Preserve apps/cli/src/main.ts, provider behavior, provider ordering, and live-provider contracts.
- Use deferred promises, never real-time sleeps, for new UI tests.
- Diagnostics must remain redacted: no URLs, headers, tokens, or local paths.
- Do not mechanically split PlaybackPhase.execute() or combine it with the workflow-family extraction.
- Commit every green task separately.

## Files And Ownership

- apps/cli/src/app-shell/browse-async.ts: latest-request and async-action outcome helpers.
- apps/cli/src/app-shell/browse-shell.tsx: browse launch, detail-request, and feedback wiring.
- apps/cli/src/app-shell/root-workflow-dispatch.ts: safe root-overlay workflow loader and executor.
- apps/cli/src/app-shell/root-overlay-shell.tsx: starts the safe workflow dispatcher.
- apps/cli/src/services/sync/SyncService.ts: per-entry adapter aggregate result.
- apps/cli/src/services/sync/sync-batch-summary.ts: batch aggregation and feedback copy.
- apps/cli/src/app-shell/workflows/sync-workflow.ts: interactive sync picker and batch execution.
- apps/cli/src/app-shell/workflows/shell-workflows.ts: delegates only sync actions to the extracted family.
- apps/cli/test/unit/app-shell and apps/cli/test/unit/services/sync: deterministic regression coverage.
- apps/cli/test/unit/app/playback-phase-execute.test.ts: black-box phase terminal outcomes.
- apps/cli/package.json and .github/workflows/ci.yml: coverage-report visibility.

---

### Task 1: Track The Developer Run Profiles

Files:

- Modify: .gitignore
- Create: .run.toml

Status: Complete in commit 207abb13.

- [x] Remove the .run.toml ignore rule.
- [x] Add the approved trmw profiles for dev, production bundle, binary, relay, docs, quality gates, and CI.
- [x] Commit: docs(cli): record quality repair design.

---

### Task 2: Make Browse Work Latest-Wins And Truthful

Files:

- Create: apps/cli/src/app-shell/browse-async.ts
- Modify: apps/cli/src/app-shell/browse-shell.tsx at request launch, detail overlay, and mutation handlers
- Test: apps/cli/test/unit/app-shell/browse-async.test.ts
- Test: apps/cli/test/unit/app-shell/browse-shell-async.test.tsx

Interfaces:

- Produces createLatestRequestGate with begin, isCurrent, and invalidate.
- Produces runBrowseMutation returning either ok true or ok false plus a safe message.

- [ ] Step 1: Write failing helper tests

```ts
test("latest request gate rejects a completed older request", () => {
  const gate = createLatestRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  expect(gate.isCurrent(first)).toBe(false);
  expect(gate.isCurrent(second)).toBe(true);
  gate.invalidate();
  expect(gate.isCurrent(second)).toBe(false);
});

test("browse mutation turns a rejection into safe feedback", async () => {
  const result = await runBrowseMutation(async () => {
    throw new Error("database unavailable");
  });
  expect(result).toEqual({ ok: false, message: "database unavailable" });
});
```

- [ ] Step 2: Run RED

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/browse-async.test.ts
```

Expected: fail because the helper module does not exist.

- [ ] Step 3: Implement minimal helpers

```ts
export function createLatestRequestGate() {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (id: number) => current === id,
    invalidate: () => {
      current += 1;
    },
  };
}

export async function runBrowseMutation(operation: () => Promise<void> | void) {
  try {
    await operation();
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Action failed",
    } as const;
  }
}
```

- [ ] Step 4: Wire request identity and action feedback

Replace the numeric request counter with a search gate and a details gate. Remove
the loading-state early return from search, discovery, and recommendations so a
later request can supersede an earlier one. Guard every response with
gate.isCurrent(requestId).

Call detailsGate.begin before opening details and detailsGate.invalidate when
closing any overlay. Apply fetchTitleDetail only while the matching request
remains current.

Replace every fire-and-forget browse mutation with this pattern:

```ts
void runBrowseMutation(() => onWatchlistSelected(selectedOption.value)).then((result) => {
  flashActionFeedback(
    result.ok ? "Watchlisted " + selectedOption.label : "Could not watchlist: " + result.message,
  );
});
```

Use equivalent queue and follow copy. The helper contains rejected promises and
synchronous callback throws.

- [ ] Step 5: Add render-harness regression tests

Render BrowseShell with two options and a deferred title-detail promise. Open A,
replace it with B, then resolve A. Assert the final frame retains B's title and
never includes A's delayed synopsis.

Render a rejected onWatchlistSelected, enqueue w, settle the rejection, and
assert Could not watchlist is rendered. Use render, stdin.enqueue, and a
deferred promise only.

- [ ] Step 6: Verify GREEN and commit

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/browse-async.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/browse-shell-async.test.tsx
bun run --cwd apps/cli typecheck
git add apps/cli/src/app-shell/browse-async.ts apps/cli/src/app-shell/browse-shell.tsx apps/cli/test/unit/app-shell/browse-async.test.ts apps/cli/test/unit/app-shell/browse-shell-async.test.tsx
git commit -m "fix(cli): harden browse async interactions"
```

---

### Task 3: Contain Root Overlay Workflow Failures

Files:

- Create: apps/cli/src/app-shell/root-workflow-dispatch.ts
- Modify: apps/cli/src/app-shell/root-overlay-shell.tsx
- Test: apps/cli/test/unit/app-shell/root-workflow-dispatch.test.ts

Interface: Produce runRootWorkflowSafely with injected loadWorkflow, container,
action, and optional cancelPickerId.

- [ ] Step 1: Write failing rejection tests

```ts
await runRootWorkflowSafely({
  container,
  action: "sync",
  loadWorkflow: async () => {
    throw new Error("module unavailable");
  },
});

expect(feedback()).toContain("Could not run sync");
expect(recorded[0]?.operation).toBe("shell.workflow.failed");
```

Add the same assertion for a loaded workflow that rejects. Both calls must
resolve rather than escape an unhandled rejection.

- [ ] Step 2: Run RED

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/root-workflow-dispatch.test.ts
```

- [ ] Step 3: Implement the error boundary

Await the loader and workflow. In the catch block record buildUiDiagnosticEvent
with operation shell.workflow.failed, status failed, severity recoverable, and
safe context action and detail. Dispatch this feedback:

```ts
{
  type: "SET_PLAYBACK_FEEDBACK",
  note: "Could not run " + action + ": " + message,
}
```

- [ ] Step 4: Replace the inline promise chain

```ts
void runRootWorkflowSafely({
  container,
  action,
  cancelPickerId: isRootMediaPickerOverlay(overlay) && overlay.id ? overlay.id : undefined,
});
```

No dynamic-import promise remains at the callsite.

- [ ] Step 5: Verify and commit

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/root-workflow-dispatch.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/workflows/shell-workflows-overlay.test.ts
bun run --cwd apps/cli lint
git add apps/cli/src/app-shell/root-workflow-dispatch.ts apps/cli/src/app-shell/root-overlay-shell.tsx apps/cli/test/unit/app-shell/root-workflow-dispatch.test.ts
git commit -m "fix(shell): contain root workflow failures"
```

---

### Task 4: Return Truthful Sync Results And Extract The Sync Workflow

Files:

- Create: apps/cli/src/services/sync/sync-batch-summary.ts
- Create: apps/cli/src/app-shell/workflows/sync-workflow.ts
- Modify: apps/cli/src/services/sync/SyncService.ts
- Modify: apps/cli/src/app-shell/workflows/shell-workflows.ts
- Test: apps/cli/test/unit/services/sync/SyncService.test.ts
- Test: apps/cli/test/unit/services/sync/sync-batch-summary.test.ts
- Test: apps/cli/test/unit/app-shell/workflows/sync-workflow.test.ts

Interface:

```ts
export type SyncPushSummary = {
  readonly connected: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: readonly string[];
};
```

- [ ] Step 1: Write failing aggregate tests

```ts
expect(await service.pushWatched(entry)).toEqual({
  connected: 2,
  succeeded: 1,
  failed: 1,
  failures: ["TMDB: request failed"],
});
```

Add a throwing adapter test. It returns one failure instead of rejecting. Test
batch copy for no connection, full success, and partial failure.

- [ ] Step 2: Run RED

```sh
bun run --cwd apps/cli test:file test/unit/services/sync/SyncService.test.ts
bun run --cwd apps/cli test:file test/unit/services/sync/sync-batch-summary.test.ts
```

- [ ] Step 3: Implement aggregation

For every connected adapter, await pushWatched; convert a thrown error into a
failed result; prefix failures with adapter.displayName; set lastPushFailed from
summary.failed; return the summary.

In sync-batch-summary.ts, implement emptySyncBatchSummary, mergeSyncPushSummary,
and formatSyncBatchFeedback. Render only the first two safe failures. Exact
success copy is Synced N entries to M services. Exact partial copy starts Sync
finished with N failed push(es). Zero connections render No services connected.

- [ ] Step 4: Extract only the interactive sync family

Move handleSync, handleSyncConnectAniList, handleSyncConnectTmdb, and
handleSyncDisconnect to sync-workflow.ts. Keep imports limited to pickers,
Container, and the summary helper. It must not import ink-shell.

For push-now, merge every entry result and continue after all failures. Replace
the unconditional Sync complete feedback with formatSyncBatchFeedback.

- [ ] Step 5: Add workflow coverage

Inject picker responses push-now then back, a two-entry history list, and a
failing adapter. Assert both entries are attempted and final feedback contains
failed push, not Sync complete.

- [ ] Step 6: Verify and commit

```sh
bun run --cwd apps/cli test:file test/unit/services/sync/SyncService.test.ts
bun run --cwd apps/cli test:file test/unit/services/sync/sync-batch-summary.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/workflows/sync-workflow.test.ts
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli lint
git add apps/cli/src/services/sync apps/cli/src/app-shell/workflows/sync-workflow.ts apps/cli/src/app-shell/workflows/shell-workflows.ts apps/cli/test/unit/services/sync apps/cli/test/unit/app-shell/workflows/sync-workflow.test.ts
git commit -m "fix(sync): report manual sync outcomes"
```

---

### Task 5: Characterize PlaybackPhase Execution

Files:

- Create: apps/cli/test/unit/app/playback-phase-execute.test.ts
- Read: apps/cli/test/support/container-fixture.ts
- Read: apps/cli/test/support/session-state-fixture.ts
- Read: apps/cli/src/app/playback/PlaybackPhase.ts

Interface: Consume the public PlaybackPhase.execute(title, context) method.
Produce deterministic terminal-outcome tests only. No production refactor belongs
to this task.

- [ ] Step 1: Build the smallest executable phase fixture

Start with existing container and session fixtures. Supply a typed aborted signal
for the first terminal case and no-op diagnostics, player, history, and state
dependencies only where the real phase path requires them.

- [ ] Step 2: Write the failing aborted-session test

```ts
test("execute returns its cancellation outcome without resolving after abort", async () => {
  const controller = new AbortController();
  controller.abort();
  const resolve = mock(() => Promise.reject(new Error("must not resolve")));
  const result = await new PlaybackPhase().execute(
    { id: "tmdb:1", type: "movie", name: "Demo" },
    createPlaybackPhaseContext({ signal: controller.signal, resolve }),
  );
  expect(result).toEqual(expectedCancelledPhaseResult);
  expect(resolve).not.toHaveBeenCalled();
});
```

Resolve expectedCancelledPhaseResult from the actual public PhaseResult type. Do
not reach private methods through casts.

- [ ] Step 3: Run RED, then pin the public contract

```sh
bun run --cwd apps/cli test:file test/unit/app/playback-phase-execute.test.ts
```

First make the fixture compile. Then ensure it fails only because terminal
behavior is unpinned, not because mock members are missing.

- [ ] Step 4: Add three terminal outcomes without production changes

Cover definitive resolve failure, user cancellation during startup, and a
post-play return-to-search action. Use deferred resolver/player promises and
existing public post-play actions. Assert only PhaseResult, state dispatches,
and player-cleanup boundaries.

- [ ] Step 5: Verify and commit

```sh
bun run --cwd apps/cli test:file test/unit/app/playback-phase-execute.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback-phase-events.test.ts
git add apps/cli/test/unit/app/playback-phase-execute.test.ts
git commit -m "test(playback): characterize phase execution outcomes"
```

Stop after characterization unless a concrete failing behavior identifies a
narrow production fix. The current architecture decision rejects a line-count-only
execute split.

---

### Task 6: Make CLI Coverage Visible In CI

Files:

- Modify: .github/workflows/ci.yml
- Test: bun run --cwd apps/cli test:coverage:report

- [ ] Step 1: Establish the baseline

```sh
bun run --cwd apps/cli test:coverage:report
```

Expected: exit zero and a Bun text coverage summary. Record the observed baseline
in the commit or pull request description, not a generated checked-in report.

- [ ] Step 2: Add a path-gated coverage job

Add cli-coverage to .github/workflows/ci.yml. It needs changes, runs when
changes.outputs.cli equals true, uses the existing Bun setup action, has a
20-minute timeout, and contains exactly:

```yaml
- name: CLI coverage report
  run: bun run --cwd apps/cli test:coverage:report
```

Do not set a numeric percentage threshold yet.

- [ ] Step 3: Verify and commit

```sh
bun run --cwd apps/cli test:coverage:report
bun run fmt:check
git add .github/workflows/ci.yml
git commit -m "ci(cli): publish coverage summary"
```

---

### Task 7: Full Verification And Plan Reconciliation

Files:

- Modify: .plans/plan-implementation-truth.md
- Modify: .plans/codebase-architecture-sweep.md

- [ ] Step 1: Run deterministic gates

```sh
bun run --cwd apps/cli test:unit
bun run --cwd apps/cli test:integration
bun run fmt:check
bun run typecheck
bun run lint
bun run build
```

Expected: every command exits zero. If a host-disk-sensitive download test fails,
fix its fixture explicitly; do not weaken the production safety reserve.

- [ ] Step 2: Reconcile plan truth

Update only completed status and evidence rows for browse async repair, root
workflow safety, sync extraction, playback characterization, and coverage
visibility. Record that playback characterization landed and the deliberate
stopping point remains; do not claim a full PlaybackPhase split.

- [ ] Step 3: Commit

```sh
git add .plans/plan-implementation-truth.md .plans/codebase-architecture-sweep.md
git commit -m "docs: reconcile cli quality repair status"
```

## Execution Order

Task 1 is complete in 207abb13. Execute Tasks 2, 3, and 4 first because they
repair active user-facing failures. Task 5 must precede any future PlaybackPhase
refactor. Task 6 can run after Task 2. Task 7 is the final gate.

## Plan Self-Review

- Every confirmed review finding maps to a task.
- No task changes provider behavior or adds a dependency.
- Every production task begins with a focused failing test and ends with focused verification.
- The prior PlaybackPhase plan is respected: behavior characterization first, no mechanical extraction.
