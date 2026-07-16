# Plan 004: Close the mpv IPC-session leak on preflight abort and make `--debug` produce a real log file

> **Executor instructions**: Follow step by step; verify each step; honor STOP
> conditions; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/mpv.ts apps/cli/src/infra/logger/StructuredLogger.ts apps/cli/src/cli-args.ts apps/cli/src/container/bootstrap-persistence.ts`
> Mismatch vs excerpts → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (IPC timing) / LOW (log text)
- **Depends on**: none
- **Category**: bug / dx
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Two defects that erode trust in playback and debugging:

1. **Leaked IPC session/socket on preflight abort.** When a stream is definitively dead, `launchMpv` closes `ipcSession` and returns early — but `ipcSession` is assigned inside a fire-and-forget IIFE that the early-return path never awaits. If mpv's IPC session opens _after_ teardown began, it is never closed and its unix socket never unlinked. Over a session of dead-stream fallbacks this orphans sockets.
2. **`--debug` advertises `./logs.txt` that is never written.** The help text promises it; the logger's file sink is a `// File logging would go here` stub, and stderr is suppressed while the Ink TUI is mounted — so users trying to capture a bug report get nothing. Either implement a redacted file sink or correct the promise to point at the trace file that already exists.

## Current state

### Defect 1 — `apps/cli/src/mpv.ts`

IPC is opened inside a fire-and-forget IIFE (~`mpv.ts:280-351`); `ipcSession` (module/function-scoped `let`) is assigned at `:287`:

```ts
ipcSession = await openMpvIpcSession({ endpoint: ipcEndpoint /* … */ });
```

The IIFE is stored as `ipcBootstrap` and `.catch`-ed. The early-return abort path at `mpv.ts:359-382`:

```ts
const preflightResult = await preflight;
if (shouldAbortLaunchForDefinitivePreflight(preflightResult, ipcSession !== null)) {
  watchdog.stop();
  await closeIpcSession(ipcSession); // ipcSession may still be null here…
  const socketPathCleanedUp = shouldUnlinkUnixSocket(ipcEndpoint)
    ? await cleanupUnixSocketFile(ipcEndpoint.path)
    : true;
  opts.onControlReady?.(null);
  return {
    /* … */
  };
}
await ipcBootstrap; // …the normal path awaits it; the abort path does not
```

If `ipcBootstrap` is still mid-`openMpvIpcSession` at abort time, `ipcSession` is `null` at `closeIpcSession`, then the bootstrap finishes and assigns a live session nobody closes.

### Defect 2 — logging

- `apps/cli/src/cli-args.ts:81`: `--debug   Verbose logging to ./logs.txt`
- `apps/cli/src/infra/logger/StructuredLogger.ts:76-83`: writes to stderr only; `// File logging would go here` stub at `:82`.
- A **working** redacted file sink already exists for traces: `apps/cli/src/services/diagnostics/DebugTraceReporter.ts` (`appendFileSync` at `:38`, redacts via `redactDiagnosticValue` at `:35`). `bootstrap-persistence.ts:225-233` builds `debugTracePath = <dataDir>/traces/kunai-trace-<ts>.jsonl` when `--debug-json`/`--debug-session` is set. Plain `--debug` does NOT currently produce any file.

Repo conventions: redaction is mandatory for any persisted diagnostic (see `redactDiagnosticValue` usage); Node `fs` append for log files (CLAUDE.md); conventional commits.

## Commands you will need

| Purpose   | Command                                   | Expected |
| --------- | ----------------------------------------- | -------- |
| Typecheck | `bun run typecheck`                       | exit 0   |
| Lint      | `bun run lint`                            | exit 0   |
| One file  | `cd apps/cli && bun run test:file <path>` | pass     |
| CLI tests | `bun run --cwd apps/cli test`             | pass     |

## Scope

**In scope**:

- `apps/cli/src/mpv.ts` (Defect 1)
- `apps/cli/src/cli-args.ts` (Defect 2 — help text)
- Either `apps/cli/src/infra/logger/StructuredLogger.ts` + wiring (if implementing the sink) OR just the help text (if choosing the doc-correction path — see Step 3 decision)
- `apps/cli/test/unit/infra/player/mpv-ipc-abort-cleanup.test.ts` (create)

**Out of scope**:

