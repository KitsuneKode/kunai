# Kunai

**Terminal-native media shell.** Search any title, pick your source, watch in `mpv`,
download for offline. All from one fullscreen keyboard-driven terminal session.

```bash
npm install -g @kitsunekode/kunai
kunai -S "Dune"
```

---

## Quick Start

### Install

```bash
# npm (recommended)
npm install -g @kitsunekode/kunai

# Or from source
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bun run link:global
```

### One search, that's it

```bash
# Interactive shell
kunai

# Search directly
kunai -S "Dune"
kunai -a -S "Frieren"
```

Once inside the shell, `/` opens the command palette from anywhere.

### What you need up front

| Tool            | Required? | Why                                                                |
| --------------- | --------- | ------------------------------------------------------------------ |
| **mpv**         | Required  | Plays everything. `sudo pacman -S mpv` / `brew install mpv`        |
| **yt-dlp**      | Optional  | Offline downloads. `sudo pacman -S yt-dlp` / `brew install yt-dlp` |
| **chafa**       | Optional  | Poster previews in non-Kitty terminals. `sudo pacman -S chafa`     |
| **ImageMagick** | Optional  | Broader poster format support. `sudo pacman -S imagemagick`        |
| **ffprobe**     | Optional  | Post-download integrity checks. Ships with `ffmpeg`                |
| **ffmpeg**      | Optional  | Local thumbnail generation for downloads                           |
| **Discord**     | Optional  | Rich Presence (watching status on profile)                         |

If mpv is missing, Kunai won't start playback. Everything else is optional and
detected automatically — the setup wizard (`/setup` or `kunai --setup`) walks
through each capability and what it enables.

### All-in-one install by platform

```bash
# Arch Linux
sudo pacman -S mpv yt-dlp chafa imagemagick ffmpeg

# Debian/Ubuntu
sudo apt install mpv yt-dlp chafa imagemagick ffmpeg

# macOS (Homebrew)
brew install mpv yt-dlp chafa imagemagick ffmpeg

# Windows (winget)
winget install mpv yt-dlp hpjansson.Chafa ImageMagick.ImageMagick
```

---

## Usage

### Launch commands

```bash
# Interactive: search, browse, discover
kunai

# Direct search
kunai -S "Dune"
kunai -S "Cowboy Bebop" --jump 1

# Anime mode
kunai -a -S "Attack on Titan"

# Resume where you left off
kunai --continue
kunai --history

# Discover and calendar
kunai --discover
kunai --calendar
kunai --random

# Offline and downloads
kunai --offline
kunai --download -S "Dune"
kunai --download -S "Dune" --download-path ~/Videos/Kunai

# Minimal chrome (zen mode)
kunai --zen --offline

# Setup wizard
kunai --setup
```

### Inside the shell

Once you're in, every screen has a context-sensitive footer showing available keys.
The most important ones:

```text
/                 Command palette (from anywhere)
Enter             Search, open, confirm
Esc               Close, clear, go back
↑↓                Navigate results, episodes, options
Tab               Switch between anime/series mode
Ctrl+T            Reload trending recommendations
Ctrl+D            Download selected result (from browse)
```

---

## Key Bindings

### During search / browse

| Key           | Action                                                           |
| ------------- | ---------------------------------------------------------------- |
| `/`           | Open command palette                                             |
| `Enter`       | Open selected result                                             |
| `Esc`         | Clear query / go back                                            |
| `↑↓`          | Navigate results                                                 |
| `Tab`         | Toggle anime/series mode                                         |
| `Ctrl+T`      | Reload trending                                                  |
| `Ctrl+D`      | Download selected result                                         |
| `^D`          | Download selected result                                         |
| Type a filter | Narrow provider, season, subtitle, history, and settings pickers |

### During playback

| Key      | Action                                     |
| -------- | ------------------------------------------ |
| `q`      | Stop playback, return to controls          |
| `n`      | Next episode                               |
| `p`      | Previous episode                           |
| `r`      | Recover current stream / replay            |
| `f`      | Try next compatible provider               |
| `d`      | Queue download of current episode          |
| `k`      | Source / quality picker                    |
| `o`      | Switch provider                            |
| `e`      | Episode picker                             |
| `s`      | Reload / switch subtitles                  |
| `b`      | Skip intro, recap, or credits              |
| `a`      | Toggle autoplay on/off                     |
| `u`      | Toggle autoskip on/off                     |
| `x`      | Stop after current episode                 |
| `Ctrl+R` | Manual resume prompt (when history exists) |

