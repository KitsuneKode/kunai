# MPV Lifecycle and History Hardening Plan

Status: in-progress implementation
Owner: runtime / playback
Scope: persistent mpv lifecycle, IPC cleanup, autoplay chain health checks, timeline/history reliability, unattended pause buffering behavior

## Problem Statement

Recent player/runtime changes introduced reliability regressions in autoplay-chain playback:

1. Persistent player cycles could enter phantom "alive" states after quit/close races.
2. Playback result finalization could be skipped or delayed when mpv close events were not observed in time.
3. IPC session/socket cleanup was not guaranteed in all exit paths.
4. Autoplay reuse logic trusted `isAlive()` too narrowly, allowing reuse of unhealthy sessions.
5. History/timeline persistence appeared missing because upstream playback results were not always finalized with usable progress.
6. Long unattended pause + buffering transitions could stall indefinitely without strong escalation.

## Goals

- Guarantee deterministic player session teardown and playback-result finalization.
- Ensure IPC session references are always closed and nulled on exit.
- Prevent autoplay from reusing unhealthy persistent sessions.
- Improve end-reason classification for clean user exits.
- Improve buffering stall detection after pause/unattended scenarios.

## Changes Implemented

### 1) `apps/cli/src/infra/player/PersistentMpvSession.ts`

- Added robust session health API: `isReusable()`.
- Hardened `close()`:
  - sets lifecycle state to closing (`alive = false`),
  - sends `quit` via IPC when available,
  - waits for process close with bounded timeout,
  - force-signals process when needed,
  - always routes through an idempotent termination finalizer.
- Added idempotent process termination coordination:
  - `terminationPromise` + `terminated` guards,
  - `handleProcessTermination(...)` centralizes finalization,
  - prevents double resolve/double cleanup races between close/error/manual-close paths.
- Added `waitForProcessClose(...)` and `closeIpcSession()` helpers.
- Ensured teardown always:
  - stops watchdog,
  - clears pending ready work,
  - closes + nulls IPC session,
  - cleans IPC socket,
  - nulls mpv ref,
  - resolves active cycle with `recordPlayerExit + finalizePlaybackResult`,
  - emits `player-closed`,
  - clears active control.
- IPC bootstrap fail-fast:
  - if IPC socket is not ready or session open throws,
  - emit `ipc-command-failed` with `ipc-bootstrap`,
  - terminate mpv,
  - finalize/teardown via common termination path,
  - skip queueing ready work.

### 2) `apps/cli/src/infra/player/PlayerServiceImpl.ts`

- Autoplay chain health checks now use `isReusable()` instead of only `isAlive()`.
- If persistent session is unhealthy, service uses `releasePersistentSession()` before reuse.
- Post-play and initial wait paths also validate reusable health and release if needed.

### 3) `apps/cli/src/infra/player/mpv-ipc.ts`

- Added unexpected socket close/error handling:
  - marks session closed,
  - drains pending commands immediately with `session closed`,
  - prevents further processing/writes.
- Made session `close()` idempotent via `closePromise`.
- Removed non-null assertions in dispatch paths to satisfy stricter linting and reduce unsafe assumptions.

### 4) `apps/cli/src/infra/player/mpv-telemetry.ts`

- Improved exit classification in `recordPlayerExit(...)`:
  - when endReason is still unknown and exit is clean (`code === 0`, no signal), classify as `quit`.
- This aligns autoplay interruption logic with real user quit behavior.

### 5) `apps/cli/src/infra/player/playback-watchdog.ts`

- Added `cacheStallAfterMs` threshold (default 20s).
- Improved pause handling:
  - reset stall timers on user pause/idle and on pause->resume transitions,
  - avoids false positive "stalled forever" carry-over after long pause.
- Improved paused-for-cache behavior:
  - no longer suppressed indefinitely,
  - tracks cache-ahead/speed progress,
  - emits `stream-stalled` when cache starvation persists.

## Tests Added/Updated

- Added: `apps/cli/test/unit/infra/player/playback-watchdog.test.ts`
  - verifies no false stall after long user pause + resume,
  - verifies stalled emission under prolonged cache starvation.
- Updated: `apps/cli/test/unit/infra/player/mpv-telemetry.test.ts`
  - clean instant exit expectation changed from `unknown` to `quit`.

## Validation Checklist

- [x] Targeted diagnostics clean for edited player files.
- [x] Targeted diagnostics clean for added/updated tests.
- [ ] Run full `bun run typecheck`.
- [ ] Run full `bun run lint`.
- [ ] Run `bun run test -- test/unit/infra/player` (or equivalent scoped test run).

## Follow-up Tasks

1. Add focused unit tests for `PersistentMpvSession` close-timeout/finalizer paths (requires seam/mocks).
2. Add diagnostics event fields for finalization path identity (close-event vs close-timeout vs bootstrap-fail).
3. Consider optional auto-refresh strategy when watchdog emits prolonged cache starvation during autoplay.
4. Capture operational counters for IPC unexpected-close frequency.

## Playback abort hardening (completed)

- `mpv-process-registry.ts` + `process.on("exit")` SIGKILL backstop alongside download children.
- Cooperative abort in `PlaybackPhase` / `PlayerServiceImpl.beginShutdown()` / `SessionController.shutdown()` order.
- `forceSettleAllRootContent` unblocks `openPlaybackShell` during Ink teardown.
- Voluntary mpv quit routes through post-play; prefetch `suspend` retains in-flight resolve work.
