# kunai-cli

`kunai-cli` is the published CLI package for Kunai.

Kunai is a terminal-first media tool that resolves provider streams and launches playback in `mpv`.

## Requirements

- `mpv` on your `PATH` (required)
- Playwright Chromium is not required for the current active beta provider set (optional for future browser-runtime providers)
- Kitty or Ghostty terminal for inline poster previews (optional)
- ImageMagick (`magick`) for broader poster format support in Kitty/Ghostty (optional)

```bash
bunx playwright install chromium
```

## Install

```bash
npm install -g kunai-cli
```

Run:

```bash
kunai
```

## Useful Commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -i 438631 -t movie
kunai --debug
kunai --setup
kunai --offline
```

Discover shortcuts:

```bash
# inside Kunai command palette
/ discover
```

## Diagnostics

- Use `--debug` for verbose logs
- Use `/ export-diagnostics` inside Kunai for a redacted report snapshot

## Beta Caveats

- Provider availability can drift over time
- Subtitle/source inventories vary by provider and title
- Kunai prioritizes deterministic recovery and diagnostics over opaque retries

## Project

- Repository: https://github.com/kitsunekode/kunai
- Issues: https://github.com/kitsunekode/kunai/issues
