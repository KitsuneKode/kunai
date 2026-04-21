# KitsuneSnipe 🦊🎯

A terminal-first Bun CLI for finding playable streams, capturing `.m3u8` URLs with Playwright, and launching them in `mpv`.

Supports movie, series, and anime flows through a unified Ink shell. No API keys required.

## ✨ Features

- **Ink shell UI** — command-aware terminal app flow instead of stacked prompts
- **Watch history** — remembers where you stopped, offers to resume or jump to next episode
- **Background pre-fetch** — next episode scrapes while you watch the current one; `[n]` is instant
- **Poster preview** — shows the TMDB poster inline (Kitty / Ghostty only, no extra tools needed)
- **Structured pickers** — search results, providers, subtitles, seasons, episodes, and settings stay inside the shell
- **Subtitle support** — wyzie subtitle API with in-shell subtitle track picking
- **Ad blocking** — 20+ ad/tracker domains blocked at the network level via Playwright `route()`
- **Headless by default** — runs the browser invisibly; use `--no-headless` if a provider blocks it
- **Auto-provider fallback** — if the primary provider fails, silently tries the other
- **1-hour stream cache** — re-watching or resuming skips the scraper entirely
- **npm/package ready** — build, pack, and global-link scripts for local and release workflows

## 🚀 Prerequisites

| Tool                     | Required | Notes                       |
| ------------------------ | -------- | --------------------------- |
| [Bun](https://bun.sh/)   | ✅       | Runtime and package manager |
| [mpv](https://mpv.io/)   | ✅       | Media player                |
| Kitty / Ghostty terminal | Optional | Poster image preview        |

Install mpv:

```bash
# Arch
sudo pacman -S mpv

# Debian/Ubuntu
sudo apt install mpv

# macOS
brew install mpv
```

## 📦 Installation

```bash
git clone https://github.com/kitsunekode/kitsunesnipe.git
cd kitsunesnipe
bun install
bunx playwright install chromium
bun run link:global
```

## 💻 Usage

### Fully interactive (recommended)

```bash
bun run index.ts
kitsune-snipe
```

You'll be guided through:

1. Search by title inside the Ink shell
2. Pick the exact result from an in-shell list
3. Choose provider, settings, subtitles, season, and episode from shell pickers
4. Launch playback in `mpv`
5. Return to the same shell for replay, provider changes, settings, and next actions

### Skip prompts with flags

All flags are optional — mix and match to pre-fill any step:

```bash
bun run index.ts -S "Breaking Bad"               # pre-fill search query
bun run index.ts -S "Inception" -t movie         # force movie type
bun run index.ts -i 1396 -s 3 -e 5              # jump to S3E5 by TMDB ID
bun run index.ts -S "The Boys" -l fzf            # pick subtitle interactively in shell
bun run index.ts -S "Breaking Bad" -l ar         # Arabic subtitles
bun run index.ts -S "Oppenheimer" -p cineby      # force Cineby
bun run index.ts -S "Breaking Bad" -H            # visible browser (debug)
```

### All flags

| Short | Long            | Description                                       |
| ----- | --------------- | ------------------------------------------------- |
| `-S`  | `--search`      | Pre-fill the search query                         |
| `-i`  | `--id`          | Use a known TMDB ID (skip search entirely)        |
| `-T`  | `--title`       | Override the display title shown in MPV           |
| `-t`  | `--type`        | `movie` or `series` (used with `--id`)            |
| `-s`  | `--season`      | Starting season                                   |
| `-e`  | `--episode`     | Starting episode                                  |
| `-p`  | `--provider`    | `vidking` (default) or `cineby`                   |
| `-l`  | `--sub-lang`    | `en`, `ar`, `fr`, `de`, `es`, `ja`, `fzf`, `none` |
| `-H`  | `--no-headless` | Force visible browser window                      |

## 🧭 Shell controls

The main flow stays inside the same shell:

- `/` opens command mode
- `c` opens settings
- `a` switches anime/series mode
- `o` opens provider selection from playback
- `n` / `p` / `s` handle episode navigation for series
- `q` cancels the current shell or exits where appropriate

## 📼 Watch History

History is stored at `~/.local/share/kitsunesnipe/history.json`, keyed by TMDB ID.

- **Unfinished episode** → prompted to resume from exact timestamp or restart
- **Finished episode** (>85% watched) → prompted to jump to next episode
- **No history** → starts from S1E1

## 🗂️ Project Structure

```text
index.ts                main entry and session loops
src/app-shell/*         Ink shell, command UI, settings/history/picker workflows
src/search.ts           db.videasy/TMDB-backed search
src/scraper.ts          Playwright stream + subtitle interception
src/mpv.ts              mpv launcher with Lua position IPC
src/history.ts          watch history persistence
src/image.ts            Kitty/Ghostty poster preview
src/subtitle.ts         wyzie subtitle API
src/tmdb.ts             season/episode metadata
src/session-flow.ts     start-episode and provider/session helpers
stream_cache.json       1-hour stream URL cache
logs.txt                scrape log
```

## 📦 Release workflow

```bash
bun run check
bun run build
bun run pkg:check
```

Useful local scripts:

```bash
bun run link:global
bun run unlink:global
bun run relink:global
```

## 🌐 Provider URL Patterns

| Provider | Type   | Pattern                                                                                               |
| -------- | ------ | ----------------------------------------------------------------------------------------------------- |
| VidKing  | Movie  | `https://www.vidking.net/embed/movie/{id}?autoPlay=true`                                              |
| VidKing  | Series | `https://www.vidking.net/embed/tv/{id}/{s}/{e}?autoPlay=true&episodeSelector=false&nextEpisode=false` |
| Cineby   | Movie  | `https://www.cineby.sc/movie/{id}?play=true`                                                          |
| Cineby   | Series | `https://www.cineby.sc/tv/{id}/{s}/{e}?play=true`                                                     |

## ⚠️ Disclaimer

Built for educational and research purposes — network interception, API reverse-engineering, and frontend bypass techniques. The author does not host, provide, or condone piracy of copyrighted media.
