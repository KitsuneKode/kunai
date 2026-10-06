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
  re-paints; there is no dedicated reduced-output mode today. If this blocks
  you, tell us — it is the gap we most want real-world feedback on.
- **Color contrast.** The palette is fixed by the app theme rather than
  reading terminal color preferences, and low-vision contrast has not been
  formally audited.
- **Motion.** Progress spinners and shimmer placeholders animate while work
  runs; there is no reduced-motion switch yet.
- **mpv playback** happens in an external window controlled by mpv's own
  keybindings, which are outside this application's accessibility surface.

## Reporting barriers

If something blocks you, open an issue with the **bug report** template or a
note in [Discussions](https://github.com/KitsuneKode/kunai/discussions) —
include your terminal emulator, OS, and `TERM` value, and whether the problem
is input, reading the output, or both. Accessibility fixes are treated as
bugs, not feature requests.
