# Kitty visual and live verification

## Launch

From `apps/cli`, with Kitty and Bun installed and a graphical desktop:

```sh
bun run agent:kitty --evidence /tmp/kunai-visual-NEW
```

Choose a NEW directory each run. The default scenario opens the real CLI with
fixture providers, captures home, clicks the visible commands footer through
the terminal mouse protocol, waits for the palette and captures it. Profiles
and sockets are private; evidence remains after cleanup. No tmux, inherited
`NO_COLOR`, personal Kitty configuration, production credentials or user SQLite
is involved. The font is explicitly selected; check that it exists rather than
accepting a fallback with wide glyph spacing. Pass `--font "Your Installed Mono Font"` to override the host's DankMono default.

Use a JSON recipe for another journey:

```json
{
  "argv": [],
  "steps": [
    { "type": "expect", "value": "Search title" },
    { "type": "capture", "value": "home" },
    { "type": "click", "value": "[/]" },
    { "type": "expect", "value": "type a command" },
    { "type": "capture", "value": "palette" },
    { "type": "key", "value": "escape" }
  ]
}
```

```sh
bun run agent:kitty --scenario /tmp/recipe.json --evidence /tmp/kunai-recipe-NEW
```

Other steps: `text` types text; `decoded` checks real mpv. Keys use Kitty's
names (`enter`, `down`, `ctrl+c`). Click labels must identify a unique visible
target; do not guess a row from an old screenshot. A recipe's CLI arguments
still run inside the isolated profile.

For real providers, add `--live --provider <production-id>` to a non-matrix
recipe. Omitting the pin is rejected before launch; the selected provider is
the only enabled provider, so fallback cannot qualify a different adapter.

## Doctor

Apply compositor placement rules to the actual Kitty launch process. A rule
attached only to the Bun runner may not propagate to its child window. Before
input, query the owned native window's monitor and workspace and compare them
with the maintainer's reserved surface. Stop a misplaced window and correct the
launcher; do not keep testing on the display in use.

Inspect the first PNG, not only its text: correct app, readable monospace font,
no clipped controls or stale image, expected mode/provider. Confirm
`cleanup.json` eventually reports clean privacy state. Missing screenshot
support, no display, an unavailable provider or an expired observation deadline
means failed/unqualified. Never change timeouts just to hide a hung transition.

Kitty 0.49.2 on this host supports `kitty @ screenshot --match id:<id>`.
It captures the owned terminal including graphics, without capturing unrelated
desktop windows. The selected tab/window must be visible within its Kitty
instance. Older Kitty builds may lack this command; report that limitation.

## Drive and feature coverage

| Feature                  | User path                                  | Required evidence                                                        | Reverse/failure                                                                |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Browse footer            | Click commands, search, navigation or mode | Before/after PNG + text, intended surface                                | Overlay removes underlying targets; disabled action does not fire              |
| For you now              | First click selects, second activates      | Row highlight + exact resolved action/history identity                   | Other row, keyboard input, replacement target and overlay cancel old selection |
| Artwork                  | Search and move between results            | Inspect selected identity and actual PNG                                 | Stale request, no artwork, resize and mode switch                              |
| Movie/series/anime/video | Resolve and play through real CLI          | Pinned provider, mpv IPC time advances, positive video size, decoded PNG | Missing title, blocked delivery, audio-only/no video, stall, cancellation      |
| Cleanup                  | Stop the owned session                     | Exit/privacy report, retained evidence                                   | Failed launch and aborted playback also clean up                               |

Mouse steps inject SGR press/release into the PTY. They exercise the real
stdin parser and layout hit tests but **do not prove native OS pointer input**.
For that claim use desktop automation only against this owned window, capture
its actual result, and label the input route. Never click blindly on another
Kitty/mpv instance. Keyboard and mouse should share their action owner; a
second independent pointer implementation will drift.

## Native desktop click proof (Linux / Hyprland)

Use this only when native desktop input was authorized. Keep it serial with all
other desktop drives. This host has `ydotoold`, `ydotool` and writable
`/dev/uinput`; if those prerequisites are absent, report the limitation rather
than installing a service or changing permissions.

1. Start a fresh owned session. Find its Hyprland client by the returned Kitty
   PID, then address only that client. Respect the user's chosen monitor and
   workspace. Never move or click an unrelated window.
