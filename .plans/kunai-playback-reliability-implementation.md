# Kunai Playback Reliability Implementation Plan

## Summary

Kunai should treat mpv as a managed child process by default. The CLI stays alive while mpv is alive, supervises the player through IPC, updates shell state from real playback signals, and shuts mpv down cleanly when Kunai exits.

The current fast cache-hit path is useful, but a stream cache hit only means Kunai already has the provider URL and request headers. It does not mean mpv has opened the HLS manifest, selected tracks, filled cache, configured video output, or started moving playback time. The user-facing UI must make that distinction explicit.

The highest-risk areas are:

- Conflating IPC/control readiness with video playback readiness.
- Missing mpv buffering, seeking, cache, and video-output properties.
- Fixed timers around persistent `loadfile` and resume seek work.
- Subtitle discovery sitting on the stream critical path.
- Shutdown paths that abort the app before explicitly closing managed mpv.
- User mpv config that can intentionally delay startup, especially `cache-pause-initial=yes`.

## Product Decision

Managed mpv is the default behavior.

- Do not use `detached`/`unref` for playback handoff behavior.
- Keep Kunai alive while mpv is alive.
- Closing Kunai should stop mpv.
- Persistent/autoplay playback should reuse mpv and use `loadfile replace` for the next episode.
- `quit` is for closing mpv/Kunai.
- `stop` is for cancelling the current file.
- A future `--handoff` mode may reintroduce detached behavior, but it must be explicit and isolated.

## Implementation Stages

### Stage 1: Observability and State Semantics

Add mpv property observation for:

- `seeking`
- `paused-for-cache`
- `cache-buffering-state`
- `demuxer-cache-duration`
- `demuxer-cache-state`
- `cache-speed`
- `vo-configured`

Split player lifecycle events:

- `mpv-process-started`: child process exists.
- `ipc-connected`: control socket is connected.
- `player-ready`: Kunai can send player commands.
- `opening-stream`: mpv is opening the URL.
- `resolving-playback`: mpv is resolving/starting/seek-buffering.
- `network-buffering`: mpv is cache-paused for network/HLS cache.
- `playback-started`: playback time actually moved.
- `stream-stalled`, `seek-stalled`, `ipc-stalled`: actionable failure states.

### Stage 2: Managed Lifecycle Hardening

Make shutdown ownership explicit:

- `SessionController.shutdown()` aborts work and releases the persistent player session.
- `main.ts` handles `SIGINT`, `SIGTERM`, and `SIGHUP`.
- Shutdown awaits player release before closing the shell.
- IPC close and quit timers must not be unref-backed playback handoff behavior.

### Stage 3: Persistent Playback Sequencing

Persistent mpv should avoid fixed-timer synchronization as the main mechanism:

- Queue ready work after `loadfile replace`.
- Prefer mpv `file-loaded` before subtitle attach, resume seek, and auto-skip.
- Keep a short fallback only for missed/late IPC events.
- Do not pass `--start` to persistent mpv and then seek again through IPC.

### Stage 4: Cache-Hit UX

Cache provenance should feed user language:

- `stream-cache-hit`: Kunai has cached URL/headers.
- `launching-player`: player startup has begun.
- `mpv-process-started`: mpv exists.
- `ipc-connected`: commands are available.
- `opening-stream`: provider URL handed to mpv.
- `network-buffering`: mpv is waiting on HLS/network cache.
- `playback-started`: video is actually moving.

Never label a URL cache hit as “video ready.”

### Stage 5: Subtitle Critical Path

Immediate improvement:

- Stop waiting fixed seconds after `.m3u8` discovery solely for subtitle signals.
- Use direct/source subtitles already observed before the stream request.
- Use already-parsed Wyzie browser responses if available.
- Return the stream as soon as the URL is found.
- Do not run active Wyzie browser-service fallback on the stream critical path.

Follow-up architecture:

- Add a background subtitle resolver that can continue Wyzie/source subtitle resolution after playback starts.
- Attach late subtitles with `sub-add`.
- Only block playback on subtitles when the user explicitly chooses a future “wait for subtitles” option.

### Stage 6: Network Profile and Debugging

Use a conservative managed HLS profile:

- `--force-window=immediate`
- `--autofit-larger=90%x90%`
- `--cache=yes`
- `--cache-pause=yes`
- `--cache-pause-wait=2`
- `--demuxer-readahead-secs=20`
- `--demuxer-max-bytes=128MiB`

Benchmark before enabling `--cache-pause-initial=yes` globally because it intentionally delays first frame and seek resume.

Add later debug flags:

- `--mpv-debug`
- `--mpv-clean`
- `--mpv-log-file`
- `--no-user-mpv-config`

## Implemented In This Pass

- Expanded mpv observed property set.
- Added telemetry fields for seeking, cache pause, cache duration, cache speed, and video output configured state.
- Added richer playback events and shell states for buffering, seeking, stalled, and real playback start.
- Added a lightweight watchdog for stream, seek, and IPC stalls.
- Made managed shutdown await player release and added `SIGHUP` handling.
- Removed playback-critical `unref()` usage from IPC close/command timeout and persistent close timeout.
- Changed persistent start behavior to avoid duplicate `--start` plus IPC seek.
- Moved persistent ready work behind `file-loaded` with a bounded fallback.
- Added conservative HLS mpv args.
- Removed fixed subtitle waits after `.m3u8` interception in the scraper.
- Changed browser scraping so active subtitle fallback is deferred instead of blocking stream return.
- Added `--mpv-debug`, `--mpv-clean`, `--mpv-log-file`, and `--no-user-mpv-config`.
- Added late subtitle lookup and runtime `sub-add` attachment.
- Added diagnostics panel rows for mpv buffering, stream stalls, seek stalls, and IPC stalls.
- Added playback failure classification and recovery guidance.
- Added serialized playback control command execution.

## Remaining Follow-Up

- Add provider/source preference learning for subtitle quality and subtitle source success rate.
- Benchmark HLS startup with the user config vs clean mpv config.
- Promote the command queue into a fuller player actor if refresh/fallback/reload policies become more complex.

## Manual Verification Checklist

1. Play a cached HLS stream and confirm the UI says cache/launch/open/buffer/play in separate steps.
2. Pause for 10s, 30s, and 2min, then resume and watch for buffering vs stalled classification.
3. Press `space`, `f`, and mpv keyboard controls during a suspected freeze and compare IPC responsiveness.
4. Compare normal mpv config with a clean/no-config mpv run once debug flags exist.
5. Verify autoplay uses one persistent mpv process and advances through `loadfile replace`.
6. Verify `Ctrl+C`, `SIGTERM`, and terminal close stop mpv cleanly.
7. Verify subtitles no longer delay stream launch when no subtitle was observed before `.m3u8`.
