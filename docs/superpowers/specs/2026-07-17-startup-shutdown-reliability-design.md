# Startup and Shutdown Reliability Design

**Date:** 2026-07-17
**Status:** Approved

## Purpose

Complete the startup optimization already defined in `.plans/HANDOFF-2026-07-17.md`, then make handled shutdowns fast, consistent, and safe against avoidable loss of playback, configuration, download, queue, and diagnostic state.

Notifications Inbox v2 is explicitly outside this design. Another agent owns that implementation. This work must not modify or absorb Notifications Inbox source or test changes.

## Goals

- Keep Search as the first useful startup surface.
- Preserve the canonical demand-loaded root-overlay boundary.
- Verify startup behavior and cold timings against an empty shadow profile.
- Route every live-application exit intent through one shutdown coordinator.
- Restore the terminal immediately when shutdown begins.
- Persist the latest playback state before stopping mpv.
- Flush pending configuration and durable operational state before closing storage.
- Prevent downloads and background workers from starting new work during shutdown.
- Bound best-effort integration cleanup so shutdown cannot hang indefinitely.
- Preserve unrelated package, dependency, and concurrent Notifications work.

## Non-goals

- Redesigning the Notifications Inbox.
- Reopening the broad queue, notifications, or playlists audit.
- Building a general-purpose lifecycle framework for every future service.
- Guaranteeing persistence after `SIGKILL`, power loss, kernel failure, or storage-device failure.
- Leaving mpv running after Kunai exits.
- Refactoring unrelated startup, provider, playback, or persistence architecture.

## Existing startup design

The startup design is already settled and is not reopened by this specification:

- The root development command directly launches `apps/cli/src/main.ts` without an intermediate nested Bun script process.
- `root-content-shell.tsx` remains the canonical root-overlay renderer.
- `root-content-shell.tsx` renders `RootOverlayLoader` rather than statically importing `RootOverlayShell`.
- `RootOverlayLoader` dynamically imports the overlay implementation, caches successful module evaluation, resets the in-flight promise after failure, and presents stable loading and failure states.
- Escape closes the overlay while the real overlay module is still loading.
- `ink-shell.tsx` must not regain a duplicate root-overlay renderer or a direct `root-overlay-shell` import.

Startup completion is verification-focused: protect the existing boundary, confirm real terminal behavior, record three controlled cold samples, run all gates, and perform one focused review.

## Problem statement

Kunai currently has overlapping shutdown mechanisms with different cleanup coverage:

- the main process has guarded signal and fatal-error shutdown;
- several shell surfaces can invoke a shell-local hard exit;
- normal session-loop completion has its own cleanup sequence;
- the versioned-binary lifetime lock installs competing signal handlers.

Some paths can call `process.exit()` before controller shutdown, terminal teardown, playback finalization, pending config writes, diagnostics flushing, database closure, and background-work settlement. Cleanup is also ordered serially such that a slow download pause can consume the global deadline before terminal restoration or critical persistence begins.

The result is avoidable exit latency, inconsistent behavior across surfaces, and a risk of losing the most recent playback interval or other pending state.

## Chosen approach

Use one application-owned shutdown coordinator with explicit phases. All live-application exit intents converge on the coordinator. Services retain ownership of their internal shutdown mechanics; the coordinator owns ordering, failure isolation, deadlines, and final process exit.

This is intentionally narrower than a generic lifecycle registry. It fixes the split-brain shutdown architecture without introducing a broad framework unrelated to the immediate reliability requirement.

## Architecture and ownership

### Shutdown coordinator

The coordinator belongs in the application/session lifecycle layer. It accepts:

- a shutdown reason;
- a requested exit code;
- whether the reason is normal, signal-driven, or fatal;
- access to the application resources needed by the shutdown phases.

The coordinator:

- starts cleanup only once;
- returns the same in-flight shutdown promise to concurrent callers;
- allows a later fatal request to upgrade the final exit code;
- runs cleanup phases in a fixed order;
- isolates each cleanup operation so one failure cannot skip later preservation work;
- applies one global deadline and smaller phase/resource deadlines;
- performs the final exit only after preservation and bounded cleanup attempts.

### Shell ownership

Shell components request shutdown; they do not call `process.exit()` directly. Nested surfaces and the root surface use the same request boundary.

The shell remains responsible for:

- stopping interactive input;
- unmounting Ink;
- restoring terminal modes;
- clearing Kitty or other image placements;
- making terminal restoration idempotent.

### Playback ownership

Playback owns producing and persisting its latest valid checkpoint. A handled shutdown while playback is active must save the most recent known position and engaged watch time before mpv is terminated.

After the checkpoint attempt, Kunai stops mpv within a bounded deadline. Leaving mpv detached is not supported by this design.

### Configuration ownership

