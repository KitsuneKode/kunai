---
status: current
lastReviewed: "2026-11-25T04:42:41Z"
---

# Player: VLC (desktop)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

How `--player vlc` works on desktop, and the measurements it rests on. Code:
`apps/cli/src/infra/player/vlc/` (`vlc-launch.ts`, `vlc-status.ts`,
`vlc-player-service.ts`); capabilities `VLC_CAPABILITIES` in
`apps/cli/src/domain/playback/player-capabilities.ts`.

## Model

One VLC process per playback, in the user's own interface; in autoplay-chain
mode one process per chain (below). Kunai adds VLC's
Lua HTTP interface bound to `127.0.0.1` on a free port, polls
`/requests/status.json` every 500 ms, and folds each status into the same
`PlayerStatsState` mpv feeds (`applyVlcStatus`). The watchdog, the output
gate (`playback-output-gate.ts`), trusted progress, the premature-EOF guard and
`finalizePlaybackResult` run unchanged, and `observation: "managed"` routes it
through the same session runner as mpv (startup stall, `video-not-decoding`
recovery, history, presence).

## Same window, next episode

`playbackMode: "autoplay-chain"` launches VLC with `--play-and-stop`, so the
window stays when a file ends, and the next chain `play()` sends `in_play` with
that file's own options (`buildVlcInPlayQuery`, `vlcItemOptions`). A reused
window keeps the process number and takes the next cycle, as mpv's persistent
session does. In this mode a file ends on the first `stopped` status after it
opened; one that never opens is given `OPEN_GRACE_MS` (right after `in_play`
the status can still describe the previous file) and then ends as `error`.
`stopCurrentFile` (Kunai's next, previous, recover) sends `pl_stop` and keeps
the window; `releasePersistentSession` (post-play, exit, a new title) closes
it. A window the user closes between episodes is noticed and replaced by a
fresh launch. Every other mode keeps `--play-and-exit` and ends a file when VLC
exits. In both, end-of-file is judged from the last status that still
described the file, because VLC's final `stopped` status has no length left.

## Auto-skip

`vlc-auto-skip.ts` runs mpv's instant path with mpv's functions
(`playback-skip.ts`, `playbackSkipConfig`): inside an enabled recap, intro or
credits segment, seek once to its end and emit `segment-skipped`; a backward
seek re-arms segments still ahead. Credits skip whenever auto-skip is on, as
mpv's player passes `autoNextEnabled: true`. The control implements
`skipCurrentSegment` (the skip key, whatever the toggles), `updateTiming`
(late timing), `updateAutoSkipEnabled` and `getTimingSnapshot`. Next-episode
prefetch fires at mpv's credits-aware trigger
(`resolveNearEofPrefetchTriggerSeconds`). There is no on-screen prompt: VLC has
no Kunai overlay.

## Measured (VLC 3.0.24, Linux, generated media, 2026-11-25)

| Question                                            | Finding                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decode evidence                                     | `stats.displayedpictures` rises once pictures reach the output; `decodedvideo` alone is not enough (`--codec=dummy` decodes, displays nothing)                                           |
| Healthy clip                                        | pictures displayed before `time` > 0                                                                                                                                                     |
| No H.264 decoder (Arch without `vlc-plugin-ffmpeg`) | video stream listed, audio plays, `displayedpictures` stays 0 → `video-not-decoding`                                                                                                     |
| `--vout=dummy`                                      | still counts displayed pictures once a decoder exists; fine for headless tests                                                                                                           |
| Corrupt video packets                               | VLC conceals and shows pictures (~1.5 s); not a failure for VLC                                                                                                                          |
| Video packets all dropped (TS)                      | no video stream listed → audio-only to VLC                                                                                                                                               |
| Clock                                               | `time` is whole seconds; `position × length` is sub-second                                                                                                                               |
| Password                                            | in a session copy of the user's `vlcrc` passed with `--config` (0600, private temp dir); the last `http-password` wins, so a user's own is overridden; never in argv                     |
| Commands                                            | `pl_pause`, `pl_play`, `seek&val=`, `pl_stop`, `in_play&input=` work                                                                                                                     |
| Fractional seek                                     | `seek&val=4.5` lands on a whole second; Kunai rounds the target itself (`vlcSeekTarget`)                                                                                                 |
| `--play-and-stop`                                   | at the end of a file VLC stays open and reports `stopped` with `length` and `position` 0; `pl_stop` does the same mid-file                                                               |
| `in_play` options                                   | `&option=:meta-title=…`, `:start-time=`, `:sub-file=` apply to that item and do not carry into the next one; a `file://` URI plays a local path                                          |
| Start, title                                        | `:start-time=` and `--start-time`; `:meta-title=`                                                                                                                                        |
| Request shape                                       | `:http-referrer=` and `:http-user-agent=` reach the server; Origin and cookies cannot be set → streams with headers go through the loopback stream gateway                               |
| Subtitles                                           | HTTP: `:input-slave=<url>` (not `:sub-file`); local: `:sub-file=`, or `addsubtitle` with a path mid-play. A global `--sub-file` carries into the next `in_play` item — keep it per input |

## Pinned launch flags

`--no-one-instance` and `--no-playlist-enqueue` (a user's single-instance
setting would hand the URL to another VLC and exit), `--no-loop --no-repeat
--no-random` (the file must end), `--play-and-exit`, `--no-video-title-show`,
`--no-qt-privacy-ask`.

## End reasons

VLC exits 0 for a finished file and a closed window alike. Within 3 s of the end
→ `eof` (through the premature-EOF guard); a Kunai or user stop → `quit`; VLC
exiting without ever opening the input → `error`.

## Not yet

An on-screen skip prompt, the Kunai in-player menu and share key, in-player
track picks (`trackControl` stays false), yt-dlp streams (refused with
`--player mpv` as the way out). Flatpak VLC is not
used: its private `/tmp` cannot see the session config. macOS and Windows
discovery paths are implemented but unmeasured; the native test
(`apps/cli/test/integration/vlc-player-native.test.ts`) runs wherever VLC is
installed.
