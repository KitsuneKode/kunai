# Audit: mpv process + IPC lifecycle

Scope: `PersistentMpvSession.ts`, `mpv-telemetry.ts`, `mpv-ipc.ts`, `mpv-ipc-endpoint.ts`,
`mpv-in-process-reconnect.ts`, `PlayerControlServiceImpl.ts`, `mpv.ts` (`launchMpv`),
`playback-watchdog.ts`, plus the teardown path in `main.ts` / `PlayerServiceImpl.ts`.
READ-ONLY audit — no code changed. Date: 2026-05-28.

---

## 1. In-process reconnect + stall recovery

Core logic: `PersistentMpvSession.runSameUrlReconnect` (PersistentMpvSession.ts:1316-1400),
`finishInProcessReconnectAfterLoad` (1402-1448), triggered from `handlePlaybackEnded`
(1237-1284) and `handleNetworkReadDeadReconnect` (1286-1310). Seek policy in
`mpv-in-process-reconnect.ts:5-15`. Premature-EOF demotion in `mpv-telemetry.ts:190-225`.

What is correct:

- Attempt cap is honored in two places (PersistentMpvSession.ts:1269 and 1330) and clamped to
  0..12 at construction (315-322). `network-read-dead` and EOF/error all funnel through the
  same `runSameUrlReconnect`, so the cap is shared.
- `reconnectInFlight` (1329) serializes overlapping reconnects; reset is established before
  each attempt counts. Backoff is exponential with a cap (1336-1339, 1386-1391).
- Telemetry is preserved across the reload so a successful reconnect does not lose
  `maxTrustedProgressSeconds` / `lastReliableProgressSeconds` (1360-1366).

Bugs / risks:

1.1 **`reconnectInFlight` is not cleared on the success path of `runSameUrlReconnect`.**
The success branch (1379-1381) returns `true` without clearing `reconnectInFlight`. It is only
cleared later in `finishInProcessReconnectAfterLoad`'s `finally` (1444), which runs on the
`file-loaded` IPC callback (598-603). **If mpv never emits `file-loaded`** after the loadfile
ACK (dead CDN that accepts the URL but never demuxes; loadfile succeeds but the load aborts via
`end-file error` instead of `file-loaded`), `reconnectInFlight` stays `true` forever and **all
future reconnects for the cycle are silently blocked** (1329). The `end-file` path
(`handlePlaybackEnded`) does not reset `reconnectInFlight`. This is the highest-value defect.

1.2 **Mid-seek stream death races the reconnect.** During `finishInProcessReconnectAfterLoad`
the code issues `seek` (1410) then `pause=false` (1418) then re-attaches subtitles (1420). If
the stream dies again between the loadfile ACK and these commands, a second `end-file` arrives
while `reconnectInFlight` is still true → `handlePlaybackEnded`'s `shouldTryReconnect` calls
`runSameUrlReconnect` which returns `false` at the `reconnectInFlight` guard, then falls through
to `active.resolve(result)` (1282-1283) — ending the cycle even though attempts remain. So a
fast re-death during the seek window terminates playback prematurely instead of retrying.

1.3 **`pendingInProcessReconnect` can be stranded.** `runSameUrlReconnect` sets
`pendingInProcessReconnect` (1367) before the loadfile send. On the `catch` path it is cleared
(1384), but if the process terminates between set and the `file-loaded` callback,
`handleProcessTermination` never consults it — harmless for correctness but the
`onFileLoaded` reconnect branch (598-603) could fire against a stale spec if a delayed
`file-loaded` from the _previous_ file arrives after a new loadfile. Low risk given mpv ordering,
but there is no generation/epoch guard tying a `file-loaded` to a specific loadfile.

1.4 **`network-read-dead` reconnect competes with the watchdog cadence, not a per-incident
guard inside the session.** The watchdog only emits `network-read-dead` once per stall incident
(playback-watchdog.ts:103-110), which is the de-dupe. But `runSameUrlReconnect` for that trigger
applies the `reconnectBackoffUntilMs` gate (1333) the same as EOF; on the _first_ attempt
`backoffBefore` is 0 (1336-1339) so there is no settle delay before the very first reconnect of
a dead read — acceptable, but worth noting it reloads immediately on the first dead-read.

