# Reliability Core Autonomous Sweep

Status: Implemented 2026-05-17
Owner: next autonomous implementation agent
Created: 2026-05-17

> **For agentic workers:** execute this plan before the coherence sweep. Use a clean working tree or preserve unrelated user edits. Commit only this sweep's changes. Do not run live provider or Discord checks unless explicitly requested.

## Goal

Make Kunai's playback, provider, presence, and background-work paths harder to break silently. This pass should improve deterministic coverage, diagnostics, and boundaries without broad architecture rewrites.

## Implementation Summary

- Added `runBackgroundTask` for intentional fire-and-forget work with redacted diagnostics.
- Routed playback/session/presence/download background tasks through explicit failure handling.
- Moved `PersistentMpvSessionRuntime` into a dedicated persistent mpv runtime port.
- Added deterministic fake-IPC coverage for resume prompt timeout behavior.
- Added recoverable diagnostics for source-inventory cache failures.
- Extended provider live-smoke payloads with `providerId`, `engine`, `resolveDurationMs`, `skipped`, and existing isolated profile evidence.
- Updated release, testing, live-smoke, and presence docs.

## Verification

Passed on 2026-05-17:

```sh
bun run fmt
bun run lint
bun run test
bun run typecheck
bun run build
bun run pkg:check
```

Live provider and Discord smokes were not run; they remain opt-in release-confidence checks.

## Why This Comes First

The follow-up docs/codebase coherence sweep depends on behavior being stable. This pass addresses the reliability layer first: mpv lifecycle seams, Discord presence correctness, provider smoke boundaries, background task failures, and diagnostics evidence.

## Non-Negotiables

- Keep live provider and Discord checks opt-in.
- Do not wire live provider checks into `bun run test`, CI, Husky, or default release automation.
- Do not emit stream URLs, request headers, local profile paths, Discord secrets, provider tokens, or full IPC payloads in diagnostics.
- Preserve caller-visible rejections where callers can act on failures.
- Leave unrelated working tree changes untouched.

## Implementation Scope

### 1. Background Task Guardrails

Add a small shared helper for intentional fire-and-forget async work.

Expected behavior:

- Accepts a task name, subsystem, optional context, and async callback or promise.
- Catches rejected background work.
- Records redacted diagnostics when a diagnostics service/store is available.
- Falls back to debug logging only when diagnostics are not available.
- Does not replace normal `await` paths or hide failures from direct callers.

Candidate areas to audit and update:

- `apps/cli/src/app/SessionController.ts`
- `apps/cli/src/app/PlaybackPhase.ts`
- `apps/cli/src/infra/player/PersistentMpvSession.ts`
- `apps/cli/src/infra/player/persistent-mpv-property-router.ts`
- `apps/cli/src/services/presence/PresenceServiceImpl.ts`
- `apps/cli/src/services/download/DownloadService.ts`
- `apps/cli/src/services/playback/PlaybackResolveService.ts`
- `apps/cli/src/services/playback/SourceInventoryService.ts`
- `apps/cli/src/services/update/UpdateService.ts`

Acceptance:

- Meaningful `void asyncWork()` paths are either awaited, routed through the helper, or explicitly documented as cleanup-only.
- Unit tests prove a rejected background task records a redacted diagnostic and does not crash the command path.

### 2. MPV Persistence Boundary Cleanup

Move the persistent-session runtime seam out of raw IPC.

Expected behavior:

- `PersistentMpvSessionRuntime` lives in a dedicated persistent runtime/port module, not `mpv-ipc.ts`.
- Production runtime still uses the same mpv IPC implementation.
- Fake runtime harness tests import the dedicated port.
- No user-facing playback behavior changes from the move alone.

Additional deterministic coverage:

- no redundant IPC seek after `loadfile` already starts at the requested timestamp
- reconnect-after-load has bounded retry behavior
- resume prompt timeout is explicit and deterministic
- property flood before ready work does not corrupt current-cycle state
- subtitle cleanup still uses the latest observed track list/cache

