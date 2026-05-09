# Kunai

Terminal-first streaming for anime, series, and movies.

Kunai lets you browse in a fullscreen TUI, resolve provider streams, and hand playback to `mpv` while keeping session context in the shell.

## What It Is

- Search and browse from a keyboard-native shell UI
- Pick provider, season, episode, source, quality, subtitle, and audio mode
- Launch and control playback in `mpv`
- Keep local watch history and resume state (SQLite-backed)
- Use fallback/recovery and diagnostics when providers drift

## What You Need

### Required

- Bun `>=1.3.9`
- `mpv` on your `PATH` (required for playback)

### Optional (recommended)

- `ffmpeg` for downloads/offline queue
- `chafa` for poster previews (Sixel/ANSI fallback in non-Kitty terminals)
- ImageMagick (`magick`) for broader Kitty poster compatibility (non-PNG)
- Kitty/Ghostty for native Kitty poster previews
- Discord desktop app + local IPC support for Rich Presence (`node` is required when Presence is enabled)

### Poster previews

Kunai renders posters when the terminal and runtime support it:

- Kitty: native Kitty graphics protocol
- Ghostty: Kitty-compatible protocol
- Windows Terminal 1.22+: Sixel via `chafa`
- WezTerm: Sixel via `chafa`
- Other terminals: `chafa` symbols fallback
- Non-TTY/unsupported: no poster preview

Environment overrides:

- `KUNAI_POSTER=0`
- `KUNAI_IMAGE_PROTOCOL=auto|kitty|sixel|symbols|none`
- `KUNAI_IMAGE_SIZE=30x18`
- `KUNAI_IMAGE_DEBUG=1`
- `KUNAI_IMAGE_MAGICK_TIMEOUT_MS=30000`

Details, code map, and how to test: [.docs/poster-image-rendering.md](.docs/poster-image-rendering.md).

### Install core tools by platform

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

## Install And Run

### Quick install (npm)

```bash
npm install -g @kitsunekode/kunai
kunai
```

### From source

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bun run link:global
kunai
```

### Common launch commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -S "Breaking Bad"
kunai -i 438631 -t movie
kunai --debug
kunai --setup
kunai --download -S "Dune"
kunai --download -S "Dune" --download-path ~/Videos/Kunai
kunai --offline
```

In the shell, use `/download` to enqueue the selected/current item, `/downloads` to inspect,
retry, abort, or delete jobs, and `/library` or `/offline` for completed local files.

### Default download path (when enabled)

- Linux: `~/.local/share/kunai/downloads` (or `XDG_DATA_HOME/kunai/downloads`)
- macOS: `~/Library/Application Support/kunai/downloads`
- Windows: `%LOCALAPPDATA%\kunai\downloads`

## Core Flow

```text
kunai
  -> search title
  -> pick season/episode
  -> resolve provider stream
  -> watch in mpv
  -> return to shell for next/replay/provider/diagnostics/history
```

## Recommendations

- Run `/ recommendation` to open recommendation + trending sections
- Press `Ctrl+T` in browse mode to reload trending recommendation lists
- Recommendation lists use cached catalog responses for deterministic UX

## Provider Reality

- Active runtime providers are `rivestream`, `vidking`, `allanime`, and `miruro`
- Legacy Playwright provider code is archived under `archive/legacy/**` as reference-only material
- Experimental provider research lives in `apps/experiments/scratchpads/**` and does not ship as runtime behavior

## Controls

### Global shell

- `/`: command palette
- `Esc`: close/back
- `?`: help
- `q`: quit/stop flow

### Playback flow

- `n` / `p`: next/previous episode
- `k`: source/quality picker
- `o`: provider picker
- `b`: skip active intro/recap/credit segment
- `r`: reload/recover current stream
- `f`: fallback provider
- `Ctrl+R` (inside `mpv`): manual resume prompt when history exists

## Diagnostics And Issue Reports

- Run with `--debug` for verbose traces
- Use `/ export-diagnostics` to generate a redacted local JSON snapshot
- Use `/ report-issue` to open issue triage guidance
- Open Diagnostics/About panels to confirm startup capabilities (`mpv`, `ffmpeg`, `chafa`, image renderer)

## Provider Caveats

- Providers are third-party integrations and may drift
- Availability can vary by title, region, subtitle track, or source mirror
- Some streams are hard-sub only or expose incomplete subtitle metadata
- Recovery paths are intentional: retry, source switch, provider fallback, diagnostics export

## Architecture At A Glance

```text
apps/cli/src/main.ts      -> canonical runtime entrypoint
apps/cli/index.ts         -> compatibility wrapper only
apps/cli/src/app-shell/*  -> shell UI
apps/cli/src/app/*        -> app policy/session phases
apps/cli/src/services/*   -> orchestration services
apps/cli/src/infra/*      -> player/ipc/filesystem/runtime mechanics
```

## Current Release Status

### Stable now

- Typecheck, lint, tests, package checks, and release dry-run are green
- Canonical runtime is `apps/cli/src/main.ts` with deterministic shell flow
- Watch history, diagnostics, provider fallback, and discover/recommendation are integrated
- Optional capability guardrails now cover `mpv`, `ffmpeg`, `chafa`, and image renderer/terminal support

### Remaining improvements (non-blocking)

- Continue live autoplay/provider drift validation on real sessions
- Expand architecture guardrails against regressions into archive/experiments imports
- Keep package boundaries strict without premature large extraction

## Recommended Execution Passes

1. **Publish hygiene pass**: metadata, README, package tarball, release dry-run
2. **Boundary hardening pass**: enforce import fences and app-shell/service boundaries
3. **Live reliability pass**: validate autoplay/provider drift handling on real sessions
4. **Download/offline pass**: move from feature gate to queue + library + setup wizard slices
5. **Release pass**: final checks, changelog, publish

## Demos (VHS)

For contributor-friendly shell walkthroughs:

```bash
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:help
bun run --cwd apps/cli test:vhs:launch
```

These are demos and visual regression references, not a replacement for unit/integration/live verification.

## Appreciation And Inspiration

Kunai stands on the shoulders of terminal-first and streaming UX inspirations:

- `ani-cli` for proving fast, shell-native playback can be joyful
- App-grade browsing UX patterns that keep search, details, episodes, and playback connected

The goal is not to clone those tools, but to bring that same daily-driver confidence into a deterministic CLI workflow.

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or distribute video content. Streams and related assets are served by non-affiliated third-party providers. Use responsibly and in accordance with applicable laws and service terms.
