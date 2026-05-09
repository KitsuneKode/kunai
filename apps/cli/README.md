# @kitsunekode/kunai

`@kitsunekode/kunai` is the published CLI package for Kunai.

Kunai is a terminal-first media tool that resolves provider streams and launches playback in `mpv`.

## Requirements

- `mpv` on your `PATH` (required)
- `ffmpeg` for download/offline queue support (optional)
- `chafa` for poster previews (Sixel/ANSI fallback in non-Kitty terminals)
- Kitty/Ghostty terminal for native Kitty poster previews (optional)
- ImageMagick (`magick`) for Kitty/Ghostty non-PNG poster conversion (optional)
- Discord desktop app for Rich Presence (optional; `node` is required when Presence is enabled)

Poster subsystem and testing: repo root [.docs/poster-image-rendering.md](../../.docs/poster-image-rendering.md).

Install core tools:

```bash
# Linux (Arch)
sudo pacman -S mpv ffmpeg chafa imagemagick

# Linux (Debian/Ubuntu)
sudo apt install mpv ffmpeg chafa imagemagick

# macOS (Homebrew)
brew install mpv ffmpeg chafa imagemagick
```

Windows options:

- `winget` (recommended): install `mpv`, `ffmpeg`, `chafa` (`winget install hpjansson.Chafa`), and ImageMagick (`winget install ImageMagick.ImageMagick`)
- Chocolatey: `choco install mpv ffmpeg chafa imagemagick`
- Scoop: `scoop install mpv ffmpeg chafa imagemagick`

## Install

```bash
npm install -g @kitsunekode/kunai
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

Default download path (when downloads are enabled):

- Linux: `~/.local/share/kunai/downloads` (or `XDG_DATA_HOME/kunai/downloads`)
- macOS: `~/Library/Application Support/kunai/downloads`
- Windows: `%LOCALAPPDATA%\kunai\downloads`

Recommendation shortcuts:

```bash
# inside Kunai command palette
/ recommendation
/ downloads
```

Download workflow shortcuts:

- During playback or post-playback, use `d` / `/download` to queue the current stream.
- Use `/downloads` to inspect active/failed/completed jobs and retry or cancel entries.

## Diagnostics

- Use `--debug` for verbose logs
- Use `/ export-diagnostics` inside Kunai for a redacted report snapshot

## Caveats

- Provider availability can drift over time
- Subtitle/source inventories vary by provider and title
- Kunai prioritizes deterministic recovery and diagnostics over opaque retries

## Project

- Repository: https://github.com/kitsunekode/kunai
- Issues: https://github.com/kitsunekode/kunai/issues
