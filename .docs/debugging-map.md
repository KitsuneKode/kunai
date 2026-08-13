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

- `apps/cli/src/app/playback/PlaybackPhase.ts`
- `apps/cli/src/infra/player/PersistentMpvSession.ts`
- `apps/cli/src/infra/player/persistent-mpv-runtime.ts`
- `apps/cli/test/unit/infra/player/persistent-mpv-session-harness.test.ts`

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
- `apps/cli/src/services/playback/SourceInventoryService.ts`
- `packages/storage/src/repositories/history.ts`
- `apps/cli/src/services/persistence/ConfigService.ts`

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

- `apps/cli/src/domain/session/command-registry.ts`
- `apps/cli/src/app-shell/ink-shell.tsx`
- `apps/cli/src/app-shell/root-overlay-shell.tsx`
- `apps/cli/src/app-shell/picker-overlay.tsx`

Command behavior should route through the canonical command registry and shared
picker/overlay surfaces. Avoid adding provider-specific or player-specific
policy inside render-only shell components.

## Windows-Specific Failure Modes

Windows breaks in ways POSIX hides, and several of these presented as something
other than a platform bug. Check here before assuming the logic is wrong.

**The CLI does nothing and exits 0.** In a `bun build --compile` binary on
Windows, `import.meta.main` is false for the entry module — Bun compares
`import.meta.path` (`B:\~BUN\root\main.js`) against the main specifier
(`B:/~BUN/root/main.js`) and the separators disagree. Any `if (import.meta.main)`
startup guard silently never fires. Use `isProcessEntrypoint`
(`apps/cli/src/infra/build/entrypoint.ts`). Running from source hides this
completely, so only a compiled-artifact smoke catches it.

**Playback works but the session falls back and launches more mpv.** mpv accepts
only the Win32 spelling for `--input-ipc-server`. Given `//./pipe/NAME` it starts
normally, logs nothing, and never creates the pipe; every `Bun.connect` then
fails, the player reads as dead, and fallback launches another mpv on top of one
already playing. The endpoint must be `\\.\pipe\NAME`
(`apps/cli/src/infra/player/mpv-ipc-endpoint.ts`). `Bun.connect` accepts either
spelling, so only the mpv side constrains this.

**mpv opens a black window and exits with zero progress.** Check
`mpv.hls-manifest.rejected` first. Kunai probes ordinary HLS manifests before
launch and treats HTTP 401/403/404/410 as stream-scoped terminal evidence: it
must advance the source without spawning mpv or degrading whole-provider
health. Fetch/TLS failures and retryable HTTP responses may still fall through
because mpv can negotiate them differently from Bun.

**Posters look chunky rather than sharp.** Sixel is encoded in-process and does
not need `half-block`, but Windows Terminal exposes no version environment variable.
The DA1 probe (`apps/cli/src/image/probe.ts`) is therefore the only automatic way
to confirm sixel support; if it times out, capability falls back to half-block.
`KUNAI_IMAGE_PROTOCOL=sixel` forces it; `kunai doctor` reports the resolved
renderer and the reason it was chosen. `half-block` only improves text-mode fallback.
The Now Playing rail intentionally uses half-block on Sixel terminals because
its one-second telemetry frames otherwise replay and blink the framebuffer;
browse and post-play should still use sharp Sixel output.

**Providers behave differently than on Linux.** The `curl.exe` Windows ships in
System32 is a Schannel build with no HTTP/2 (`curl --version` lists no `HTTP2`
feature). Provider paths that negotiate HTTP/2 degrade against it; the winget
`cURL.cURL` build has it.

**Tests fail in teardown after passing.** `rmSync` on a directory holding an open
SQLite handle raises EBUSY on Windows — POSIX unlinks open files, Windows does
not, and retrying never helps because the handle is held for the process
lifetime. Close first: `apps/cli/test/helpers/temp-store.ts`.

**Tests read real user data.** `XDG_*` variables are Linux-only in
`getKunaiPaths`; on Windows the roots come from `LOCALAPPDATA`/`APPDATA`. A test
overriding only `XDG_CACHE_HOME` isolates nothing there. Use
`apps/cli/test/helpers/storage-env.ts`.

**Text fixtures stop matching.** `.gitattributes` pins the working tree to LF.
Without it a Windows clone checks files out CRLF, which breaks `\n`-anchored
parsers and makes bash reject `install.sh` lines.
