---
status: current
lastReviewed: "2026-11-27T20:08:00Z"
---

# mpv in-process stream reconnect (persistent session)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This applies only to the **persistent mpv** path (`PersistentMpvSession`, autoplay chain). One-shot `launchMpv` does not run this logic.

## What it does

When playback hits certain failure signals, Kunai **reloads the same stream URL** inside the existing mpv process via IPC (`loadfile … replace`), then:

- **VOD** (mpv reports a positive `duration`): **seeks** back to the last trusted position (capped near the end to avoid overshoot).
- **Live / unknown duration** (`duration` ≤ 0): **reload only** — no seek-back (same rule as normal “live” handling).

After a successful reload, **external subtitles are re-attached** from the current cycle options (same as a fresh file load path).

Provider TLS compatibility options are file-local on startup and replay. The
mp4upload exception follows the current URL; replacing it with another host restores
the user's prior mpv TLS setting. Native transition coverage includes exceptional
startup, same-URL replay, normal replacement, and both enabled/disabled baselines in
`apps/cli/test/integration/persistent-mpv-local-transition-native.test.ts`.

## When it runs

1. **`network-read-dead`** (from `playback-watchdog`): demuxer reports network + underrun + `raw-input-rate === 0` while paused-for-cache, sustained for ~8s. Fires at most once per stall incident from the watchdog; **reconnect attempts** are still capped per cycle.

An explicit user pause or `idle-active` suspends the watchdog clocks.
`core-idle` alone does not: mpv can report it while waiting for network cache,
which is exactly when starvation detection must remain active. Even a simultaneous
`paused-for-cache` does not override an explicit user pause. The watchdog suite
uses injected clocks to cover both cases without wall-clock sleeps.

2. **`video-lost`** (from `playback-watchdog`): frames had reached the output,
   then stopped while a video track stays selected and the clock keeps
   running, for 10 s of media clock (`VIDEO_DECODE_GRACE_SECONDS`). Pause,
   seek and turning video off (`vid=no`) restart the incident. The reload
   re-initialises the decoder at the same position, within the same budget.

3. **Premature EOF** (playback-stats guard): `end-file` with `eof` was **demoted** to `unknown` because trusted progress was inconsistent with a full watch (`eofDemotedByPrematureGuard`).

4. **`end-file` with `error`** while **`demuxer-via-network`** was true: treat as a reconnectable network demuxer error before surfacing a terminal failure.

**Never reloaded:** an end whose `file_error` says the URL cannot be opened or
holds nothing mpv can play (`isSameUrlRetryWorthwhile` in
`mpv-in-process-reconnect.ts`: `loading failed`, `unrecognized file format`,
`no audio or video data played`, output-initialisation failures,
`not supported`). Those go straight to source failover. Measured on mpv 0.42: a
403, a 404, a refused connection and an unknown host all end as
`error` / `loading failed`; non-media bytes as `unrecognized file format`; a
connection dropped mid-file and HLS segments that start answering 403 mid-play
both end as `eof`, so trigger 3 still covers them. The check guards triggers 3
and 4 alike: `applyEndFileEvent` marks every end that carries a `file_error` as
a demoted premature EOF, so before this a 403 was reloaded through trigger 3
(`stream-recovery-native.test.ts` fails without it).

If reconnect **succeeds**, the current `play()` promise **does not resolve** yet; playback continues until a normal end, quit, or exhaustion of retries.

If reconnect **fails** or limits are hit, the cycle ends and the usual `PlaybackResult` is returned.

## Hardware decode probe and selection

Hardware acceleration is decided once per mpv process launch, not at startup
and not by probing on every file load in the persistent chain. `PlayerServiceImpl`
reads the configured `mpvHwdec` mode into `MpvRuntimeOptions`; only `auto`
uses Kunai's machine evidence. The default `mpv-default` intentionally emits no
hardware-decoder argument at all, so the user's mpv.conf and mpv's own defaults
keep precedence. On an `auto` cache hit, successful hardware evidence makes the
launch pass mpv's mode `--hwdec=auto-safe`; on a cache miss or a negative probe
result the launch starts immediately with no `--hwdec` argument and, if probing
is available, warms one shared bounded probe in the background for the next mpv
process start. An already-running persistent mpv keeps its process arguments
until the next process start; changing the setting does not rewrite a reused
process mid-chain.

