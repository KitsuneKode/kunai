# Kunai

Terminal-first playback for anime, series, and movies.

Kunai is a fullscreen keyboard-native media shell. Search a title, pick the season or source you want, hand playback to `mpv`, then return to the same shell for next episode, replay, provider fallback, diagnostics, history, or a fresh search.

## What It Is

- Fast search and browse from a calm terminal UI
- Provider, season, episode, source, quality, subtitle, and audio-mode pickers
- `mpv` playback with shell-owned resume and post-playback controls
- Local watch history and resume state backed by SQLite
- Recovery paths for provider drift: retry, source switch, fallback provider, diagnostics export

## 30-Second Start

```bash
npm install -g @kitsunekode/kunai
kunai
```

Then search for a title and press Enter. Inside the shell, `/` opens commands from anywhere.

Common starts:

```bash
kunai -S "Dune"
kunai -a -S "Frieren" --jump 1
kunai --continue
kunai --history
kunai --offline
kunai --zen --offline
kunai --discover
kunai --calendar
kunai --random
kunai --debug
kunai --setup
```

User guides:

- [Getting started](docs/users/getting-started.md)
- [Feature tour](docs/users/feature-tour.md)
- [Playback and recovery](docs/users/playback-and-recovery.md)
- [Downloads and offline](docs/users/downloads-and-offline.md)
- [Diagnostics and reporting](docs/users/diagnostics-and-reporting.md)
- [Install and update](docs/users/install-and-update.md)

## Shell Model

Kunai is designed to stay anchored in one terminal session:

```text
search title
  -> choose result
  -> pick season / episode / source when needed
  -> watch in mpv
  -> return for next, replay, provider, diagnostics, history, or search
```

Core controls:

- `/`: command palette
- `Enter`: open/search/confirm the current task
- `Esc`: close, clear, or go back
- `?`: help
- `q`: quit/stop flow

The command palette is context-aware. Browse prioritizes filters, discover, random,
calendar, offline, downloads, history, and details. Playback prioritizes recover,
fallback, stream/source/quality, episode, download, next, and previous actions.

## What You Need

### Required

- Bun `>=1.3.9`
- `mpv` on your `PATH` (required for playback)

### Optional (recommended)

- `yt-dlp` for the offline download queue (required on `PATH` when downloads are enabled in `/setup`)
- `ffprobe` on your `PATH` if you want optional validation of completed downloads after `yt-dlp` finishes (not the downloader)
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

## Install And Run

### npm

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

### Launch commands

```bash
kunai
kunai -a
kunai -S "Dune"
kunai -S "Dune" --jump 1
kunai -S "Breaking Bad"
kunai --continue
kunai --history
kunai -i 438631 -t movie
kunai --debug
kunai --setup
kunai --download -S "Dune"
kunai --download -S "Dune" --download-path ~/Videos/Kunai
kunai --offline
kunai --zen --offline
kunai --discover
kunai --calendar
kunai --random
kunai --random -a
```

In the shell, use `/download` to enqueue the selected/current item, `/downloads` to inspect,
retry, abort, or delete jobs, and `/library` or `/offline` for completed local files.
Use `/discover` for recommendations, `/calendar` for releases airing today, and `/random`
or `/surprise` to spin a small non-autoplaying surprise tray.

### Default download path (when enabled)

- Linux: `~/.local/share/kunai/downloads` (or `XDG_DATA_HOME/kunai/downloads`)
- macOS: `~/Library/Application Support/kunai/downloads`
- Windows: `%LOCALAPPDATA%\kunai\downloads`

## Recommendations

- Run `/discover` to open recommendation + trending sections
- Run `/random` or `/surprise` to mix recommendations with a cached randomized catalog pool
- Run `/calendar` to see releases airing today; provider availability is checked only after selection
- Run `/filters` in browse to add guided query chips without memorizing syntax
- Press `Ctrl+T` in browse mode to reload trending recommendation lists
- Recommendation lists use cached catalog responses for deterministic UX

## Provider Reality

- Active runtime providers are `rivestream`, `vidking`, `allanime`, and `miruro`
- Legacy Playwright provider code is archived under `archive/legacy/**` as reference-only material
- Experimental provider research lives in `apps/experiments/scratchpads/**` and does not ship as runtime behavior

## Playback Controls

- `n` / `p`: next/previous episode
- `k`: source/quality picker
- `o`: provider picker
- `b`: skip active intro/recap/credit segment
- `r`: reload/recover current stream
- `f`: fallback provider
- `/streams`, `/source`, and `/quality`: switch among already resolved stream choices
- mpv subtitle menu: switch among attached subtitle tracks when the provider/subtitle lookup exposed them
- `Ctrl+R` (inside `mpv`): manual resume prompt when history exists

## Diagnostics And Issue Reports

- Run with `--debug` for verbose traces
- Use `/ export-diagnostics` to generate a redacted local JSON snapshot
- Use `/ report-issue` to open issue triage guidance
- Open Diagnostics/About panels to confirm startup capabilities (`mpv`, `yt-dlp`, `ffprobe`, `chafa`, image renderer)
- Useful smoke tests from source: `bun run dev -- -S "Dune"`, `bun run dev -- -S "Attack on Titan" -a`, `bun run dev -- -S "Dune" --debug`, and `bun run dev -- --discover`

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
- Release calendar artwork, surprise picks, and offline/download command routes are integrated
- Optional capability guardrails cover `mpv`, `yt-dlp`, `ffprobe`, `chafa`, and image renderer/terminal support

### Remaining improvements (non-blocking)

- Continue live autoplay/provider drift validation on real sessions
- Expand architecture guardrails against regressions into archive/experiments imports
- Keep package boundaries strict without premature large extraction

## Recommended Execution Passes

1. **Publish hygiene pass**: metadata, README, package tarball, release dry-run
2. **Boundary hardening pass**: enforce import fences and app-shell/service boundaries
3. **Live reliability pass**: validate autoplay/provider drift handling on real sessions
4. **Download/offline pass**: continue batch and daemon polish beyond the current queue/library/setup flow
5. **Release pass**: final checks, changelog, publish

## Demos (VHS)

For contributor-friendly shell walkthroughs:

```bash
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:help
bun run --cwd apps/cli test:vhs:onboarding
bun run --cwd apps/cli test:vhs:discover
bun run --cwd apps/cli test:vhs:offline
bun run --cwd apps/cli test:vhs:diagnostics
bun run --cwd apps/cli test:vhs:launch
bun run --cwd apps/cli test:vhs:all
```

These are demos and visual regression references, not a replacement for unit/integration/live verification.
See the [Feature tour](docs/users/feature-tour.md) for the demo storyboard and website-ready content map.

## Appreciation And Inspiration

Kunai stands on the shoulders of terminal-first and streaming UX inspirations:

- `ani-cli` for proving fast, shell-native playback can be joyful
- App-grade browsing UX patterns that keep search, details, episodes, and playback connected

The goal is not to clone those tools, but to bring that same daily-driver confidence into a deterministic CLI workflow.

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or distribute video content. Streams and related assets are served by non-affiliated third-party providers. Use responsibly and in accordance with applicable laws and service terms.
