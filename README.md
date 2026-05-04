# Kunai Beta 🥷

A terminal-first Bun CLI for finding playable streams, capturing `.m3u8` URLs with Playwright, and launching them in `mpv`.

Supports movie, series, and anime flows through a unified Ink shell. No API keys required.

Kunai is currently in beta: usable, but still actively being hardened across UI flow, provider support, subtitles, and diagnostics.

Kunai does not host, store, upload, mirror, or distribute any video files on its own servers. All playable media, manifests, subtitles, posters, and related assets are provided by non-affiliated third-party services and infrastructure.

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

| Tool                                       | Required | Notes                       |
| ------------------------------------------ | -------- | --------------------------- |
| [Bun](https://bun.sh/)                     | ✅       | Runtime and package manager |
| [mpv](https://mpv.io/)                     | ✅       | Media player                |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | ✅       | Extracts embed URLs         |
| Kitty / Ghostty terminal                   | Optional | Poster image preview        |

Install mpv and yt-dlp:

```bash
# Arch
sudo pacman -S mpv yt-dlp

# Debian/Ubuntu
sudo apt install mpv yt-dlp

# macOS
brew install mpv yt-dlp
```

## 📦 Installation

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bunx playwright install chromium
bun run link:global
```

## 💻 Usage

### Fully interactive (recommended)

```bash
bun run dev
kunai
```

You'll be guided through:

1. Search by title inside the Ink shell
2. Pick the exact result from an in-shell list
3. Choose provider, settings, subtitles, season, and episode from shell pickers
4. Launch playback in `mpv`
5. Return to the same shell for replay, provider changes, settings, and next actions

For a fuller product and scope overview, see [.docs/experience-overview.md](.docs/experience-overview.md).

### Flags and automation

All flags are optional. The **canonical** flag list (including `-m`, `-q`, `--jump`, mpv passthrough, and what is shell-only) is in [.docs/cli-reference.md](.docs/cli-reference.md) — use that file as the source for an MDX “Usage” section.

```bash
bun run dev -- -S "Breaking Bad"            # pre-fill search query
bun run dev -- -S "Dune" --jump 1          # auto-pick first search result
bun run dev -- -S "Dune" -q                # same as --jump 1 when using -S
bun run dev -- -m                          # minimal shell chrome this session
bun run dev -- -i 1396 -t series           # bootstrap TMDB series id
bun run dev -- -i 438631 -t movie          # bootstrap TMDB movie id
bun run dev -- -a                          # start in anime mode
bun run dev -- --debug                     # debug logging
```

**Note:** resume, history, season/episode, and default provider are chosen **inside the Ink shell** (not separate CLI flags today). Diagnostics export: `/ export-diagnostics` in the shell.

## 🧭 Shell controls

The main flow stays inside the same shell:

- `/` opens command mode
- `c` opens settings
- `a` switches anime/series mode
- `o` opens provider selection from playback
- `n` / `p` / `s` handle episode navigation for series
- `q` cancels the current shell or exits where appropriate

During **mpv** playback (persistent session, non-Windows), AniSkip-style segments show a bottom-right **skip chip** for ~3 seconds: with **Skip intros** (etc.) on, it counts down and **auto-skips** after 3s; with it off, the chip **auto-hides** while you can still press **`i`** or **click** the chip to skip. `N` / `P` in the player window request next/previous episode from the shell.

## 📼 Watch History

History is stored in the OS app data directory as `kunai-data.sqlite`.

- **Unfinished episode** → prompted to resume from exact timestamp or restart
- **Finished episode** (>85% watched) → prompted to jump to next episode
- **No history** → starts from S1E1

## 🗂️ Project Structure

```text
apps/cli/src/main.ts             canonical runtime entrypoint
apps/cli/index.ts                temporary compatibility wrapper into apps/cli/src/main.ts
apps/cli/src/app-shell/*         Ink shell, command UI, settings/history/picker workflows
apps/cli/src/search.ts           db.videasy/TMDB-backed search
apps/cli/src/scraper.ts          Playwright stream + subtitle interception
apps/cli/src/mpv.ts              mpv launcher with Lua position IPC
apps/cli/src/history.ts          watch history persistence
apps/cli/src/image.ts            Kitty/Ghostty poster preview
apps/cli/src/subtitle.ts         wyzie subtitle API
apps/cli/src/tmdb.ts             season/episode metadata
apps/cli/src/session-flow.ts     start-episode and provider/session helpers
apps/experiments/*               private provider research lab
apps/experiments/scratchpads/*   raw provider probes and reverse-engineering notes
kunai-cache.sqlite               local stream cache in the OS cache directory
logs.txt                         scrape log
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

Kunai is a client-side tool for research, automation, and playback handoff.

- This app does not store any video files on its server.
- This project does not host, store, upload, mirror, or distribute video content itself.
- All playable content, streams, manifests, subtitles, posters, metadata, and related assets are provided by non-affiliated third-party sites and infrastructure.
- Provider names, media titles, posters, metadata, and playback endpoints remain the property and responsibility of their respective owners and providers.
- If you believe specific content is infringing, copyright or DMCA-style notices should be directed to the actual hosting or serving provider, not this repository.
- The project maintainers are not the content host and do not control the third-party media servers that upstream providers expose.

Use the project responsibly and in accordance with the laws and terms that apply in your jurisdiction.