### Command palette (`/`)

| Command        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| `/search`      | Start a new search                                   |
| `/library`     | Browse offline titles, manage queue, toggle settings |
| `/download`    | Queue the current episode for download               |
| `/queue`       | View active, queued, failed downloads                |
| `/discover`    | Personalized recommendations + trending              |
| `/calendar`    | Releases airing today                                |
| `/random`      | Surprise pick without autoplay                       |
| `/setup`       | Run the setup wizard                                 |
| `/settings`    | Configure provider, language, downloads, Discord     |
| `/history`     | Watch history and resume                             |
| `/diagnostics` | Runtime snapshot and recent events                   |
| `/presence`    | Discord Rich Presence setup                          |

---

## Features

### Search and discover

- **Search** any title by name. Anime and series modes use different provider sets.
- **Discover** personalized recommendations and trending titles.
- **Release calendar** shows what's airing today (provider resolution happens after selection).
- **Random / Surprise** spins a non-autoplaying tray of cached recommendations.

### Playback

- Streams are resolved from direct-provider sources and handed to `mpv`.
- **Recover** (`r`) refreshes the current stream and resumes from last position.
- **Fallback** (`f`) tries the next compatible provider when the current one fails.
- **Source / quality picker** switches among already-resolved stream options.
- **Autoplay** automatically advances to the next episode in a series chain.
- **Autoskip** skips intros, recaps, previews, and credits (powered by IntroDB/AniSkip when available).
- **Episode picker** jump to any episode in the current season.
- **Subtitle management** picks preferred language first; alternate tracks available in mpv.

### Offline downloads

- Queue downloads from any search result (`^D`) or during playback (`d`).
- Movies skip the episode picker — one key queues the download.
- Download queue persists across sessions (backed by SQLite).
- On restart, interrupted downloads are automatically resumed or retried.
- Optional post-download integrity checks (`ffprobe`) and thumbnail generation (`ffmpeg`).
- Default download paths:
  - Linux: `~/.local/share/kunai/downloads`
  - macOS: `~/Library/Application Support/kunai/downloads`
  - Windows: `%LOCALAPPDATA%\kunai\downloads`

### Offline library

All completed downloads are grouped by title in the library panel (`/library`):

| Key       | Action                                                    |
| --------- | --------------------------------------------------------- |
| `↑↓`      | Navigate titles                                           |
| `Enter`   | Open episode browser (play, delete, protect, re-download) |
| `x`       | Delete title and all local files (with confirmation)      |
| `p`       | Toggle cleanup protection                                 |
| `1` / `2` | Switch between Library and Queue tabs                     |

### Discord Rich Presence

Enable via `/presence` or `/settings`. Shows what you're watching on your Discord profile:

- **Watching Kunai** — Attack on Titan · Season 1, Episode 5 · provider
- Browsing state when searching between episodes
- Private mode option hides title details

### Watch history

- Every playback session is recorded with position, progress, and completion status.
- Resume from where you left off with `kunai --continue` or `/history`.
- Individual entries can be removed, or the full history cleared.

### Diagnostics and recovery

- `/diagnostics` shows current runtime state, recent events, and capability status.
- `kunai --debug` for verbose traces during troubleshooting.
- `/export-diagnostics` generates a redacted JSON snapshot for issue reports.
- `/report-issue` opens GitHub issue triage guidance.

---

## Dependencies — In Detail

### Required

| Dependency        | Purpose        | Install                                     |
| ----------------- | -------------- | ------------------------------------------- |
| **Bun** `>=1.3.9` | Runtime        | `curl -fsSL https://bun.sh/install \| bash` |
| **mpv**           | Video playback | `sudo pacman -S mpv` / `brew install mpv`   |

### Optional — what each enables

| Tool                | What it gives you                                                                                | Without it                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **yt-dlp**          | Download queue. Required for `/download`, `/library`, `^D`.                                      | Download features are hidden. Everything else works. |
| **ffprobe**         | Post-download integrity check. Verifies the file is playable.                                    | Downloads still work; integrity check is skipped.    |
| **ffmpeg**          | Local thumbnail sidecar for downloaded videos. Shows artwork in offline library.                 | Offline library still works; no thumbnail previews.  |
| **chafa**           | Poster previews in terminals that don't support Kitty protocol (Sixel/WezTerm/Windows Terminal). | No poster previews in those terminals.               |
| **ImageMagick**     | Broader Kitty poster format support (non-PNG).                                                   | Posters work but may fail on unusual formats.        |
| **Discord desktop** | Rich Presence — shows "Watching Kunai" on your Discord profile.                                  | No Discord integration.                              |
| **Kitty / Ghostty** | Native poster protocol. Best-quality image rendering.                                            | Falls back to chafa or none.                         |