The configuration service owns its debounce state and exposes a flush operation that:

- writes the latest pending snapshot immediately;
- waits for any in-flight write;
- is safe to call when no write is pending;
- reports failure to the coordinator without preventing other preservation work.

### Download ownership

The download service owns its worker and child processes. Shutdown must first prevent the worker from claiming new jobs, then persist active jobs in a paused or retryable state, and finally terminate associated child processes within a bounded deadline.

No handled shutdown may intentionally leave a terminated download durably marked as running.

### Background-work ownership

The scheduler stops accepting new work when shutdown begins. Already-running work is classified by existing ownership rather than given an unbounded generic drain:

- critical persistence work receives a short bounded drain;
- cancellable or low-value work is aborted;
- new work is rejected after quiescence.

Startup fire-and-forget work that can touch storage or spawn durable resources must either participate in this boundary or be proven safe to abandon before database closure.

### Container and storage ownership

Container disposal owns:

- final diagnostics flush;
- data and cache database closure;
- network-observer unbinding;
- other container-scoped resource disposal.

Disposal must be idempotent and must not skip later resources because an earlier resource throws.

### Lifetime-lock ownership

The versioned-binary lifetime lock exposes a release operation to coordinated shutdown. It must not install signal handlers that race the main process and call `process.exit()` independently.

A synchronous process-exit fallback may remove only what can be safely removed synchronously; it cannot be treated as a replacement for coordinated asynchronous release.

## Shutdown phases

### Phase 1: Quiesce

Immediately stop new work from starting:

- mark the coordinator as shutting down;
- stop shell actions from launching new commands or overlays;
- gate new player and session operations;
- stop the download queue from claiming jobs;
- stop the background scheduler from accepting work;
- abort active provider resolution and other cancellable session work.

Quiescence is idempotent. Repeated requests cannot reopen work admission or start a second shutdown sequence.

### Phase 2: Restore the terminal

Restore the terminal near the beginning of shutdown:

- settle or stop root content;
- unmount Ink;
- restore stdin and terminal modes;
- clear terminal image placements.

The user should see an immediate response to `Ctrl+C` or `/quit` even while resource cleanup continues. Terminal restoration must not wait behind download, mpv, Discord, update, or background-work timeouts.

### Phase 3: Preserve critical state

Before external resources are forcibly terminated or storage is closed, attempt all critical persistence operations independently:

- persist the latest playback position and engaged watch time;
- flush pending configuration writes;
- persist active downloads as paused or retryable;
- mark the current playback queue session as cleanly interrupted and recoverable rather than leaving it indistinguishable from a crash;
- flush pending durable diagnostics.

A failure in one operation is recorded but does not prevent the others from running. Storage remains open until all preservation attempts have completed or their critical-state deadline expires.

### Phase 4: Release external resources

Run independent cleanup concurrently where safe:

- stop mpv after the playback checkpoint attempt;
- clear and disconnect Discord presence;
- terminate downloader subprocesses;
- release the versioned-binary lifetime lock;
- close transient IPC, callback, or similar process-lifetime resources.

Each resource has a local budget constrained by the remaining global deadline. Existing graceful-close, terminate, and force-kill escalation remains valid, but its combined duration must fit the real shutdown budget.

### Phase 5: Settle work and close storage

After preservation and external cleanup attempts:

- abort low-value background work;
- briefly drain already-running critical work;
- perform idempotent container disposal;
- close data and cache databases;
- detach observers;
- unref stdin;
- exit with the final accumulated status.

Synchronous child-process kill backstops remain registered for process termination paths where asynchronous cleanup cannot finish.

## Exit intents and status

All of these live-application intents converge on the coordinator:

- normal `/quit` or semantic session completion;
- `Ctrl+C` from the root shell;
- `Ctrl+C` from nested shell surfaces;
- `SIGINT`;
- `SIGTERM`;
- `SIGHUP`;
- uncaught exceptions;
- unhandled promise rejections.

Exit statuses are:

- normal user quit: `0`;
- `SIGINT`: `130`;
- `SIGTERM`: `143`;
- `SIGHUP`: `129`;
- fatal exception or rejection: nonzero failure status.

If a normal shutdown is already in progress and a fatal event occurs, cleanup continues through the existing in-flight sequence and the final status is upgraded to failure. Cleanup is never run twice.

Early standalone commands that exit before shell/container construction may continue using direct exit behavior because no live application state exists to coordinate.

## Failure handling

Each cleanup operation runs behind an error-isolating boundary. Failures are appended to shutdown diagnostics with the phase, resource, reason, and available context.

Examples:

- Discord failure cannot prevent playback or config persistence.
- Download pause failure cannot prevent terminal restoration, diagnostics flush, or database closure.
- Shell cleanup failure cannot prevent storage disposal.
- One database close failure cannot skip closure of the other database or observer cleanup.

