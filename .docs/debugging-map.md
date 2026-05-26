# Kunai Debugging Map

Use this map when a bug crosses subsystem boundaries and you need the first file
or diagnostic surface to inspect.

## Canonical References

- Runtime ownership: [.docs/runtime-boundary-map.md](runtime-boundary-map.md)
- Diagnostics and redaction: [.docs/diagnostics-guide.md](diagnostics-guide.md)
- Test and smoke policy: [.docs/testing-strategy.md](testing-strategy.md)
- Release confidence gate: [.docs/release-reliability-gate.md](release-reliability-gate.md)

## Playback Lifecycle And mpv IPC

Start with:

- `apps/cli/src/app/PlaybackPhase.ts`
- `apps/cli/src/infra/player/PersistentMpvSession.ts`
- `apps/cli/src/infra/player/persistent-mpv-runtime.ts`
- `apps/cli/test/integration/persistent-mpv-session-harness.test.ts`

Use this path for mpv launch, first-play readiness, episode transitions,
property floods before readiness, subtitle cleanup, reconnect-after-load, and
end-file classification. The fake mpv harness proves app-side ordering; use a
real mpv smoke only after deterministic tests pass.

## Provider Resolution And Fallback

Start with:

- `apps/cli/src/services/playback/PlaybackResolveService.ts`
- `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- `packages/core/src/provider-engine.ts`
- `apps/cli/src/services/providers/ProviderRegistry.ts`
- `apps/cli/src/services/playback/SourceInventoryService.ts`
- `.docs/playback-source-inventory-contract.md`

Look for provider attempt timelines, failure codes, selected source inventory,
cache provenance, and whether a failure is final or still inside retry/fallback.
Physical attempt events come from the core provider engine and are forwarded
into app diagnostics as `provider.resolve.attempt` and
`provider.resolve.fallback`. Live provider checks stay manual and bounded; do
not add them to default CI.

## Presence And Rich Presence

Start with:

- `apps/cli/src/services/presence/PresenceServiceImpl.ts`
- `apps/cli/test/live/discord-presence.smoke.ts`
- `.docs/presence-integrations.md`

Presence should be optional, privacy-preserving, and diagnosable. Activity
payloads may include playback timestamps when mpv reports enough position and
duration data, but provider URLs, source URLs, auth headers, and local paths must
not be exposed.

## Storage, Cache, And History

Start with:

- `packages/storage/src/`
- `apps/cli/src/services/source-inventory/SourceInventoryServiceImpl.ts`
- `apps/cli/src/services/history/`
- `apps/cli/src/config.ts`

SQLite stores are the active persistence path for app data and caches. JSON
config/provider files remain user configuration paths; legacy JSON history/cache
code should be treated as compatibility or migration context.

## Diagnostics Event Flow

Start with:

- `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
- `apps/cli/src/services/diagnostics/DiagnosticsStoreImpl.ts`
- `apps/cli/src/app-shell/panel-data.ts`
- `apps/cli/src/services/diagnostics/support-bundle.ts`

Prefer structured diagnostics events for user-facing troubleshooting and debug
JSONL traces for long local sessions. Redaction must preserve enough shape to
debug host/stage/provenance while removing secrets, tokens, cookies, stream URLs,
authorization headers, and private home-directory prefixes.

Active runtime writers should call `DiagnosticsService.record()`. Store reads
remain valid for panel snapshots and support-bundle assembly; direct
`diagnosticsStore.record()` calls outside diagnostics internals are guarded by
`apps/cli/test/unit/services/diagnostics/diagnostic-recorder-boundary.test.ts`.

When events cross subsystems, join them by `sessionId`, `playbackCycleId`,
`providerAttemptId`, and `traceId`. The support bundle `correlation` summary is
the quickest way to see which IDs are available in an exported report.

For startup latency, inspect the diagnostics panel in this order: Startup path,
Slowest stage, Provider attempts, Source inventory, Network/mpv rows, then
Subtitles. This separates first-play delay from late subtitle attachment and
post-start playback health.

## Shell And Commands

Start with:

- `apps/cli/src/app-shell/command-registry.ts`
- `apps/cli/src/app-shell/ink-shell.tsx`
- `apps/cli/src/app-shell/root-overlay-shell.tsx`
- `apps/cli/src/app-shell/picker-overlay.tsx`

Command behavior should route through the canonical command registry and shared
picker/overlay surfaces. Avoid adding provider-specific or player-specific
policy inside render-only shell components.
