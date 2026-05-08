# @kitsunekode/kunai

`@kitsunekode/kunai` is the published CLI package for Kunai.

Kunai is a terminal-first media tool that resolves provider streams and launches playback in `mpv`.

## Requirements

- `mpv` on your `PATH` (required)
- Kitty or Ghostty terminal for inline poster previews (optional)
- ImageMagick (`magick`) for broader poster format support in Kitty/Ghostty (optional)
- `ffmpeg` for download/offline queue support (optional)

Install core tools:

```bash
# Linux (Arch)
sudo pacman -S mpv ffmpeg imagemagick

# Linux (Debian/Ubuntu)
sudo apt install mpv ffmpeg imagemagick

# macOS (Homebrew)
brew install mpv ffmpeg imagemagick
```

Windows options:

- `winget` (recommended): install `mpv`, `ffmpeg`, and `ImageMagick`
- Chocolatey: `choco install mpv ffmpeg imagemagick`
- Scoop: `scoop install mpv ffmpeg imagemagick`

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
```

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