The probe in `infra/player/mpv-hwaccel-probe.ts` is bounded (1.5 s for
`--hwdec=help`, 3 s for a tiny stdin-fed decode), joined across concurrent
callers, and cached for seven days under the OS cache directory, keyed by
platform and the mpv invocation shape. The decode probe is a yes/no gate, not a
backend pin: because it must use null video output, direct decoders often cannot
create their real device there and mpv may report a copy fallback. Kunai records
that evidence for diagnostics but passes only `auto-safe`, letting mpv renegotiate
a direct backend with the real video output at playback time. As soon as decoded-frame
evidence is read the child is terminated, first with SIGTERM and then SIGKILL after
a short grace, because some mpv builds hang in shutdown even after a successful
null-output decode. Output read before termination is retained in the result. Failed
spawns and timeouts are not disk-cached, so the next explicit or playback-triggered
probe can retry.

Ordinary startup capability probing, setup rendering, and `kunai doctor` call
`readCachedMpvHardwareAcceleration()` only, so they report the last result
without spawning mpv. Setup's explicit `[r]` recheck is the deliberate exception:
it refreshes capabilities, including the hardware probe. Playback-triggered
`auto` cache misses also warm the cache in the background, never in the launch
path.

`auto` emits `--hwdec=auto-safe` only after successful cached hardware evidence.
If mpv is missing, times out before decode evidence, lists no GPU decoder, or
falls back to software for the sample, `auto` emits no hardware-decoder argument
and leaves mpv's own default intact. `mpv-default` always does that. `auto-safe`
and `auto-copy` are forwarded directly without running Kunai's probe. `off`
emits `--hwdec=no`. Explicit modes such as `vaapi` or `videotoolbox` are
forwarded directly and are the user's responsibility. No platform result is
hard-coded: discovery is OS-aware and injectable, while mpv's own `auto-safe`
negotiation chooses the backend available on that host.

## A/V-sync drift recovery

mpv exposes audio/video clock drift as the `avsync` property. The persistent
session observes it along with `pause` and `seeking`. Drift inside ±0.3 s is
left to mpv's own correction. Sustained drift outside that band — at least
three samples spanning 300 ms — triggers one corrective absolute seek to the
current playback position. The seek resets mpv's decoder/audio clocks without
tearing down the stream, unlike an in-process reconnect.

Resync is deliberately conservative. The extracted tracker in
`infra/player/mpv-avsync-recovery.ts` is suppressed while paused, cache-waiting,
core-idle, seeking, during Kunai-issued resume/reconnect work, reconnecting,
live, retired, missing IPC, before video output has started, or while another
correction is in flight. The grace clock is armed by mpv's `playback-restart`
or first video-output evidence rather than by `play()`/spawn, so a slow network
cannot consume it before the first frame. One correction cools down for five
seconds; if drift returns immediately after a resync the tracker gives up rather
than seek-looping, and an episode receives at most two separated corrections.
Each attempted correction and each give-up decision records a diagnostic
event. Non-finite or in-range drift clears accumulated evidence, and starting a
new cycle resets the tracker without inventing a pause-state change. The feature
is controlled by `mpvAvsyncRecovery` (default `true`) and can be disabled from
Settings, `config.json`, or `--mpv-avsync-recovery off` for a run. One-shot
playback does not run this recovery because there is no long-lived IPC supervisor
after launch, and one-shot playback does not observe per-frame `avsync` solely
for subtitle bookkeeping.

## Limits and backoff

- **`mpvInProcessStreamReconnectMaxAttempts`** (default `1`, and `1` is also the
  cap): counts **started** reloads per playback cycle (new episode resets the
  counter). `ConfigServiceImpl` clamps whatever is persisted down to
  `MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS` in `packages/config/src/defaults.ts`,
  so a hand-edited `config.json` asking for more gets one attempt. A dead stream
  answers a reload as fast as a live one, so a larger budget buys a retry loop
  against a URL that is not coming back. (`PersistentMpvSession.create` bounds a
  raw injected config at a higher structural ceiling — that path is for the test
  harness and the compiled smoke, not for user configuration.)