After terminal restoration, shutdown errors use durable diagnostics and the existing non-Ink logging path. The coordinator must not try to remount or redraw the shell to report a cleanup error.

Kunai cannot guarantee preservation after an uncatchable `SIGKILL`, sudden power loss, kernel termination, or unrecoverable storage failure. This limitation must not weaken handled-exit guarantees.

## Deadline policy

Critical data is prioritized over best-effort integration politeness.

- Terminal restoration begins immediately and has a short local budget.
- Critical persistence receives the first bounded portion of the global deadline.
- Independent integration cleanup runs concurrently.
- Background draining is bounded.
- The overall deadline prevents indefinite process lifetime.
- Resource escalation uses the remaining deadline instead of independent timeout sequences whose sum exceeds the global deadline.

Exact timeout constants are implementation-plan decisions informed by existing tests and real terminal smoke. They must satisfy the behavioral contract rather than being duplicated as unrelated magic numbers across services.

## Startup verification

Use a new temporary profile with:

```json
{
  "onboardingVersion": 2,
  "downloadOnboardingDismissed": true
}
```

Use empty shadow data and cache stores. Do not use live Kunai databases or copy watch history without separate approval.

Verify:

1. Search is the first useful surface.
2. Immediate typing is retained.
3. Opening a root overlay immediately shows a loading scaffold if necessary and then renders.
4. Escape during the loading scaffold closes the overlay.
5. Reopening succeeds.
6. Another overlay opens normally.
7. No blank terminal, duplicate footer, lost input, or crash occurs.
8. Three cold runs are measured with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`.
9. All timing samples are reported and compared with the controlled 2.1–2.2 second baseline without claiming stability from one sample.

The overlay smoke may open Notifications as a representative root overlay, but this work must not change Notifications Inbox behavior or implementation.

## Shutdown verification

### Focused automated coverage

Add or adjust tests for:

- all shell exit requests reaching the coordinator;
- shutdown idempotence;
- fatal status escalation during an existing shutdown;
- preservation continuing when an individual cleanup operation throws;
- terminal restoration preceding slow integration cleanup;
- final playback checkpoint preceding mpv termination;
- pending configuration debounce flush;
- download work admission closing before active-job snapshot and persistence;
- terminated downloads becoming paused or retryable rather than remaining running;
- background scheduler rejection after quiescence and bounded drain behavior;
- version-lock release without competing signal exits;
- graceful queue-session interruption state;
- container disposal order, error isolation, and idempotence;
- real subprocess signal behavior where practical;
- the four-second or replacement global force deadline without waiting in real time.

### End-to-end smoke

Use shadow configuration and storage to verify:

1. Start Kunai and type immediately.
2. Exit from Search using `Ctrl+C`.
3. Exit from at least one nested surface.
4. Start playback, advance position, and request shutdown.
5. Confirm the persisted resume position reflects the latest checkpoint.
6. Confirm mpv and downloader children do not remain orphaned.
7. Confirm active downloads are resumable and not marked running.
8. Restart Kunai and confirm configuration, queue, history, and diagnostics remain readable.
9. Send `SIGTERM` and confirm conventional status plus clean terminal restoration.
10. Exercise a slow or failing cleanup dependency and confirm bounded exit with critical persistence still attempted.

## Repository gates

After focused tests and end-to-end verification, run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

Protect unrelated package and dependency work before and after formatting. Perform one focused code review covering only startup and shutdown lifecycle changes.

## Working-tree protection

Do not revert, stage, commit, reformat, or absorb unrelated changes in:

- Notifications Inbox implementation files and tests;
- `apps/docs/package.json`;
- `apps/docs/lib/generated-metadata.json`;
- `bun.lock`;
- dependency, version, or catalog hunks in the root `package.json`.

The startup work owns only the root `scripts.dev` hunk in `package.json`. Any later commit must stage that hunk separately from unrelated package changes.

## Acceptance criteria

The work is complete when:

1. The direct root development entrypoint and canonical overlay loader boundary pass focused and full verification.
2. Three controlled cold startup samples and immediate-input/overlay smoke results are recorded.
3. Every live shell, signal, and fatal-error exit path converges on one coordinator.
4. The terminal restores before slow external cleanup.
5. Active playback is checkpointed before mpv stops.
6. Pending config, download, queue, and diagnostic state is flushed or durably transitioned before storage closes.
7. Downloads and background workers cannot start new work after quiescence.
8. Cleanup failures do not skip unrelated preservation or disposal steps.
9. Shutdown is bounded and leaves no avoidable mpv or downloader orphan.
10. Focused tests, typecheck, lint, formatting, full tests, and build pass.
11. Notifications Inbox and unrelated package/dependency work remain intact.