### Poster previews by terminal

| Terminal               | Protocol          | How                                    |
| ---------------------- | ----------------- | -------------------------------------- |
| Kitty                  | Native            | Best quality, no extra tools           |
| Ghostty                | Kitty-compatible  | Same as Kitty                          |
| WezTerm                | Sixel via chafa   | Install `chafa`                        |
| Windows Terminal 1.22+ | Sixel via chafa   | Install `chafa`                        |
| Everything else        | Symbols via chafa | Install `chafa` for text-based preview |
| Non-TTY / unsupported  | None              | No posters                             |

Environment overrides:

```bash
KUNAI_POSTER=0                          # Disable posters
KUNAI_IMAGE_PROTOCOL=kitty              # Force protocol
KUNAI_IMAGE_SIZE=30x18                  # Custom dimensions
KUNAI_IMAGE_DEBUG=1                     # Verbose poster logging
```

---

## Configuration

### Setup wizard

Run `/setup` or `kunai --setup` for a guided walkthrough:

1. Dependency guide (mpv, yt-dlp, chafa, ImageMagick, ffprobe)
2. Poster preview check
3. Enable/disable downloads
4. Choose download location
5. Review and finish

### Settings panel

`/settings` or `kunai` then `/settings` — all configurable from inside the shell:

- Default provider (anime and series)
- Language profiles (audio, subtitle per content type)
- Download preferences (enable, auto-download mode, cleanup policy, path)
- Discord Presence (provider, privacy, client ID)
- Skip behavior (recap, intro, preview, credits)
- Display preferences (posters, memory usage, footer hints)

### Config file

`~/.config/kunai/config.json` — human-readable JSON. Editable directly, but the
setup wizard and settings panel are the recommended interface.

---

## Provider Reality

Active providers:

- **rivestream**, **vidking** — series and movies
- **allanime**, **miruro** — anime

Providers are third-party integrations. Availability varies by title, region,
subtitle track, and source mirror. Some streams are hard-sub only or expose
incomplete subtitle metadata. Recovery paths are intentional: retry, source
switch, provider fallback, diagnostics export.

Legacy Playwright provider code is archived under `archive/legacy/` as reference.
Experimental provider research lives in `apps/experiments/scratchpads/` and does
not ship as runtime behavior.

---

## Architecture (for contributors)

```text
apps/cli/src/main.ts        Runtime entrypoint
apps/cli/src/app-shell/     Terminal UI (Ink components, overlays, pickers)
apps/cli/src/app/           App phases, session lifecycle, playback orchestration
apps/cli/src/services/      Download, offline library, presence, config, diagnostics
apps/cli/src/infra/         Player, IPC, filesystem, runtime mechanics
packages/storage/           SQLite repositories and migrations
packages/providers/         Provider adapter modules
```

Full architecture docs: [.docs/architecture.md](.docs/architecture.md)

---

## Development

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install

# Run from source
bun run dev
bun run dev -- -S "Dune"

# Link globally
bun run link:global

# Tests
bun run typecheck
bun run lint
bun run fmt
bun run test

# Smoke tests
bun run dev -- -S "Dune"
bun run dev -- -S "Attack on Titan" -a
bun run dev -- --discover
bun run dev -- --calendar
bun run dev -- --offline
```

### VHS demos

```bash
bun run --cwd apps/cli test:vhs:browse
bun run --cwd apps/cli test:vhs:offline
bun run --cwd apps/cli test:vhs:all
```

---

## Appreciation

Kunai stands on the shoulders of terminal-first and streaming UX inspirations:

- **ani-cli** for proving fast, shell-native playback can be joyful
- App-grade browsing UX patterns that keep search, details, episodes, and playback connected
- The `discord-rpc` and `yt-dlp` ecosystems that make Rich Presence and offline downloads possible

The goal is not to clone those tools, but to bring that same daily-driver confidence
into a deterministic CLI workflow.

---

## Disclaimer

Kunai is a client-side playback tool. It does not host, upload, mirror, seed, or
distribute video content. Streams and related assets are served by non-affiliated
third-party providers. Use responsibly and in accordance with applicable laws and
service terms.
