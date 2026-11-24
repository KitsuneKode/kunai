---
status: current
lastReviewed: "2026-11-24T20:12:20Z"
---

# Player: VLC (desktop)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

How `--player vlc` works on desktop, and the measurements it rests on. Code:
`apps/cli/src/infra/player/vlc/` (`vlc-launch.ts`, `vlc-status.ts`,
`vlc-player-service.ts`); capabilities `VLC_CAPABILITIES` in
`apps/cli/src/domain/playback/player-capabilities.ts`.

## Model

One VLC process per playback, in the user's own interface. Kunai adds VLC's
Lua HTTP interface bound to `127.0.0.1` on a free port, polls
`/requests/status.json` every 500 ms, and folds each status into the same
`PlayerStatsState` mpv feeds (`applyVlcStatus`). The watchdog, the output
gate (`playback-output-gate.ts`), trusted progress, the premature-EOF guard and
`finalizePlaybackResult` run unchanged, and `observation: "managed"` routes it
through the same session runner as mpv (startup stall, `video-not-decoding`
recovery, history, presence).

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

Auto-skip, the Kunai in-player menu and share key, in-player track picks,
same-window next episode (`in_play` works; wiring is P4 of the players plan),
yt-dlp streams (refused with `--player mpv` as the way out). Flatpak VLC is not
used: its private `/tmp` cannot see the session config. macOS and Windows
discovery paths are implemented but unmeasured; the native test
(`apps/cli/test/integration/vlc-player-native.test.ts`) runs wherever VLC is
installed.