Acceptance:

- Existing persistent mpv harness tests still pass.
- New or updated tests fail before the fix when practical and pass after implementation.

### 3. Diagnostics And Error Propagation Audit

Classify silent catches and swallowed queue tails.

Required classifications:

- `cleanup`: failure is not user-visible and no state should change
- `external optional`: best-effort metadata/subtitle/timing fetch
- `recoverable degraded`: feature continues with degraded behavior
- `user-visible failure`: playback/provider/storage/presence failure the user may need to diagnose

Expected behavior:

- `recoverable degraded` and `user-visible failure` paths record diagnostics with redacted context.
- `cleanup` catches remain short and local.
- `external optional` catches preserve enough evidence to debug repeated upstream failures.
- Command queues remain usable after failures, and the original caller still sees the rejection.

Candidate areas:

- playback resolve and source inventory services
- SQLite cache/source inventory persistence
- config/provider override persistence
- subtitle, TMDB, AniSkip, IntroDB fetch paths
- presence reconnect/heartbeat
- download cleanup and artwork preparation

Acceptance:

- Tests cover at least one representative path for each non-cleanup classification.
- No sensitive data is introduced into diagnostics snapshots.

### 4. Provider Reliability Gates

Keep provider drift checks explicit while making their output more useful.

Expected behavior:

- Deterministic provider/parser/adapter tests cover touched provider paths.
- Live provider smoke scripts remain skipped unless their env flag or script invocation explicitly opts in.
- Live smoke JSON includes privacy-safe fields:
  - `ok`
  - `skipped`
  - `providerId`
  - `engine`
  - `isolatedProfile`
  - `resolveDurationMs`
  - `streamResolved`
  - `streamHost`
  - `failureCodes`

Acceptance:

- `bun run test` does not hit providers.
- Smoke docs explain that live checks are manual release-confidence checks, not CI checks.
- Existing provider live scripts still print `isolatedProfile: true` when they run.

### 5. Discord Presence Reliability

Verify current Rich Presence behavior and fill deterministic gaps only.

Expected behavior:

- Playing presence uses current progress and duration to set Discord timestamps.
- Paused presence freezes the visible time and does not show an advancing timer.
- Browsing updates can start heartbeat when appropriate.
- Backoff can recover after elapsed retry windows.
- Duplicate payloads are skipped.
- Clear-on-stop is reliable.

Acceptance:

- Unit tests cover timestamp calculation, pause behavior, heartbeat start, backoff recovery, duplicate suppression, and clear behavior.
- Presence diagnostics remain privacy-safe.
- Richer UX ideas, such as Discord buttons or buffering text, are documented as follow-up unless already supported by existing data.

## Documentation Updates

Update durable docs only when implementation changes behavior or verification gates:

- `.docs/release-reliability-gate.md`
- `.docs/testing-strategy.md`
- `.docs/presence-integrations.md`
- `apps/cli/test/live/README.md`

Docs must clearly state:

- default tests are deterministic
- live provider checks are manual and opt-in
- Discord smoke is opt-in and only required when presence changed
- fake mpv IPC tests do not replace one manual real-mpv smoke before release

## Verification Checklist

Required before commit:

```sh
bun run fmt
bun run lint
bun run test
bun run typecheck
bun run build
```

Run if package metadata, exports, or release docs changed:

```sh
bun run pkg:check
```

Do not run by default:

```sh
bun run test:live:providers
KUNAI_LIVE_DISCORD_PRESENCE=1 bun run test:live:discord
```

## Commit

Commit after successful verification:

```sh
git add <only files changed by this sweep>
git commit -m "fix: harden reliability core seams"
```

## Final Report Requirements

Report:

- commit hash
- files changed by area
- reliability issues fixed
- tests added or updated
- verification commands and results
- live checks intentionally not run
- remaining follow-ups for the coherence sweep
