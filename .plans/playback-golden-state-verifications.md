# Playback Golden State Verification

Use this after the mpv golden-state pass to verify the runtime, diagnostics, cancellation, subtitles, and recovery guidance.

## Automated Checks

Run these from the repo root:

```sh
bun run fmt
bun run typecheck
bun run lint
bun run test
```

Expected result:

- all commands exit successfully
- no TypeScript errors around player controls, late subtitle attachment, or mpv runtime flags
- no lint warnings
- existing playback, subtitle, browser, shell, and player unit tests remain green

## CLI Flag Smoke Checks

Run each command far enough to confirm mpv launches or the shell reaches playback startup:

```sh
bun run dev -- --mpv-debug
bun run dev -- --mpv-clean
bun run dev -- --no-user-mpv-config
bun run dev -- --mpv-log-file ./mpv-debug.log
```

Expected result:

- `--mpv-debug` adds verbose mpv logging
- `--mpv-clean` launches mpv with `--no-config`
- `--no-user-mpv-config` launches mpv with `--no-config`
- `--mpv-log-file ./mpv-debug.log` writes an mpv log file when playback starts

## Esc Cancellation

Verify Esc in each loading-like state:

1. Start playback from a title with provider resolution work.
2. Press Esc while the shell says `Resolving provider stream`.
3. Start playback again and press Esc while the shell says `Launching player`, `Player controls ready`, `Network buffering`, `Seeking`, or `Stalled`.

Expected result:

- during provider resolve, Esc aborts resolve and returns to results
- after provider resolve, Esc stops active mpv playback/startup instead of doing nothing
- diagnostics should record either `Cancelling active work` or playback stop command events

## Long Pause Freeze Reproduction

Run a known problematic stream normally:

```sh
KITSUNE_DEBUG=1 bun run dev -- --debug 2> debug.log
```

Steps:

1. Start playback.
2. Pause in mpv for 10 seconds, resume, and observe.
3. Repeat with 30 seconds.
4. Repeat with 2 minutes or the known freeze threshold.
5. During or after the freeze, open `/diagnostics`.

Expected result:

- shell distinguishes `buffering`, `seeking`, `stalled`, or `playing`
- diagnostics include mpv buffering, stream stall, seek stall, or IPC stall rows
- recent runtime events include a failure class and recovery guidance

Useful log search:

```sh
rg "network-buffering|stream-stalled|seek-stalled|ipc-stalled|paused-for-cache|cache-speed|demuxer-cache" debug.log
```

## Clean mpv Comparison

Repeat the long-pause test with user config disabled:

```sh
KITSUNE_DEBUG=1 bun run dev -- --debug --mpv-clean --mpv-log-file ./mpv-clean.log 2> debug-clean.log
```

Expected result:

- if the freeze disappears, user mpv config/scripts are strongly implicated
- if the freeze remains, provider/HLS expiry, network, or mpv core behavior is more likely

Compare:

```sh
rg "HTTP|error|timeout|cache|seek|pause|demuxer" mpv-clean.log
rg "HTTP|error|timeout|cache|seek|pause|demuxer" mpv-debug.log
```

## Recovery Guidance

Trigger or simulate these cases where possible:

- network buffering
- stream stall
- seek stall
- IPC command timeout
- player exit/error

Expected result:

- network buffering suggests waiting briefly or refreshing if speed stays flat
- expired/empty cache speed suggests refreshing the provider source
- seek stuck suggests refreshing the current source
- IPC stuck suggests relaunching mpv
- player exit suggests fallback provider if relaunch fails

## Late Subtitle Attachment

Use a title/provider case where no subtitle is observed before `.m3u8` capture.

Expected result:

- playback starts without waiting for active subtitle lookup
- diagnostics record `Late subtitle lookup started`
- if Wyzie returns tracks, diagnostics record `Late subtitle lookup attached tracks`
- mpv receives late subtitles via `sub-add`
- shell subtitle status updates from not found to attached/tracks available when state still matches the active title/episode

## Control Queue

During active playback, press these quickly:

- `s` reload subtitles
- `r` refresh source
- `f` fallback provider
- `q` stop
- Esc during buffering/stalled state

Expected result:

- diagnostics show playback control command started/completed events
- commands do not race each other through IPC
- refresh/fallback/stop behavior remains deterministic

## Pass Criteria

This pass is considered good when:

- automated checks pass
- Esc cancels both provider resolve and player startup/buffering states
- long-pause freeze can be classified in diagnostics
- clean mpv comparison gives actionable signal
- late subtitles do not delay first playback
- recovery guidance points to the correct next action

