# KitsuneSnipe 🦊🎯

A lightning-fast, interactive CLI streaming engine built in TypeScript and Bun. KitsuneSnipe bypasses aggressive frontend anti-debugging traps, extracts raw `.m3u8` video streams, and pipes them directly into `mpv` for a seamless, ad-free viewing experience straight from your terminal.

Currently supports:
- **cineby.sc** - Movie and TV show streaming (Default)
- **vidking.net** - Alternative streaming source

## ✨ Core Features
- **Interactive Playback Loop:** A native REPL prompts you for the `[n]ext episode` or `next [s]eason` immediately after a video finishes, continuing playback without needing to restart the CLI.
- **Smart Caching (`stream_cache.json`):** Saves extracted CDN tokens with a 1-hour TTL. Re-watching or resuming an episode launches instantly in milliseconds without spinning up the Playwright scraper.
- **Dynamic Title Scraping:** Intercepts the webpage's `<title>`, scrubs away SEO garbage and symbols (e.g., ` / Bloodhounds`), and injects the clean show name directly into the MPV window.
- **Subtitle Snatching:** Actively listens for late-firing `.vtt` and `.srt` API calls and pipes them directly to MPV.
- **DOM Trap Neutralization:** Blocks `window.close()` and intercepts `beforeunload` events to neutralize hostile `about:blank` redirects from streaming providers.
- **Graceful Shutdowns:** Fully supports asynchronous `Ctrl+C` (SIGINT) process termination at any point during scraping or idle prompts.

## 🚀 Prerequisites

1. **[Bun](https://bun.sh/)**: Fast all-in-one JS runtime.
2. **[mpv](https://mpv.io/)**: Open-source media player.
   - *Ubuntu/Debian:* `sudo apt install mpv`
   - *Arch Linux:* `sudo pacman -S mpv`
   - *macOS:* `brew install mpv`

## 📦 Installation

```bash
git clone [https://github.com/kitsunekode/kitsunesnipe.git](https://github.com/kitsunekode/kitsunesnipe.git)
cd kitsunesnipe
bun install
bunx playwright install chromium

💻 Usage

KitsuneSnipe uses standard CLI flags to target specific media. You must provide a TMDB ID.

Basic Usage (Defaults to Season 1, Episode 1 on Cineby):
Bash

bun run index.ts --id 127529

Advanced Targeting:
Bash

bun run index.ts --id 127529 --season 2 --episode 4 --provider vidking

The Interactive Menu

Once the mpv window closes, the terminal will drop you into an interactive prompt:
Plaintext

Options: [n]ext episode | [p]revious episode | [s]ext season | [q]uit
What next? 

Simply type n and hit enter, and it will automatically increment the episode counter, check the cache, and fire up the next video.
🛠️ Project Architecture

This repository currently serves as the core engine and extraction logic.

    logs.txt: Automatically records all intercepted network requests, headers, and endpoints for reverse-engineering purposes.

    stream_cache.json: The local SQLite-alternative JSON cache that manages session TTLs.

⚠️ Disclaimer

This tool is built strictly for educational and research purposes. It is designed to demonstrate network interception, API reverse-engineering, state management, and the bypassing of frontend obfuscation techniques. The author does not host, provide, or condone the piracy of copyrighted media.

## 🔮 Next Steps

The current engine is ready for TMDB API integration. Future work will allow users to search for shows via TMDB:
```
bun run index.ts --search "The Boys"
```
The tool will fetch matching TMDB results, let the user select one, automatically extract the TMDB ID, and feed it into the existing extraction pipeline—eliminating the need to manually look up IDs.

> **Note:** For current extensive usage, prefer this interactive CLI setup over the previous reconnaissance-only tool.