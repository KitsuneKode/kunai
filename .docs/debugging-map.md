---
status: current
lastReviewed: "2026-09-02"
---

# Kunai Debugging Map

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

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

### Rows missing or text welded together on screen (OPEN)

Reported on the post-play rail: the `❀ anime` badge, the title row, and the
`── synopsis ──` divider absent from the screen, with stray text fused onto fact
values (`2006urite`, `★ 8.5tion`) in a colour no element on that surface uses.

**Do not debug this in the model or the component.** That layer is ruled out and
pinned by `apps/cli/test/unit/app-shell/media-panel-rail-frame.test.tsx`: the
rendered frame carries every section, ends each fact value at the value, and
emits no line wider than the rail it was given, at every rail width. A correct
frame reaching a wrong screen means the fault is in the **write path**, so
search there:

Ink erases the previous frame by walking UP from where it believes the cursor is,
one erase-line per remembered row. That belief holds only while Ink is the sole
writer to stdout, and three things in this app are not Ink.

**Already eliminated — do not re-run these:**

| Suspect                                                                                       | How it was ruled out                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model and the component                                                                   | `media-panel-rail-frame.test.tsx` pins the rendered frame: every section present, each fact value ending at the value, no line wider than the rail, at all four rail widths.                                                                                                                                                                               |
| `clearRootContentTransitionFrame()` — the raw `ESC[2J ESC[H` on every root-content transition | Drove the real `mountRootContent` transition under a PTY and replayed the bytes through a terminal emulator. Screen was clean: header plus all four rows of the new surface, no stale cells. The `ESC[2J` blanks what the misaimed erase misses, and Ink re-synchronizes on the next frame.                                                                |
| Ink frames interleaving into a chunked Kitty upload                                           | The chunk loop in `image/kitty-transport.ts` yields to the event loop every 8 chunks, and the graphics protocol requires one transmission's chunks to be contiguous. Measured with both writers instrumented and Ink re-rendering on a 4 ms timer: **0 foreign writes** landed between the 14 chunks. Ink's 30 fps throttle is far slower than the yields. |

Note while reading that code: `ink-external-clear-desync.test.tsx` still pins the
desync itself (13 erase-line ops, 12 cursor-up ops, aimed at a cursor the clear
already moved home), because it is real and load-bearing if anything ever stops
the `ESC[2J` from landing. Its sibling `clearShellScreen()` documents the
opposite rule — "the raw ANSI clear is intentionally omitted, Ink's reconciler
handles repaint" — so the two disagree and one of them is wrong.

**Still open:** `sixel-overlay.ts`, which writes at absolute positions on a
`setTimeout(0)` — unthrottled, unlike Ink — and the interaction between the
image renderer actually in use and the host terminal. Reproducing needs the
reporter's environment: which renderer `detectImageCapability()` chose, and the
terminal itself. The repro recipe that eliminated the two rows above is a PTY at
a fixed size feeding raw bytes to a terminal emulator (`pyte`); it is worth
rebuilding rather than guessing, because it shows the screen a viewer sees
rather than the bytes a writer sent. Isolate the run per
[features/privacy-and-storage.md](./features/privacy-and-storage.md).

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
its one-second playback-stats frames otherwise replay and blink the framebuffer;
browse and post-play should still use sharp Sixel output.

**Providers behave differently than on Linux.** The `curl.exe` Windows ships in
System32 is a Schannel build with no HTTP/2 (`curl --version` lists no `HTTP2`
feature). Provider paths that negotiate HTTP/2 degrade against it; the winget
`cURL.cURL` build has it. Cloudflare also fingerprints the TLS handshake, so
plain curl (HTTP/2 or not) is often not enough for AniDB/Miruro. The native
installer drops a portable curl-impersonate under
`%LOCALAPPDATA%\kunai\deps\curl-impersonate` (x64, same archive CI pins) and
puts that directory on the User PATH so `kunai doctor` reports `curl=ok
(chrome…)` instead of `plain (no CF bypass)`.

**curl-impersonate is not an HTTP/2 curl.** The two are separate binaries and
separate problems, and conflating them has bitten this repo once already. The
release archive ships `curl-impersonate.exe` plus `curl_*.bat` wrappers and no
`curl.exe`, and only `resolveCurlCandidate` (AniDB, Miruro) ever selects those.
Anything spawning the literal `curl` still gets System32's Schannel build:
[`hls-relay.ts`](../apps/cli/src/infra/player/hls-relay.ts) for the CDNs that
block mpv's TLS fingerprint, and Miruro's own `detectCurlHttp2Support` probe.
That build does not negotiate `--http2` down — it refuses the flag with
`the installed libcurl version doesn't support this` and exits 4 before
connecting — so the relay asks
[`infra/os/curl-features`](../apps/cli/src/infra/os/curl-features.ts) first and
drops the flag rather than failing the stream. The installer still offers the
`cURL.cURL` upgrade even when it just installed curl-impersonate.

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
