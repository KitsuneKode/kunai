# mpv in-process stream reconnect (persistent session)

This applies only to the **persistent mpv** path (`PersistentMpvSession`, autoplay chain). One-shot `launchMpv` does not run this logic.

## What it does

When playback hits certain failure signals, Kunai **reloads the same stream URL** inside the existing mpv process via IPC (`loadfile … replace`), then:

- **VOD** (mpv reports a positive `duration`): **seeks** back to the last trusted position (capped near the end to avoid overshoot).
- **Live / unknown duration** (`duration` ≤ 0): **reload only** — no seek-back (same rule as normal “live” handling).

After a successful reload, **external subtitles are re-attached** from the current cycle options (same as a fresh file load path).

## When it runs

1. **`network-read-dead`** (from `playback-watchdog`): demuxer reports network + underrun + `raw-input-rate === 0` while paused-for-cache, sustained for ~8s. Fires at most once per stall incident from the watchdog; **reconnect attempts** are still capped per cycle.

2. **Premature EOF** (telemetry guard): `end-file` with `eof` was **demoted** to `unknown` because trusted progress was inconsistent with a full watch (`eofDemotedByPrematureGuard`).

3. **`end-file` with `error`** while **`demuxer-via-network`** was true: treat as a reconnectable network demuxer error before surfacing a terminal failure.

If reconnect **succeeds**, the current `play()` promise **does not resolve** yet; playback continues until a normal end, quit, or exhaustion of retries.

If reconnect **fails** or limits are hit, the cycle ends and the usual `PlaybackResult` is returned.

## Limits and backoff

- **`mpvInProcessStreamReconnectMaxAttempts`** (default `3`, max `12`): counts **started** reloads per playback cycle (new episode resets the counter).
- **Backoff** after a failed `loadfile`: exponential from a base delay, capped (see `PersistentMpvSession` constants). Prevents hammering a dead CDN.
- **`reconnectInFlight`**: serializes overlapping reconnect work.

## Configuration (`~/.config/kunai/config.json`)

| Field                                    | Default | Meaning                                                                                                    |
| ---------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `mpvInProcessStreamReconnect`            | `true`  | Master switch. `false` disables automatic same-URL reloads (manual **Ctrl+r** / shell refresh still work). |
| `mpvInProcessStreamReconnectMaxAttempts` | `3`     | Max reload attempts **per episode play**. Set `0` to disable (same as turning off retries).                |

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

## Telemetry and UI

- Diagnostics / shell may show **`mpv-in-process-reconnect`** events (`started` | `complete` | `failed`) with attempt number and a short `detail` (trigger + error when failed).
- Seek policy lives in `apps/cli/src/infra/player/mpv-in-process-reconnect.ts` (`computeInProcessReconnectSeek`).
- Presence updates from a superseded generation are dropped rather than sent.