1.5 **Premature-EOF heuristic is duration-threshold heavy** (`mpv-telemetry.ts:198, 208-219`).
Short clips (<180s) never demote, so a genuinely truncated short stream that emits clean `eof`
will be trusted and `handlePlaybackEnded` will not reconnect (1272 requires `demoted` or
`error+networkish`). For short anime OPs/specials this means no in-process recovery. Likely
intentional (avoids loops on short files) but is an edge case where recovery is unavailable.

1.6 **No global attempt budget across incidents.** The cap resets only per cycle
(`resetCycleState` 741, new `play()`); within one cycle, alternating `network-read-dead` and
`premature-eof` triggers all draw from the same counter, which is correct. But there is no
time-window reset, so a long movie that recovers cleanly at minute 10 still has a depleted
budget at minute 90 — a single late stall ends the session. Consider a sliding-window reset.

---

## 2. IPC transport (Unix socket + Windows pipe parity)

Endpoint construction: `mpv-ipc-endpoint.ts:34-45`. Connection / probe: `mpv-ipc.ts:100-129`
and `openMpvIpcSession` 142-299. Cleanup gated by `shouldUnlinkUnixSocket` (endpoint.ts:51-53).

What is correct:

- Path is randomized per session (`newMpvIpcSessionId` endpoint.ts:24-26: pid + time + 4 random
  bytes), so two concurrent sessions cannot collide.
- Both spawn paths pre-unlink a stale Unix socket before launch (PersistentMpvSession.ts:486-488,
  mpv.ts:59-61) and only when `shouldUnlinkUnixSocket` is true, so Windows pipes are not touched.
- Windows uses `//./pipe/...` (endpoint.ts:36-39) which Bun accepts via `Bun.connect({ unix })`
  (referenced Bun #14329), and cleanup correctly skips pipes (named pipes are kernel objects, not
  files) — `cleanupSocket` 1222-1226 and `cleanupUnixSocketFile` mpv.ts:526-534.

Bugs / risks:

2.1 **Socket-file leak on hard exit.** Cleanup (`cleanupSocket`) runs only inside
`handleProcessTermination` (1194) and `launchMpv`'s normal return (mpv.ts:342). On SIGKILL of
the Bun process, `process.exit` in the signal handler (main.ts:736), the 4s force-exit timer
(722), or `uncaughtException`/`unhandledRejection` (744-768), the session's `close()` may not run
to completion → the `.sock` file under TMPDIR is **orphaned**. There is no startup sweep of stale
`kunai-mpv-*.sock` files. Over time `/tmp` accumulates dead sockets. (mpv would also still hold
the path; the next run uses a new random path so it is not a correctness break, just litter.)

2.2 **Windows pipe-name collision window is wider than Unix.** `ipcPipeSuffix`
(endpoint.ts:8-11) strips non-alphanumerics and truncates to 48 chars. The session id is
`pid-base36time-hex8`; after stripping the dashes the entropy survives, but the 48-char cap
could in theory truncate the trailing random hex if pid+time is long. In practice pid+time is
well under 48 chars, so this is theoretical — but the truncation order (suffix computed from the
already-safe id, then sliced) means the random bytes are at the _end_ and are the first to be
cut. Prefer putting entropy first.

2.3 **`waitForMpvIpcEndpoint` leaks the probe socket reference but not the connection.** The
probe opens a connection and immediately `sock.end()`s in `open` (mpv-ipc.ts:113-115), returning
`true`. That is fine, but `void s` (120) discards the handle; if `open` fires after the function
already returned on a _previous_ iteration there is no harm. No real leak. Minor.

2.4 **Windows would break at process teardown, not at connect.** Connect/probe/JSON framing are
transport-agnostic and should work. The real Windows gaps:

- `proc.kill("SIGTERM")` (PersistentMpvSession.ts:459, 582, 631; mpv.ts:170, 224) — on Windows
  Bun maps `kill()` to `TerminateProcess`; `SIGTERM` semantics (graceful) do not exist, so the
  `quit` IPC must succeed or mpv is hard-killed. The code does try `quit` first (457), so this
  degrades acceptably, but the SIGTERM→SIGKILL escalation in `close()` (459-472) is really
  terminate→terminate on Windows (no soft stop).
- The diagnostics hint already calls out the WSL↔host split (endpoint.ts:61-64), which is the
  most common Windows failure: Bun on Windows + mpv in WSL (or vice-versa) cannot share a
  `//./pipe/` name. Good that it is documented; there is no programmatic detection.
