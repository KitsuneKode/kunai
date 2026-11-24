# Accessibility Statement

Kunai is a terminal-first application. This document describes how it works with
keyboard navigation, screen readers, contrast preferences, reduced motion, and
color settings, where remaining gaps live, and how to report barriers.

## What the environment is

The app runs in a terminal emulator as a keyboard-driven TUI. Every feature is
reachable by keys or the command palette (`/`). In terminals that report mouse
events, some targets (browse focus, setup choices, list rows) also accept
clicks; pointer support is additive, never required, and turns off in plain
mode or with `KUNAI_NO_MOUSE=1`. Non-TTY invocations get plain non-interactive
output or JSON (`-S --json`, `doctor --json`, `capabilities --json`).

## What works

- **Keyboard-only operation.** Every surface — browse, details, settings,
  playback controls, tracks, downloads, setup, and overlays — is driven by
  arrow keys, Enter, single-key shortcuts, and `/` search. Nothing needs a
  mouse.
- **Plain / screen-reader mode.** Enable with `--plain` (per run),
  `KUNAI_PLAIN=1` (environment override; `KUNAI_PLAIN=0` forces it off), or
  **Settings → General → Plain / screen-reader mode** (`plainMode` in
  `config.json`). Plain mode:
  - Stops all animations (implies reduced motion).
  - Removes box-drawing borders, decorative glyphs, mascot art/emoji, and
    poster images across browse, details, settings, playback status, post-play,
    tracks, setup, command palette, and overlays.
  - Stacks two-pane views into linear, single-column output and runs in the
    normal terminal buffer (`alternateScreen: false`) with mouse reporting off.
  - States focus, selection, active tabs, switches, checkboxes, progress, and
    status explicitly in words (`[selected]`, `[active]`, `[on]`/`[off]`,
    `[ok]`/`[missing]`, `[done]`/`[in progress]`/`[pending]`, `[42%]`,
    `Loading:`, `Empty:`, `Error:`, `Warning:`, `Notice:`, `Focus:`).
- **Light and high-contrast themes.** Selectable in **Settings → General →
  Theme**, `/theme`, `config.json` (`theme`), or `KUNAI_THEME=<id>`:
  - `paper-sakura` (**Paper Sakura (Light)**) — warm light surfaces with
    measured WCAG AA (`>= 4.5:1`) and APCA body/label contrast across every
    surface elevation, and `>= 3:1` control borders (WCAG 1.4.11).
  - `high-contrast-dark` (**High Contrast Dark**) and `high-contrast-light`
    (**High Contrast Light**) — pure black / pure white canvases with measured
    WCAG AAA (`>= 7:1`) text and semantic status contrast across every surface
    elevation, plus `>= 4.5:1` dim hints and control borders.
  - All ratios are asserted in automated unit tests (`theme-registry.test.ts`
    and `color-resolution.test.ts`).
- **Reduced motion.** Setting `KUNAI_REDUCED_MOTION=1`, `NO_MOTION=1`, or
  enabling plain mode stops every animated surface in the shell: petals
  (`SakuraPetal`), the sakura bloom and glimmer label (`SakuraLoader`,
  `SakuraBloom`, `GlimmerLabel`), the braille spinner (`LoadingState`), the
  setup dependency recheck animation, loading shell animations, and the exit
  fade sequence (`ExitShell`). Busy messages, progress values, and elapsed
  timers remain readable without motion, and an automated inventory test
  (`motion-policy-coverage.test.tsx`) fails if a new animated component skips
  the motion gate.
- **`NO_COLOR` compliance.** Follows [no-color.org](https://no-color.org/):
  any non-empty `NO_COLOR` value disables rich color and auto image rendering;
  an empty `NO_COLOR=""` is ignored as unset.
- **Text-first output and degraded terminals.** Posters and cover art are
  optional garnish — nothing is communicated by an image or color alone.
  `TERM=dumb` and non-TTY output skip graphics and terminal probing.

## Known limitations

- **Terminal screen-reader variance.** Even with `--plain` using the normal
  screen buffer and linear output without animation, Ink still redraws the
  active prompt frame on keypresses. Behavior varies across terminal emulators
  and screen readers (VoiceOver, NVDA, JAWS, Orca, BRLTTY). If a specific
  combination reads poorly or chatters, please report it.
- **Automatic OS dark/light detection.** Kunai does not query the OS
  dark/light preference automatically; pick `paper-sakura`,
  `high-contrast-dark`, or `high-contrast-light` once in Settings or via
  `KUNAI_THEME`.
- **mpv playback** happens in an external window controlled by mpv's own
  keybindings, which are outside this application's accessibility surface.

## Reporting barriers

If something blocks you, open an issue with the **bug report** template or a
note in [Discussions](https://github.com/KitsuneKode/kunai/discussions) —
include your terminal emulator, screen reader (if any), OS, and `TERM` value,
and whether the problem is input, reading the output, or both. Accessibility
fixes are treated as bugs, not feature requests.
