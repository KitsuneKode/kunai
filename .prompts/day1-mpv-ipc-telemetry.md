# Day-1 Agent Prompt: MPV IPC And Playback Telemetry

You are working in the Kunai repo as the Day-1/runtime-aware agent.

Goal:
Fix the runtime blocker found by Phase 3 QA: real playback reaches `mpv`, but history does not persist because player telemetry returns `{ watchedSeconds: 0, duration: 0, endReason: "eof" }`. Build a reliable MPV IPC/telemetry foundation so history, Continue Watching, auto-next, and future source/subtitle switching have trustworthy player state.

## Read First

1. `AGENTS.md`
2. `.docs/architecture.md`
3. `.docs/diagnostics-guide.md`
4. `.docs/ux-architecture.md`
5. `.plans/storage-hardening.md`
6. `.plans/turborepo-and-package-boundaries.md`
7. `.docs/testing-strategy.md`

## Read Code

1. `apps/cli/src/mpv.ts`
2. `apps/cli/src/infra/player/PlayerService.ts`
3. `apps/cli/src/infra/player/PlayerServiceImpl.ts`
4. `apps/cli/src/app/PlaybackPhase.ts`
5. `apps/cli/src/app/playback-history.ts`
6. `apps/cli/src/app/playback-policy.ts`
7. `apps/cli/src/services/persistence/SqliteHistoryStoreImpl.ts`
8. `apps/cli/test/unit/app/playback-history.test.ts`
9. `apps/cli/test/integration/playback-policy.test.ts`
10. `apps/cli/test/unit/services/persistence/SqliteStoreImpl.test.ts`

## QA Context

Phase 3 QA found:

- SQLite cache path works.
- Stream cache hits are real.
- No new repo-root `stream_cache.json` was written.
- Real CLI handed off to `mpv`.
- History did not persist because runtime logged:

```json
{ "watchedSeconds": 0, "duration": 0, "endReason": "eof" }
```

This means SQLite did not fail; player telemetry failed or was insufficient.

## Required Outcome

Implement a reliable player telemetry path.

Preferred direction:

- Use `mpv --input-ipc-server=<socket-or-pipe>` where supported.
- Poll or request `playback-time`, `duration`, `time-pos`, `percent-pos`, `pause`, `core-idle`, and end reason where practical.
- Keep the Lua reporter only as fallback if useful.
- Persist a useful final playback result on EOF/quit/error.
- Never save fake history for an instant failed playback.
- If EOF is real but duration is missing, use the strongest available telemetry snapshot instead of `{0,0}`.
- Keep terminal state stable.

Minimum telemetry model:

- current position seconds
- duration seconds when available
- end reason: eof, quit, error, unknown
- whether the player process exited cleanly
- last non-zero progress sample
- final result source: ipc, lua, progress fallback, or unknown

## Scope

Allowed:

- Refactor `apps/cli/src/mpv.ts`.
- Add small helper modules under `apps/cli/src/infra/player/` or `apps/cli/src/player/` if helpful.
- Add tests around parsing IPC events, choosing best telemetry snapshot, and history persistence decisions.
- Add diagnostics events for telemetry source and fallback.
- Update docs to state history sign-off depends on MPV telemetry.

Not allowed:

- Do not extract providers.
- Do not start `@kunai/core`.
- Do not change subtitle provider logic.
- Do not rewrite the shell broadly.
- Do not add daemon pairing.
- Do not fake history saves for `{0,0,eof}` without reliable evidence.

## Implementation Guidance

Design for this future:

- subtitle/audio switching from Kunai controls
- source hot-swap after stalls
- buffer/stall detection
- accurate Continue Watching
- auto-next based on true EOF

But implement only the telemetry foundation now.

If full IPC is too large for one pass:

1. Add an internal `PlayerTelemetry` model.
2. Improve final result selection using the last non-zero progress sample.
3. Add IPC as an optional path behind the same model.
4. Keep tests proving history can persist when EOF final file reports zero but a prior progress sample exists.

## Tests To Add Or Update

Add focused tests for:

- parsing mpv telemetry reports
- selecting final playback result from IPC/final/progress snapshots
- EOF with zero final duration but non-zero progress sample
- quit with partial progress
- no save for instant failure with all zero telemetry
- `shouldPersistHistory` remains conservative

Run:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
```

If possible, run a smoke check with writable XDG dirs:

```sh
XDG_DATA_HOME=/tmp/kunai-smoke-data \
XDG_CACHE_HOME=/tmp/kunai-smoke-cache \
XDG_CONFIG_HOME=/tmp/kunai-smoke-config \
bun run dev -- -i 438631 -t movie --debug
```

Do not require a live smoke to pass if environment/media/network prevents it; report clearly.

## Acceptance

- Real playback telemetry no longer collapses to `{0,0,eof}` when there was actual progress.
- History saves when playback meaningfully progressed or truly completed.
- Instant failed playback still does not create bogus history.
- Diagnostics explain telemetry source and fallback.
- SQLite history can be QA-signed after a real playback run.
- Tests cover the bug path.

Report:

- What telemetry path is primary.
- What fallback remains.
- Tests added.
- Verification results.
- Whether real playback history sign-off is now possible.