- `env: process.env` passthrough on spawn (PersistentMpvSession.ts:555, mpv.ts:83) is fine on
  both.

2.5 **No `readyState` re-check between probe and `openMpvIpcSession`.** After
`waitForIpcEndpoint` returns true, a second connect is made in `openMpvIpcSession` (164).
Between probe success and the real connect, mpv could die; the open then throws and is caught
(623-634) → clean failure path. OK.

---

## 3. Process teardown / orphaned mpv / terminal state

Teardown: `PersistentMpvSession.close()` (446-483), `handleProcessTermination` (1173-1220),
`waitForProcessClose` (1159-1165). App-level: `main.ts:715-768`, `graceful-exit.ts`.

What is correct:

- `close()` does the right escalation: `quit` IPC → SIGTERM → wait → SIGTERM → wait → SIGKILL →
  wait (457-473), each bounded by `waitForProcessClose` timeouts. This avoids hanging on a stuck
  mpv.
- `handleProcessTermination` is idempotent via `terminationPromise`/`terminated` guards
  (1177-1182) and resolves the active cycle exactly once.
- `--keep-open=no` + `--idle=yes` (mpv.ts:417-418) is a deliberate, well-documented choice to
  guarantee `end-file` fires (comment 412-416).

Bugs / risks:

3.1 **Orphaned mpv on Bun crash / SIGKILL.** mpv is spawned **non-detached** with stdio ignored
(PersistentMpvSession.ts:551-556). On a normal SIGINT the handler calls
`globalController.shutdown()` → `releasePersistentSession()` → `session.close()`
(PlayerServiceImpl.ts:149-153), which kills mpv. **But:**

- The 4s force-exit timer (main.ts:720-722) can `process.exit(0)` _before_ `close()` finishes
  the SIGKILL escalation (which itself budgets up to 1.5+1.5+1.0 = 4s in `close()`), so on a
  slow/stuck mpv the parent can exit while mpv is still alive → orphaned mpv window. The two
  4-second budgets are not coordinated.
- `uncaughtException` / `unhandledRejection` (744-768) call `shutdown()` but race the same way.
- There is **no `registerExitHandler`** wiring for the persistent session and **no PID
  tracking** for a last-resort kill. Recommend registering the session kill as a synchronous
  best-effort exit handler and/or spawning mpv in its own process group so a parent SIGKILL can
  take mpv with it (Unix: `detached` + `kill(-pid)`; or rely on terminal close).

3.2 **Terminal state.** mpv runs with its own window (`--force-window=immediate`), stdio
`ignore` (not `inherit`) for the persistent path, so mpv does not write to the Bun TTY and there
is no raw-mode handoff to restore — good. The one-shot `launchMpv` uses `attach` → `inherit`
(mpv.ts:78), where mpv _does_ take the terminal; on a crash before `player-closed`, the terminal
could be left in mpv's tty state. The Ink shell separately restores its own raw mode via the
SIGINT self-emit (ink-shell.tsx:468-474). Persistent path is safe; attached one-shot is the
exposure.

3.3 **`quit` vs `stop` ordering.** `currentControl.stop` sends `quit` (234-238) and `stopCurrentFile`
sends `stop` (240-247); both fall back to SIGTERM. `close()` also sends a final
`user-data/kunai-loading` clear (456) before `quit`. Ordering is sound. One gap:
`abortResumeChoiceWaitForCycleEnd()` (455) resolves a dangling resume wait, but if `close()` is
called while a reconnect is `reconnectInFlight`, the pending reconnect promise chain is not
explicitly cancelled — `handleProcessTermination` nulls `activeCycle` so the later
`finishInProcessReconnectAfterLoad` becomes a no-op on `this.ipcSession` (now null). Safe by
nulling, but relies on order.

3.4 **`handleProcessTermination` resets `terminationPromise` to null in `finally` (1217-1218)
after setting `terminated = true`.** A second call after completion hits the
`if (this.terminated) return;` guard (1181) — correct. But the early `if (this.terminationPromise)`
await (1177) followed by the `finally` null-ing means a concurrent caller awaits a promise that
may already be nulled by the first caller's finally; the `terminated` flag covers this. OK but
subtle.

---

## 4. Decomposition of the ~1450-line god-class