2. Create a temporary `ydotoold --socket-path <private-profile>/input` child and
   wait until its socket and virtual mouse appear. Pass that socket explicitly
   through `YDOTOOL_SOCKET` to `ydotool`.
3. Capture a fresh PNG/text frame and parse only the owned window's Kitty
   `columns`/`lines` and Hyprland `at`/`size`. Raw Kitty `ls` includes environment
   data: never print or retain the entire response.
4. Map the **center** of the unique label's terminal cell rectangle into the
   owned client's logical pixels. Account for borders/padding and display scale;
   do not click the first cell edge. Move the cursor, re-check focused client
   identity, send one native button press/release, then inspect a new capture.
5. Stop the temporary input daemon and owned session in `finally`. Restore
   previous focus/cursor only if focus still belongs to your QA window; never
   override a user who has switched away.

For home shortcuts, witness first-click selection and second-click activation
separately. Compare with keyboard behavior and the persisted action identity.
This native route needs its own evidence record; the default helper's `click`
step remains terminal-protocol injection.

## Live production provider matrix

```sh
bun run agent:kitty --matrix --live --evidence /tmp/kunai-live-NEW
# A focused qualification, still no substitute provider:
bun run agent:kitty --matrix --live --provider vidlink --evidence /tmp/kunai-vidlink-NEW
```

The matrix derives cases from `loadProductionProviderModules()`: Inception
TMDB 27205 for movie lanes, Breaking Bad TMDB 1396 S1E1 for series, One Piece
AniList 21 E1 for anime and Big Buck Bunny's YouTube video for the video lane.
These are dated sample controls, not availability promises. Each case gets its
own profile and disables every other provider. It does not prove every source,
quality, subtitle language or title in that provider. Missing catalog content
and upstream failures cannot be repaired by silently changing the sample.

The default deadline is 45 seconds to observe mpv progress, bounded by
`--timeout 5..120`. Routes run one at a time; an unsuccessful case records its
failure and the matrix continues. After startup it requires over eight seconds
of advancing playback within a separate twenty-second observation window.
Use `--observe 8..120` for an explicitly longer sample, with twelve seconds of
extra observation allowance. A short black opening needs a later inspected
frame before classifying it as a video defect. Preserve the first result; do not
rewrite it as a pass. This is a short smoke, not a soak or stream-completion
test. No automatic reruns, stream downloading, WAF bypass,
shared media relay or CI schedule is added. Run the large live matrix only
when explicitly requested; the normal test suite stays deterministic.

## Evidence and cleanup

Numbered PNG/text/backend captures preserve each step. `results.json` records
the source commit and dirty tree flag. `playback.json` records
mpv time positions and video dimensions; `decoded-frame.png` must be inspected
for real visual output. An advancing clock plus a black or broken frame still
needs investigation. A capture/IPC deadline does not establish a provider outage;
inspect the named failed command, the UI capture and any intermediate playback
proof separately. `results.json` distinguishes route failures and cleanup
failures and explicitly leaves visual review pending. A passing helper does
not approve playback quality or release readiness by itself.

The machine status is `playback-progress-observed`: clock progress and positive
dimensions can also describe audio with a cover image. They do not prove
decoded frame advancement; neither does mpv's estimated frame number. Inspect
the captured picture separately.

Startup setup failures dispose their profile. SIGINT/SIGTERM cancel the active
route and await the same cleanup as normal completion before results are
recorded. A concurrent stop call waits for the in-flight stop rather than
returning early. The runner then removes both signal handlers.

The helper closes only its own window and observed mpv session, checks consent
and install identity, confirms the application/player processes exited, disposes its temporary profile
and retains the external
evidence. If child exit cannot be confirmed, cleanup fails and keeps the
profile rather than deleting files beneath a running process. Keep screenshots and transcripts private: they can show titles,
subtitles or provider error text. Publish a redacted summary rather than raw
URLs, cookies, player argv, environment dumps or profile files.

## Research and maintenance

Cursor's [create verification skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md)
and [maintenance workflow](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md)
informed the feature map, owned-instance lifecycle and evidence-survival check.
Kunai's implementation reuses its profile/SQLite helpers and production roster.
Check [Kitty's current remote-control interface](https://sw.kovidgoyal.net/kitty/remote-control/)
and [mpv JSON IPC](https://mpv.io/manual/stable/#json-ipc) against installed tools.
Ghostty macOS AppleScript can provide additional synthetic terminal input;
that platform feature is not a Linux Kitty replacement or physical-click proof.
