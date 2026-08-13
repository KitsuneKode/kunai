# Poster protocol release smokes

Status: **pending manual evidence after PR #35**.

PR #35 completes the bounded, zero-install native poster pipeline. These checks
need real terminal emulators and stay active separately from the landed code so
the implementation plan can be archived without implying unsupported evidence.

## Required before stable release

- [ ] iTerm2: automatic OSC 1337 poster rendering, resize, rapid navigation, and
      exit cleanup.
- [ ] VS Code terminal 1.80 or newer: automatic inline poster rendering and clean
      text fallback when the version is missing or older.
- [ ] Windows Terminal 1.22 or newer: Sixel framebuffer placement, resize, rapid
      navigation, and cleanup. This is also tracked by
      [`sixel-in-ink.md`](./sixel-in-ink.md); record one shared result, not two runs.
- [ ] Kitty or Ghostty: native placement, stale-upload suppression, resize, and exit
      cleanup.
- [ ] tmux, screen, SSH, redirected stdout, and unsupported terminals: no raw escape
      leakage and a correct text-only UI.
- [ ] Remote TMDB art and local offline sidecar art: bounded acquisition and visible
      fallback when an image is invalid or oversized.

Record the terminal name/version, OS, command, and pass/fail evidence in this
file. A failed smoke becomes a focused issue or PR; do not reopen plan 034.
