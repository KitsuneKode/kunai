# Plan 001: Make crash handlers non-re-entrant and share the guarded shutdown path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/main.ts`
> If `main.ts` changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

The `uncaughtException` and `unhandledRejection` handlers in `apps/cli/src/main.ts` each launch a full async teardown (pause downloads → controller shutdown → shell shutdown → dispose container) with **no re-entrancy guard and no force-exit timeout**. The signal handler right above them has both. In an error storm (e.g. a provider retry loop throwing repeatedly), every rejection starts a _new_ overlapping teardown, running concurrently with the others and with any in-flight Ctrl+C shutdown — double `disposeContainer`, double DB close, and, because Bun does not auto-exit while an `uncaughtException` handler is installed, the process keeps running and stacking teardowns. This is the most plausible amplifier of a historical incident where anime mode grew to ~17GB RSS and orphaned itself.

## Current state

- `apps/cli/src/main.ts` — process entry; `setupSignalHandlers()` installs all handlers. A module-level `shutdownInProgress` boolean already exists and is used by the signal path.

The signal path (correct, the pattern to copy) at `main.ts:838-861`:

```ts
const shutdown = async (signal: string) => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  console.log(`\nReceived ${signal}, shutting down cleanly...`);
  // Force exit after 4 s so stuck cleanup never stalls Ctrl+C.
  const forceExit = setTimeout(() => {
    process.exit(0);
  }, 4000);
  if (forceExit.unref) forceExit.unref();
  try {
    await globalContainer?.downloadService.pauseActiveJobsForShutdown(
      `download paused by ${signal}`,
    );
    if (globalController) {
      await globalController.shutdown();
    }
    await shutdownShell();
    await disposeContainer(globalContainer);
  } finally {
    clearTimeout(forceExit);
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(0);
  }
};
```

The broken handlers at `main.ts:879-903` (both identical in shape):

```ts
process.on("uncaughtException", (e) => {
  console.error("Uncaught exception:", e);
  void (async () => {
    await globalContainer?.downloadService.pauseActiveJobsForShutdown("uncaught exception");
    await globalController?.shutdown().catch(() => {});
    await shutdownShell();
    await disposeContainer(globalContainer);
  })().finally(() => {
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(1);
  });
});

process.on("unhandledRejection", (e) => {
  // ...same body, reason "unhandled rejection"
});
```

Problems: (a) no `shutdownInProgress` check/set → re-entrant; (b) no 4s force-exit timer → a hung `pauseActiveJobsForShutdown` or `disposeContainer` leaves the process alive forever; (c) if teardown itself throws before `.finally`, behavior differs from the signal path.

Repo conventions: TypeScript, Bun runtime, conventional-commit messages (`fix(cli): ...` — see `git log`, e.g. `fix(cli): harden browse async interactions`).

## Commands you will need

| Purpose   | Command                                   | Expected on success |
| --------- | ----------------------------------------- | ------------------- |
| Typecheck | `bun run typecheck`                       | exit 0              |
| Lint      | `bun run lint`                            | exit 0              |
| Format    | `bun run fmt`                             | exit 0              |
| CLI tests | `bun run --cwd apps/cli test`             | all pass            |
| One file  | `cd apps/cli && bun run test:file <path>` | listed tests pass   |

## Scope

**In scope** (the only files you should modify):

- `apps/cli/src/main.ts`
- `apps/cli/test/unit/app/crash-handler-shutdown.test.ts` (create)

**Out of scope** (do NOT touch):

- The `process.on("exit", ...)` sync SIGKILL backstop at `main.ts:870-877` — it is a deliberate last-resort child-killer and must stay as-is.
- `DownloadService`, `disposeContainer`, `shutdownShell` internals.
- Signal handler behavior (exit code 0 on signals must not change).

## Git workflow

- Branch: `advisor/001-guard-crash-handlers`
- Commit message: `fix(cli): guard crash handlers against re-entrant shutdown`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a single guarded teardown helper

In `apps/cli/src/main.ts`, refactor so both the signal path and the crash handlers call one function. Target shape (adapt names to file conventions):

```ts
async function runGuardedShutdown(opts: {
  reason: string; // "SIGINT" | "uncaught exception" | "unhandled rejection"
  exitCode: number; // 0 for signals, 1 for crashes
}): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  const forceExit = setTimeout(() => process.exit(opts.exitCode), 4000);
  if (forceExit.unref) forceExit.unref();
  try {
    await globalContainer?.downloadService.pauseActiveJobsForShutdown(
      `download paused by ${opts.reason}`,
    );
    await globalController?.shutdown().catch(() => {});
    await shutdownShell();
    await disposeContainer(globalContainer);
  } finally {
    clearTimeout(forceExit);
    if (process.stdin.isTTY) process.stdin.unref();
    process.exit(opts.exitCode);
  }
}
```

Rewire: signal `shutdown(signal)` → logs its message then `runGuardedShutdown({ reason: signal, exitCode: 0 })`; `uncaughtException` → `console.error("Uncaught exception:", e)` then `void runGuardedShutdown({ reason: "uncaught exception", exitCode: 1 })`; `unhandledRejection` likewise. Preserve the existing signal-path `console.log` line verbatim.

Export the helper (or a small pure predicate around the guard) so it is unit-testable — the file already exports `startCli`; a named export like `__testing = { runGuardedShutdown }` or exporting the function directly both match repo tolerance (see exported helpers such as `shouldAbortLaunchForDefinitivePreflight` in `apps/cli/src/mpv.ts:401`).

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Write the regression test

Create `apps/cli/test/unit/app/crash-handler-shutdown.test.ts` covering:

1. Calling the guarded shutdown twice runs the teardown body once (stub `pauseActiveJobsForShutdown` etc. via injected fakes or module-level test seams; count invocations).
2. Second concurrent call returns immediately while the first is mid-await.

You will need to make `process.exit` injectable for the test (accept an optional `exit` function parameter defaulting to `process.exit` — smallest seam that keeps the runtime path identical). Model test structure after `apps/cli/test/unit/app/mpv-session-lifecycle.test.ts` (bun:test, describe/test).

**Verify**: `cd apps/cli && bun run test:file test/unit/app/crash-handler-shutdown.test.ts` → all pass.

### Step 3: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `bun run typecheck` exits 0; `bun run lint` exits 0
- [ ] `apps/cli/test/unit/app/crash-handler-shutdown.test.ts` exists and passes
- [ ] Both crash handlers and the signal path route through one guarded function; `grep -n "shutdownInProgress" apps/cli/src/main.ts` shows the guard checked before any teardown in all three paths
- [ ] Crash paths still exit 1, signal paths still exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `main.ts:838-903` no longer matches the excerpts (drifted).
- `shutdownInProgress` has been removed or renamed and you cannot find an equivalent guard variable.
- Making `process.exit` testable requires restructuring `startCli` itself.

## Maintenance notes

- Any future teardown step (new service dispose) must go inside `runGuardedShutdown`, not into a new ad-hoc handler.
- Reviewer should scrutinize: exit codes preserved per path; the `exit` event backstop untouched; no `await` added before the guard check.
- Deferred: rate-limiting repeated `unhandledRejection` _logging_ (only the teardown is guarded); fine because the first rejection now always leads to exit.