- `DebugTraceReporter` internals (reuse, don't modify).
- The preflight/watchdog logic itself — only the await ordering on the abort path.

## Git workflow

- Branch: `advisor/004-ipc-orphan-and-debug-log`
- Commits: `fix(mpv): await ipc bootstrap before closing on preflight abort` and `fix(cli): make --debug produce a redacted log file` (or `docs(cli): correct --debug log destination`)

## Steps

### Step 1: Fix the IPC abort ordering

On the abort path, await the bootstrap (bounded) before closing, so a late-opened session is captured and closed. Target:

```ts
if (shouldAbortLaunchForDefinitivePreflight(preflightResult, ipcSession !== null)) {
  watchdog.stop();
  await Promise.race([ipcBootstrap, Bun.sleep(2_000)]); // let a late session finish opening
  await closeIpcSession(ipcSession);
  // …unchanged…
}
```

Alternatively, have the IIFE check a `torndown` flag and self-close if it opens after teardown started. Pick whichever is smaller given the current code; if `ipcBootstrap` can hang indefinitely, the `Promise.race` bound is required. Confirm `closeIpcSession(null)` is a safe no-op (`grep -n "function closeIpcSession\|const closeIpcSession" apps/cli/src`); if not, guard it.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Test the abort cleanup

Create `apps/cli/test/unit/infra/player/mpv-ipc-abort-cleanup.test.ts` that simulates a preflight abort where the IPC session resolves _after_ the abort decision, and asserts the session is closed and the socket cleanup is attempted. Use the existing player test fakes (`ls apps/cli/test/unit/infra/player/` — model after `mpv-in-process-reconnect.test.ts` or `persistent-mpv-session.test.ts`). If the current `launchMpv` seams don't allow injecting a delayed IPC open, assert at the smallest testable unit you can and note the limitation in a comment.

**Verify**: `cd apps/cli && bun run test:file test/unit/infra/player/mpv-ipc-abort-cleanup.test.ts` → pass.

### Step 3: Decide and implement the `--debug` fix

**Decision rule**: If a `logs.txt`-style human-readable redacted file is genuinely wanted, implement the sink (3a). If the existing JSONL trace is the real artifact, correct the help text to point at it (3b). Default to **3b** (lower risk, no new I/O path) unless the repo shows an expectation of `logs.txt` specifically (check `grep -rn "logs.txt" apps/cli/src README.md` — the `.gitignore` already ignores `logs.*`).

**3a (implement sink)**: give `StructuredLogger` an optional `filePath`; when set, `appendFileSync` each entry after running it through `redactDiagnosticValue` (import the same redactor `DebugTraceReporter` uses). Wire `--debug` in `bootstrap-persistence.ts` to pass `<dataDir>/logs.txt` (or cwd `./logs.txt` to match the help). Ensure the dir exists (`mkdirSync … { recursive: true }`).

**3b (correct the text)**: change `cli-args.ts:81` to describe the actual behavior, e.g. `--debug   Verbose diagnostics (use --debug-session to write a redacted trace file)`, and ensure `--debug-session`/`--debug-json` help already names the trace path or add a line that they write to `<dataDir>/traces/`.

**Verify**: `bun run typecheck` → exit 0; if 3a, add a small test that a redacted line is written and secrets are stripped.

### Step 4: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0
- [ ] Abort path awaits bootstrap before close; new IPC-abort test passes
- [ ] `grep -n "File logging would go here" apps/cli/src/infra/logger/StructuredLogger.ts` returns nothing (if 3a) OR help text no longer claims an unwritten `./logs.txt` (if 3b)
- [ ] If 3a: written log lines are redacted (test proves a token is stripped)
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- The IPC IIFE / abort path no longer matches the excerpt (drifted).
- `launchMpv` cannot be exercised at any granularity by a test with the existing fakes — implement the fix anyway but report the coverage gap.
- Implementing 3a would route un-redacted content to disk and you cannot confirm the redactor covers it — fall back to 3b.

## Maintenance notes

- Any future early-return added to `launchMpv` must also await/close the IPC bootstrap — this is a recurring hazard of the fire-and-forget IIFE pattern; consider a `finally` that always reconciles the session.
- File-overlap note: plan 002 also edits `apps/cli/src/mpv.ts` (arg builder/subtitle attach — a different region). Land 002 and 004 sequentially. If Step 3 option 3a is chosen, this plan also touches `bootstrap-persistence.ts`, which plan 006 edits — another reason 3b is the default.
- Reviewer: confirm redaction runs on every persisted log line if 3a is chosen; a debug log is the classic place tokens leak.