- **Backoff** after a failed `loadfile`: exponential from a base delay, capped (see `PersistentMpvSession` constants). Prevents hammering a dead CDN.
- **`reconnectInFlight`**: serializes overlapping reconnect work.

## Configuration (`~/.config/kunai/config.json`)

| Field                                    | Default       | Meaning                                                                                                                                         |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `mpvInProcessStreamReconnect`            | `true`        | Master switch. `false` disables automatic same-URL reloads (manual **Ctrl+r** / shell refresh still work).                                      |
| `mpvInProcessStreamReconnectMaxAttempts` | `1`           | Max reload attempts **per episode play**, and also the cap. Set `0` to disable (same as turning off retries).                                   |
| `mpvHwdec`                               | `mpv-default` | Hardware-decoder policy: pass no override, probe and use mpv `auto-safe`, use mpv automatic modes, force software, or pass an explicit backend. |
| `mpvAvsyncRecovery`                      | `true`        | Bounded sustained-drift correction in the supervised persistent mpv session.                                                                    |

## Relationship to other recovery

- **Provider refresh** (cache bust, new URL) and **Ctrl+r** in mpv remain the way to get a **fresh** resolve when the URL or lease is bad.
- **Libavformat reconnect** flags (`--demuxer-lavf-o=…`) are complementary; they only help when the backend supports them.
- **`keep-open=always`** is **not** used: it can suppress `end-file` and break autoplay/session hand-off. Reconnect is explicit IPC instead.

## Generations and stale work

Every mpv process and playback cycle carries a monotonic generation
(`{ process, cycle }`, `apps/cli/src/domain/playback/playback-generation.ts`).
Endpoint waits, IPC opens, property callbacks, `file-loaded`, end-file,
reconnect completions, and recovery work all capture the generation that created
them and compare it against the active one before mutating session state.

Stale work closes any handle it just created and returns without touching
status, presence, diagnostics, or the shell. Replacing or stopping a session
increments the generation **before** cleanup, so a late IPC event from the
previous cycle cannot revive a session the user already replaced or stopped.
Reconnect budgets and backoff above are unchanged by this.

Reconnect backoff and post-`file-loaded` completion carry the initiating
generation explicitly. They re-check it after every awaited seek, unpause, and
subtitle operation; a replacement during any one of those waits prevents every
remaining command and state mutation from the retired cycle.

## Output readiness: what "playback started" means

mpv's clock (`time-pos`) moves as soon as audio plays, so a stream whose video
never decodes (an unsupported codec, corrupt or missing video packets, a dead
hardware decoder) used to count as started: the startup watchdog was cancelled
by the first progress event, watch progress was recorded, and the user got
sound over a black window with nothing recovering. `video-params` is no proof:
mpv fills it from container metadata even when no frame decodes. A frame at the
output is: `video-out-params` (or `vo-configured`).

`infra/player/playback-output-gate.ts` owns the rule, and both emitters (the
persistent router and one-shot `mpv.ts`) use it per playback cycle:

- **Decoded video** or **audio-only** (no selected video track) starts on the
  first clock, as before.
- **Unknown track list** (on a cold start mpv can send the clock first) is
  checked with a direct read of `video-out-params`, `vo-configured` and
  `track-list` before anything is decided; if mpv still reports no tracks, or
  the read fails, the clock decides as before.
