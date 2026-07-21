# @kitsunekode/kunai

`@kitsunekode/kunai` is the published CLI package for Kunai.

Kunai is a terminal-first media tool that resolves provider streams and launches playback in `mpv`.

## Requirements

- **Bun** `>=1.3.9` on your `PATH` (required for this npm channel — the package entry is `#!/usr/bin/env bun`)
- `mpv` on your `PATH` (required for playback)
- `yt-dlp` on your `PATH` when offline downloads are enabled (optional feature)
- `ffprobe` for optional verification of finished downloads only—not the downloader
- Built-in half-block poster fallback; optional `chafa` for richer previews in non-Kitty terminals
- Kitty/Ghostty terminal for native Kitty poster previews (optional)
- ImageMagick (`magick`) for Kitty/Ghostty non-PNG poster conversion (optional)
- Discord desktop app for Rich Presence (optional; local Unix-socket / Windows named-pipe IPC)

Native release binaries embed Bun and do **not** need a separate Bun install. Prefer
`install.sh` / `install.ps1` when you want zero Bun prerequisites. This npm page is
for the package-manager channel only.

Poster subsystem and testing: repo root [.docs/poster-image-rendering.md](../../.docs/poster-image-rendering.md).

Install core tools:

```bash
# Linux (Arch)
sudo pacman -S mpv yt-dlp chafa imagemagick

# Linux (Debian/Ubuntu)
sudo apt install mpv yt-dlp chafa imagemagick

# macOS (Homebrew)
brew install mpv yt-dlp chafa imagemagick
```

Windows options:

- `winget` (recommended): install `mpv`, `yt-dlp`, `chafa` (`winget install hpjansson.Chafa`), and ImageMagick (`winget install ImageMagick.ImageMagick`); add `ffprobe` separately if you want post-download validation
- Chocolatey: `choco install mpv yt-dlp chafa imagemagick`
- Scoop: `scoop install mpv yt-dlp chafa imagemagick`

## Install

```bash
npm install -g @kitsunekode/kunai
```

Postinstall writes ownership into `~/.config/kunai/install.json` (or the Windows
equivalent) so lifecycle commands know this is an npm-owned install.

Run:

```bash
kunai
kunai --setup
```

## Update and uninstall

Primary update path (channel-aware):

```bash
kunai upgrade
kunai upgrade --check
```

npm-native alternatives:

```bash
npm install -g @kitsunekode/kunai   # update
npm uninstall -g @kitsunekode/kunai # remove package
kunai uninstall                     # ownership-aware removal
kunai uninstall --purge             # also delete config/history/cache
```

If `kunai` is missing or shadowed after install, diagnose PATH and ownership:

```bash
kunai doctor
kunai doctor --json
command -v -a kunai   # Linux/macOS: list every kunai on PATH
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
kunai doctor
kunai upgrade
```

Default download path (when downloads are enabled):

- Linux: `~/.local/share/kunai/downloads` (or `XDG_DATA_HOME/kunai/downloads`)
- macOS: `~/Library/Application Support/kunai/downloads`
- Windows: `%LOCALAPPDATA%\kunai\downloads`

Recommendation shortcuts:

```bash
# inside Kunai command palette
/recommendation
/downloads
/library
/up-next
```

Download workflow shortcuts:

- From browse results, use `Ctrl+D` / `/download` to queue the selected result.
- During playback or post-playback, use `d` / `/download` to queue the current stream.
- Use `/downloads` to inspect active/failed/completed jobs and retry or cancel entries.

Playback recovery shortcuts:

- Use `r` / `/recover` to refresh the current stream and resume.
- Use `/recompute` when provider/source inventory looks stale and cached provider memory should be bypassed.
- Use `f` / `/fallback` to try the next compatible provider.
- Use `k` / `/tracks` to review source, quality, audio, hardsub, and subtitle options.

## Diagnostics

- Use `--debug` for verbose logs
- Use `--debug-json` to write scoped JSONL diagnostics traces
- Use `--debug-session` for a developer repro session with trace path and breakpoint guidance
- Use `/export-diagnostics` inside Kunai for a redacted report snapshot
- Use `/report-issue` to export a redacted bundle and open a prefilled GitHub issue draft
- Use `kunai doctor` when PATH or install ownership looks wrong

## Caveats

- Provider availability can drift over time
- Subtitle/source inventories vary by provider and title
- Kunai prioritizes deterministic recovery and diagnostics over opaque retries
- This npm channel requires Bun; native binaries do not

## Project

- Repository: https://github.com/kitsunekode/kunai
- Issues: https://github.com/kitsunekode/kunai/issues