`PersistentMpvSession` currently owns: spawn/argv, IPC bootstrap, the control facade,
ready-work, resume-choice, skip-segment scheduling, reconnect state machine, telemetry wiring,
and teardown. Much is already delegated (property router, ready-work executor, subtitle manager,
watchdog, telemetry, skip helpers). The remaining bulk is the orchestration glue. Suggested
boundaries (all in `apps/cli/src/infra/player/`):

- **`MpvProcessLifecycle`** — owns spawn (485-562), the `exited` wiring (564-570), and the full
  teardown escalation (`close` 446-483, `waitForProcessClose`, `handleProcessTermination`,
  `cleanupSocket`, `cleanupLuaScript`). Single owner of `this.mpv`, `alive`, `terminated`,
  `terminationPromise`. This is the most self-contained extraction and would isolate the
  orphan/teardown fixes from §3.

- **`MpvIpcBootstrap`** — the IPC endpoint wait + `openMpvIpcSession` setup including the
  `observe_property` registration (572-652). Returns a connected `MpvIpcSession` plus the
  property/end-file/file-loaded callback fan-out. Removes ~80 lines.

- **`InProcessReconnectController`** — owns `reconnectTryCount`, `reconnectBackoffUntilMs`,
  `reconnectInFlight`, `pendingInProcessReconnect`, and the three methods
  `runSameUrlReconnect` / `handleNetworkReadDeadReconnect` / `finishInProcessReconnectAfterLoad`
  (1286-1448) plus `handlePlaybackEnded`'s reconnect decision. This is a clean state machine and
  extracting it makes defects 1.1–1.3 testable in isolation. It needs an injected
  `loadfile`/`seek`/`subtitle re-attach` interface and a telemetry handle.

- **`ResumeChoiceCoordinator`** — `waitResumeOrStartOverChoice`, `finishResumeChoiceWait`,
  `abortResumeChoiceWaitForCycleEnd`, `handleResumeSeekFromMpv` (687-738, 1051-1060). Small,
  cohesive, timeout-driven.

- **`SkipPromptScheduler`** — all `skip*` state and methods (941-1149): `skipPromptSegmentKey`,
  `skipAutoTimer`, `skipUserDataRev`, `publishSkipPrompt*`, `fireScheduledAutoSkip`,
  `handleSegmentSkipProgress`, `maybeAutoSkipLegacy`, `maybeRearmSkippedSegmentsOnBackwardSeek`.
  This is the second-largest cluster and already nearly standalone (depends only on ipcSession +
  position + timing + config).

- **`PlaybackCycle`** — `beginCycle`, `resetCycleState`, progress emission, near-EOF firing,
  ready-work queue/fallback (660-829, 893-929). Owns `activeCycle` and the cycle promise.

Residual `PersistentMpvSession` becomes a thin coordinator wiring these together and exposing
the `ActivePlayerControl` facade (which itself — lines 231-296 — could move to a
`buildPersistentControl(deps)` factory).

---

## Prioritized recommendations

P0 (correctness / loss of recovery):

1. **Fix 1.1** — clear `reconnectInFlight` on the loadfile-success path of `runSameUrlReconnect`
   (or guarantee it is cleared by `handlePlaybackEnded` when a reconnect attempt fails to reach
   `file-loaded`). Add a timeout that re-arms reconnect if `file-loaded` never arrives.
2. **Fix 1.2** — let a re-death during the seek window re-enter reconnect instead of resolving
   the cycle; gate `handlePlaybackEnded`'s terminal resolve on `!reconnectInFlight`.

P1 (orphaned processes / leaks): 3. **Fix 3.1** — register a synchronous best-effort `kill` exit handler for the persistent
session and/or coordinate the two 4s force-exit budgets so the parent never exits before mpv
teardown completes. Consider a process-group spawn for guaranteed reaping. 4. **Fix 2.1** — sweep stale `kunai-mpv-*.sock` files in TMPDIR on startup (age-based), since
crash paths orphan them.

P2 (robustness / cross-platform): 5. **Add a loadfile→file-loaded epoch guard** (1.3) so a stale `file-loaded` cannot drive a new
reconnect spec. 6. **Reorder pipe-name entropy** (2.2) to put random bytes first before the 48-char truncation. 7. **Consider a sliding-window reconnect budget** (1.6) for long movies.

P3 (maintainability): 8. Execute the decomposition in §4, starting with `MpvProcessLifecycle` and
`InProcessReconnectController` (they carry the P0/P1 fixes and are the most testable seams).
