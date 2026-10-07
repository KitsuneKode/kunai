# Feature coverage for a verification pass

Choose the rows relevant to the change; do not run every opt-in tier by default.
Start through the feature map, then inspect the owning code/tests before a drive.
Use a fresh named tmux session when launch, signals, TTY, or persistence matter.
Use an in-process replay for focused wiring. Keep the credential backend `file`.

| Journey             | Observable proof                                                                                      | Reverse or failure case                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Fresh startup/setup | Wizard is actionable at 72/80/100 columns; finish reaches Browse; persisted preferences agree         | Missing dependencies remain actionable; Esc abort; skipped defaults leave analytics unset and installId empty |
| Returning launch    | Same profile survives real quit/relaunch; correct route for `--offline`, search/ID/anime flags        | Invalid flags fail before session creation; early exit leaves no held session/profile                         |
| Search/catalog      | Query, selected stable identity, correct movie/series/anime lane                                      | Empty/error/cancel; fast typing or paste does not run another action                                          |
| Up Next             | Exact intended item queued; pending/starting facts match SQLite; relaunch retains intent              | Remove/reorder/clear; failed startup rolls back claim; retry does not double-consume                          |
| Playback            | Source request is probed with shipped headers; active destination/session is visible                  | Pre-load failure, cancellation, stalled playback and source recovery                                          |
| Post-play           | Actual outcome yields correct resume/replay/next/return actions                                       | Interrupted playback retains resume; queue empty/end; local artifact avoids provider resolve                  |
| Downloads/offline   | Acquisition intent differs from watch queue; validated local artifact plays after provider retirement | Cancel/retry, missing sidecar/file, low space; offline activation cannot silently resolve online              |
| Settings/privacy    | Visible toggle and committed config agree after deferred writes; relaunch retains it                  | Disable and inspect; defaults/abort never mint consent or installId                                           |
| Cleanup/support     | Doctor is healthy; report has frame + backend; owned stop removes sidecar                             | Tampered paths/vault are rejected before reads; failed start cleaned; evidence survives stop                  |
| Phone preview       | Named physical device and host show the bounded fixture playing                                       | Reject unsupported request profile honestly; VLC launch alone cannot acknowledge queue consumption            |

For series and anime, check their separate identity/episode mapping before
claiming parity. Queue means watch intent; downloads mean acquisition jobs;
playlists mean saved collections. One screen does not prove the others.

## Record a result

Record the exact candidate revision, driver/command, source tier, profile label,
input sequence, captured frame path, committed-state witness, expected literal
result, reverse case, and unresolved prerequisites. Never retain provider URL,
header/cookie, token, or live-profile content in public evidence. Fixture evidence
is reproducible; live-provider and device observations are dated qualifications.
