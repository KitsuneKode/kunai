# Accessibility Statement

Kunai is a terminal-first application. This document says what that means for
access, where the known gaps are, and how to report barriers.

## What the environment is

The app runs entirely in a terminal emulator as a keyboard-driven TUI — there
is no pointer interaction anywhere, and every feature is reachable by keys or
the command palette. It requires an interactive TTY; scripting contexts get
plain non-interactive output instead of the shell.

## What works

- **Keyboard-only operation.** Every surface — browse, details, settings,
  playback controls, downloads, the setup wizard — is driven by arrow keys,
  Enter, single-key shortcuts, and `/` search. Nothing needs a mouse.
- **Text output.** All content is terminal text. Posters and cover art are
  decorative garnish rendered through optional graphics protocols
  (Kitty/iTerm2/Sixel/half-block); nothing is communicated by an image that
  is not also present as text, and the UI works identically with them off.
- **Degraded terminals.** `TERM=dumb` terminals and non-TTY output skip the
  graphics and probing layers entirely rather than emitting escape codes a
  dumb terminal cannot interpret.
- **Honest status.** Missing dependencies and failed operations surface as
  explicit text rows, never as color alone.

## Known limitations

- **Screen readers.** The shell uses full-screen redraws typical of TUI
  frameworks. Screen readers that track terminal output may announce large
  re-paints. Launch with **`-m` / `--minimal`** (or **`--zen`**, which implies
  it) for plain chrome: ASCII list cursors, shortcut labels without modifier
  symbols, no decorative emoji or mascot lines, no full-width box-drawing
  rules, no panel box borders, no terminal poster graphics (half-block included, and the slot is not reserved), and forced reduced motion for loaders.
  A saved `zenMode` setting enables that same plain chrome even when `minimalMode` is off.
  Information and keyboard reachability stay the same; only decoration drops.
  An interactive session with **`TERM=dumb`** gets the same ASCII glyph table
  even without `-m`. If minimal
  mode still blocks you, tell us — that is the feedback we most want.
- **Color contrast.** The palette is fixed by the app theme rather than
  reading terminal color preferences, and low-vision contrast has not been
  formally audited.
- **Motion.** Setting `KUNAI_REDUCED_MOTION=1` (or `NO_MOTION=1`) renders static
  loader marks instead of animated petals. **`-m` / `--minimal`** also forces
  reduced motion for every surface that reads the shared motion policy.
- **mpv playback** happens in an external window controlled by mpv's own
  keybindings, which are outside this application's accessibility surface.

## Reporting barriers

If something blocks you, open an issue with the **bug report** template or a
note in [Discussions](https://github.com/KitsuneKode/kunai/discussions) —
include your terminal emulator, OS, and `TERM` value, and whether the problem
is input, reading the output, or both. Accessibility fixes are treated as
bugs, not feature requests.
