---
lastReviewed: "2026-11-25"
---

# Poster protocol release smokes

Run the opt-in harness from a source checkout with Bun, Kunai's usual CLI
dependencies, and the target terminal installed.

```sh
bun run smoke:posters -- --terminal kitty
bun run smoke:posters -- --terminal tmux
bun run smoke:posters -- --terminal foot
bun run smoke:posters -- --terminal xterm
bun run smoke:posters -- --terminal konsole
bun run smoke:posters -- --terminal wezterm
bun run smoke:posters -- --terminal current --expect half-block
```

`tmux` starts a private server inside a new Kitty window with passthrough enabled.
`xterm` launches with `-ti vt340`. `konsole` expects sixel (Kunai keeps Konsole
off Kitty because it never frees stored image data), and `wezterm` expects
direct Kitty placement. The launcher enables WezTerm's Kitty graphics setting in its private
window and reports a skip when the requested emulator is missing.
`current` needs an open terminal at least
124 columns wide so the Library preview rail fits. `--out NEW_DIR` chooses a
new evidence directory. The harness otherwise prints the temporary directory it
created. `--expect` checks the renderer without forcing it. Existing image
protocol, transport, probe and tmux overrides are available for fallback checks.

The harness seeds two offline thumbnails and launches the real CLI with
`--offline`, a disposable profile, and analytics disabled. It navigates between
the fixtures, resizes its private Kitty window when available, and quits with
Ctrl+C. `terminal.ansi` contains the PTY transcript. `report.json` records the
selected protocol, exit status, and any failure. Kitty can also capture
composed text. X11 windows can capture PNGs with ImageMagick's `import`.
Use X11 or Xvfb for screenshot evidence on Konsole and WezTerm, and install
`xdotool` to find the private WezTerm window. For Kitty protocols, including
direct placement, the harness checks that the selected fixture colours appear
and that both are absent after exit when screenshots are available. CI does not
launch these smokes.

The launcher gives the emulator access to Wayland when the display and runtime
directory are both available. The CLI uses an isolated profile with dotenv
loading disabled. Each redraw must use the renderer observed at startup.
SIGINT, SIGTERM and SIGHUP stop the child and remove its profile. They also
restore stdin in `current` mode or close the private emulator and its tmux server
when launched. If tmux shutdown fails, the launcher reports the socket path and
retains it so shutdown can be retried.

## Local evidence

Observed on 2026-11-25 on Linux x86-64 with a private Xvfb display and the
terminal graphics stack through `989548f4f`.

| Terminal                     | Command                                                                           | Result                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitty 0.51.1                 | `bun run smoke:posters -- --terminal kitty`                                       | `kitty-native`. First and next posters, resize, and exit passed screenshot colour checks. Screen text and transcript passed the graphics escape scan. |
| tmux 3.8 inside Kitty 0.51.1 | `bun run smoke:posters -- --terminal tmux`                                        | `kitty-tmux`. First and next posters, resize, and exit passed screenshot colour checks. Screen text and transcript passed the graphics escape scan.   |
| tmux 3.8 passthrough opt-out | `KUNAI_IMAGE_TMUX=0 bun run smoke:posters -- --terminal tmux --expect half-block` | `half-block`. Selection change, resize, exit, and the graphics escape scan passed.                                                                    |
| foot or xterm with VT340     | `bun run smoke:posters -- --terminal foot` or `--terminal xterm`                  | Pending a machine with either emulator installed.                                                                                                     |

## Required before stable release

- [ ] iTerm2: automatic OSC 1337 poster rendering, resize, rapid navigation, and
      exit cleanup.
- [ ] VS Code terminal 1.80 or newer: automatic inline poster rendering and clean
      text fallback when the version is missing or older.
- [ ] Windows Terminal 1.22 or newer: Sixel framebuffer placement, resize, rapid
      navigation, and cleanup.
- [x] Kitty 0.51.1 and Kitty passthrough in tmux 3.8 with offline fixture artwork:
      selection change, resize, exit, and printable escape scan.
- [ ] Direct Kitty placement in WezTerm, and Sixel in Konsole. Native Sixel pixels
      through tmux on a Sixel-capable emulator.
- [ ] Kitty or Ghostty post-play: stale-upload suppression and multiple placements.
- [ ] Screen, SSH, redirected stdout, and unsupported terminals: no printable
      graphics escapes and a correct text-only UI.
- [ ] Remote TMDB art and local offline sidecar art: bounded acquisition and visible
      fallback when an image is invalid or oversized.

Record the terminal name and version, OS, command, and observed result here.