- **A selected video track with no frame** holds `playback-started` and every
  `playback-progress` event. A late frame starts playback immediately. After
  10 s of media clock with no frame, a second direct read confirms it, and the
  player emits `video-not-decoding` (with mpv's codec name). The session runner
  aborts through the same path as the startup stall, so source and provider
  recovery take over in about ten seconds instead of never.
- Nothing is concluded from a gap in the event stream: a failed read (timeout,
  closed socket) concludes nothing, and the 45 s startup-stall watchdog stays
  the backstop. Before it, a stream that has sent **no bytes at all** in 15 s
  (`STARTUP_NO_BYTES_TIMEOUT_MS`; no `network-sample` with input rate, cache
  speed or buffered seconds above zero) is abandoned as dead, not slow; any
  byte hands it back to the 45 s budget. The early exit applies only when the
  player reports bytes (`PlayerCapabilities.networkEvidence`), to remote
  http(s) URLs, and never to yt-dlp streams, whose extraction runs before any
  byte flows. Measured: real mpv emits byte-bearing `network-sample` events
  before `playback-started` on a trickling server, and none against a server
  that accepts the connection and never answers. mpv's "property unavailable" reply to `get_property` is an
  answer (no value), not an IPC failure: `mpv-ipc.ts` keeps it out of
  `onCommandResult`, so neither emitter reports it as `ipc-command-failed`.
  Both turn the remaining failures into events through
  `infra/player/mpv-ipc-failure-events.ts`.

Measured against mpv 0.42 with generated media (healthy, resume with
`--start`, corrupt video, video packets dropped, audio-only, `--vid=no`), and
pinned by `apps/cli/test/integration/video-decode-readiness-native.test.ts`,
which plays a healthy clip and one whose video packets are all dropped through
real mpv.

## Status recovery contract

One authoritative transition policy owns current playback status
(`apps/cli/src/app/playback/playback-status-policy.ts`):

- Fresh `playback-progress` is recovery evidence **only** from `buffering`,
  `stalled`, or `seeking`, and returns that session to `playing`.
- It never overrides `paused`, `stopped`, `finished`, a replaced session, or a
  terminal fallback/failure state that has not accepted a new stream.
  `playback-resumed` is the only paused-to-playing transition; stop stays
  authoritative.
- Genuine stall and provider-fallback evidence stays in the diagnostics record
  after status recovers, so the UI can still explain what happened.

Header, loading shell, diagnostics, and presence consume that one status. They
format it differently but never infer a second state machine. Note the two
distinct predicates in `SessionState.ts`: `isPlaybackSessionActive()` means "a
session exists" and includes the bootstrap states `loading`/`ready`, while
`isPlaybackTransportStarted()` means "bootstrap is over" and does not. Surfaces
deciding whether to keep a loading presentation need the latter.

## Playback stats and UI

- Diagnostics / shell may show **`mpv-in-process-reconnect`** events (`started` | `complete` | `failed`) with attempt number and a short `detail` (trigger + error when failed).
- Seek policy lives in `apps/cli/src/infra/player/mpv-in-process-reconnect.ts` (`computeInProcessReconnectSeek`).
- Presence updates from a superseded generation are dropped rather than sent.

## IPC writes under backpressure

Both Unix sockets and Windows named pipes use the same byte-oriented FIFO. A
partial Bun socket write retains the remaining bytes until `drain`; a later
command cannot splice its JSON into the unfinished line. This includes the initial
property subscriptions and UTF-8 media paths. Queued bytes are capped at 256 KiB;
a full queue rejects a tracked command rather than growing indefinitely.

A command deadline drops an entirely unsent command. If part of that command has
already been written, the session closes instead: discarding half a JSON line
corrupts framing, and sending its remainder after expiry could start retired
playback. Close discards the queue, settles pending commands, and prevents a late
drain from sending them. Expiry removes queued bytes or closes the session before
notifying result callbacks, so reentrant callbacks cannot send an expired command. This fixes a reproduced partial-write defect; it does not
by itself establish the cause of intermittent native transition failures.

## New-file watchdog baseline

Each file cycle resets watchdog position, progress/cache clocks and emitted
incident flags. The first observed sample establishes its baseline at observation
time, so a slow resolve/launch does not consume the stall budget before mpv can
report. Until advancing progress is observed, starvation is tagged `duringStartup`
and shown as waiting/buffering rather than an established-stream error. Real
network-read-dead recovery thresholds and retry limits are unchanged. Advancing
or explicitly resumed playback clears stale on-screen buffering feedback; the
incident stays in diagnostics.

## IPC receive bounds

The transport caps each newline-delimited IPC frame at 1 MiB of UTF-8 bytes,
including its newline. It checks raw bytes before decoding and JSON parsing,
including when a frame arrives across many chunks. An oversized or unterminated
frame closes the IPC session, clears its receive buffer and settles pending
commands with a size-limit error. A large socket batch of individually bounded
frames remains valid; fragmented multibyte characters retain the existing
StringDecoder behavior. This bounds malformed-peer resource use and is not a
claim that mpv or arbitrary media formats cannot contain vulnerabilities.
