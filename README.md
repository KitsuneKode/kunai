<div align="center">

# 🥷 Kunai

**Watch movies, series, and anime — without leaving your terminal.**

Search anything. Stream in mpv. Auto-skip intros. Resume where you left off.

[![License](https://img.shields.io/github/license/kitsunekode/kunai?style=flat-square&color=black)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-bun-f472b6?style=flat-square)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-555?style=flat-square)](#prerequisites)
[![Beta](https://img.shields.io/badge/status-beta-orange?style=flat-square)](#known-issues-beta)

</div>

---

Kunai is a terminal-first CLI that intercepts `.m3u8` streams from embed players using Playwright and hands them off to mpv — giving you a full watch experience in a persistent Ink shell, with no browser tabs, no accounts, and no bloat.

Movies, TV series, and anime. All in one place. All in your terminal.

> Kunai does not host, store, or distribute any video content. All streams are served by non-affiliated third-party providers.

---

## ✨ Features

### Core experience
- **Persistent Ink shell** — search, browse, pick, and play without leaving the terminal
- **Watch history** — remembers exactly where you stopped; offers to resume or jump to the next episode
- **Background pre-fetch** — next episode is scraped while you watch; pressing `n` is instant
- **1-hour stream cache** — resuming or rewatching skips the scraper entirely
- **Poster preview** — TMDB poster rendered inline (Kitty / Ghostty terminals, no extra tools)

### Playback
- **mpv integration** — hands streams off to mpv with a persistent IPC bridge
- **Source + quality switching** — `o` / `k` mid-playback to change stream source or quality
- **Subtitle support** — Wyzie subtitle API with in-shell track picker and late attach
- **Auto-provider fallback** — silently tries the next provider when one fails

### Anime
- **Auto-skip intro/credits** — AniSkip chip with 3-second countdown, press `b` to override
- **Anime mode** — `a` to toggle; dedicated provider registry for anime flows
- **Dub/sub support** — in-shell language picker per title

### Developer-friendly
- **Ad blocking** — 20+ ad/tracker domains blocked at the network level via `playwright.route()`
- **Headless by default** — `--no-headless` if a provider needs it
- **Built-in diagnostics** — `/ export-diagnostics` + `/ report-issue` from the shell
- **Debug logging** — `--debug` flag for full scrape trace
- **Structured test tree** — unit, integration, live provider checks, and VHS tapes

---

## Prerequisites

| Tool | Required | Notes |
|------|----------|-------|
| [Bun](https://bun.sh) | ✅ | Runtime and package manager |
| [mpv](https://mpv.io) | ✅ | Media player |
| Playwright Chromium | Optional | Required for browser/embed providers |
| Kitty or Ghostty | Optional | Poster image preview |

Install mpv:

```bash
# Arch
sudo pacman -S mpv

# Debian / Ubuntu
sudo apt install mpv

# macOS
brew install mpv
```

---

## Quick Start

```bash
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
bunx playwright install chromium
bun run link:global
```

Then launch:

```bash
kunai
# or
bun run dev
```

You'll land in the persistent shell. Search for anything, pick a result, choose a provider, and stream.

---

## Usage

### Interactive (recommended)

```bash
kunai
```

The shell guides you through search → result → provider → season/episode → playback, all without leaving the terminal.

### CLI flags

```bash
kunai -S "Breaking Bad"           # pre-fill the search query
kunai -S "Dune" -q                # search + auto-pick first result
kunai -S "Dune" --jump 1          # same as -q
kunai -a                          # start in anime mode
kunai -m                          # minimal shell chrome
kunai -i 1396 -t series           # bootstrap with a TMDB series ID
kunai -i 438631 -t movie          # bootstrap with a TMDB movie ID
kunai --debug                     # debug logging
```

> Season, episode, subtitles, history, and resume are all handled **inside the shell**, not via flags.

---

## Shell Controls

### Browse / playback shell

| Key | Action |
|-----|--------|
| `/` | Open command mode |
| `c` | Settings |
| `a` | Toggle anime / series mode |
| `n` / `p` | Next / previous episode |
| `o` | Source picker (mid-playback) |
| `k` | Quality picker (mid-playback) |
| `s` | Reload subtitles |
| `b` | Skip active intro/credits segment |
| `r` | Refresh stream |
| `f` | Fallback to next provider |
| `q` | Cancel / exit |

### mpv bridge (inside mpv window)

| Key | Action |
|-----|--------|
| `N` / `P` | Request next / previous episode from shell |
| `K` | Open quality picker |
| `B` | Skip active segment when chip is visible |

### AniSkip chip

During anime playback a **skip chip** appears in the bottom-right corner at intro/credits segments. With **Skip intros** on, it auto-skips after a 3-second countdown. With it off, the chip auto-hides — press `b` to skip manually anytime.

---

## Watch History

History lives in `kunai-data.sqlite` (OS app data dir).

| Situation | Behaviour |
|-----------|-----------|
| Unfinished episode | Offer to resume from exact timestamp or restart |
| Finished episode (>85% watched) | Offer to jump to next episode |
| No history | Start from S1E1 |

---

## Roadmap

### Now (beta hardening)

- [x] Persistent Ink shell with fullscreen viewport
- [x] Watch history with SQLite backend
- [x] Background pre-fetch for instant next episode
- [x] AniSkip intro/credits chip with auto-skip
- [x] Source + quality switching mid-playback
- [x] Wyzie subtitle API with in-shell picker
- [x] Built-in diagnostics export + issue report command
- [x] Stream cache (1-hour TTL, SQLite)
- [x] Playwright ad blocking (20+ domains)
- [ ] Improve macOS / Windows parity and publish OS-specific caveats
- [ ] Clearer first-run guidance for Playwright-backed providers
- [ ] Broader smoke automation for source/quality and diagnostics flows

### Next (open-source usability)

- [ ] Compatibility matrix for terminals, OS, and player runtimes
- [ ] Release notes template and changelog discipline per beta cut
- [ ] Contributor onboarding docs for provider debugging and test fixtures

### Later (V2 / V3)

- [ ] Debrid integration (Real-Debrid, AllDebrid)
- [ ] Web companion and desktop app
- [ ] Remote sync for watch history
- [ ] YouTube provider (yt-dlp + Invidious)
- [ ] More provider coverage and hardening

---

## Project Structure

```
apps/cli/src/main.ts            canonical runtime entrypoint
apps/cli/src/app-shell/         Ink shell, command bar, pickers, settings, history
apps/cli/src/search.ts          TMDB-backed search service
apps/cli/src/scraper.ts         Playwright stream + subtitle interception
apps/cli/src/mpv.ts             mpv launcher with Lua position IPC
apps/cli/src/history.ts         watch history persistence
apps/cli/src/subtitle.ts        Wyzie subtitle API
apps/cli/src/tmdb.ts            TMDB season/episode metadata
apps/cli/src/session-flow.ts    provider/session helpers
apps/experiments/               private provider research lab (not production)
```

---

## Known Issues (Beta)

- Some providers only expose one stream candidate — source/quality pickers may show a single option.
- Playwright Chromium is required for browser-backed providers; startup warns and degrades gracefully without it.
- macOS / Windows behavior can differ from Linux on provider reliability and terminal rendering. Include your OS and terminal in bug reports.

If playback breaks: run `/ export-diagnostics` then `/ report-issue` from inside the shell.

---

## Contributing

Contributions are welcome — especially provider fixes, test coverage, and platform parity work.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, PR expectations, and how to add changesets.

**Good first areas:**
- Reproduce and fix a known issue from the [issue tracker](https://github.com/kitsunekode/kunai/issues)
- Add test coverage for pure functions (formatters, URL builders, cache TTL logic)
- Improve macOS or Windows install / runtime documentation
- Fix a provider reporting breakage

---

## Disclaimer

Kunai is a client-side playback tool. It does not host, store, upload, mirror, or distribute video content. All streams, manifests, subtitles, posters, and metadata are served by non-affiliated third-party providers.

If you believe specific content is infringing, direct DMCA notices to the actual hosting provider, not this repository.

Use responsibly and in accordance with the laws and terms applicable in your jurisdiction.

---

## License

[MIT](LICENSE) — Manash Pratim Bhuyan (kitsunekode)

---

<div align="center">

Built with [Bun](https://bun.sh) · [Ink](https://github.com/vadimdemedes/ink) · [Playwright](https://playwright.dev) · [mpv](https://mpv.io)

</div>
