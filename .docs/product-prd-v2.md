# Kunai V1 Product Requirements Document (PRD) 🥷✨

This document serves as the absolute source of truth for the Kunai ecosystem, defined through exhaustive user grilling to ensure a $100M "Priceless" feel across the TUI and Web App.

## 1. Product Vision & Tone
Kunai is the elite, stealthy, and blazing-fast streaming ecosystem. It is the anti-thesis of ad-riddled, clunky iframe websites. 
- **The Tone:** Mechanical, sharp, and instantaneous. When a user presses a key, the action happens *before* they lift their finger.
- **The Rule of Rome:** "When in Rome, do as the Romans do." The TUI must feel natively terminal (keyboard-centric, dense). The Web App must feel natively web (mouse/touch-centric, fluid). They share DNA, but they do not clumsily clone each other.

---

## 2. Core Epics & Features

### A. The "Priceless" First-Run Onboarding
When a user runs `kunai` for the very first time, they do not get an ugly console error if `mpv` is missing.
1. **The Wizard:** A beautiful, full-screen setup wizard launches.
2. **Dependency Check:** It quietly checks for `bun`, `mpv`, and `yt-dlp`.
3. **The Fix:** If missing, it provides copy-paste, distro-specific commands (e.g., `brew install mpv yt-dlp` or `sudo pacman -S mpv yt-dlp`) and waits for the user to install them, or offers an automatic installation script for supported platforms.
4. **The Setup:** It asks them if they want to log into AniList or Real-Debrid, with an option to `[Skip]`.

### B. The Invisible Auto-Daemon (Bring Your Own Compute)
Non-technical users should never have to manually manage backend processes.
1. **The Trigger:** When a user runs `kunai` (TUI) or opens `kunai.app` (Web) locally, the system checks if the background daemon (`kunai serve`) is running on port 8080.
2. **The Auto-Start:** If it's not running, Bun spawns a detached background process instantly and invisibly. 
3. **The Role:** This daemon hosts the Playwright instances and executes the 0-RAM scrapers, serving as the local, unbannable API for both the TUI and the Web App.

### C. The Elite TUI Experience
1. **The Command Palette:** Pressing `Ctrl+K` or `/` opens a floating, fuzzy-search overlay over the UI. Users can instantly jump to `> Settings`, `> Search: Naruto`, or `> History`.
2. **Zero-Latency Prefetching:** Hovering over an episode in the list for >400ms silently triggers the daemon to extract the `.m3u8` link. Pressing `Enter` results in a 0ms delay before `mpv` launches.
3. **Zen Focus Mode:** Pressing `m` instantly hides the Bento details pane, posters, and trailers, collapsing the UI into a distraction-free, single-column list.
4. **Terminal Video Trailers:** Highlighting an anime uses `chafa` or Kitty graphics to render a silent, low-fps preview loop directly in the terminal window.

### D. MPV Mastery (Node IPC & Auto-Heal)
We do not inject messy Lua scripts. We control `mpv` strictly through Bun's blazing-fast IPC (Inter-Process Communication) sockets.
1. **AniSkip Auto-Next:** The daemon fetches OP/ED timestamps from `ani-skip`. Via IPC, we send a `seek` command to `mpv` the exact millisecond the intro starts.
2. **Silent Auto-Heal:** If `mpv` freezes buffering or returns a 404 mid-stream, the daemon detects it, instantly scrapes the *next* available server (e.g., Rivestream instead of Vidking), and resumes the `mpv` instance at the exact same timestamp without the user ever closing the window.

### E. Local-First Sync Architecture
If a user is watching on a plane with no Wi-Fi via the local TUI daemon:
1. **Offline Mode:** Progress is saved to a local SQLite/JSON database instantly.
2. **The Reconciliation:** The moment an internet connection is detected, the daemon syncs with the central Cloud (Supabase/Redis). It uses a "Last-Write-Wins" algorithm based on strict UTC timestamps to seamlessly merge watch history across all devices.

---

## 3. The Unclonable Monetization Boundary

**Free Tier (The Harvesters):**
- 100% free forever.
- Uses their own local CLI/Desktop daemon (BYOC) to scrape.
- Uses the free Cloudflare CORS proxy for 0-RAM providers on the Web App.

**Premium Tier ($3-$5/mo) - The Convenience Ecosystem:**
- **Cloud Compute Access:** Play heavy providers (Anikai/Miruro) on a mobile browser or Smart TV without needing a PC running at home.
- **Real-Debrid Integration:** Enter your Debrid key to unlock instant, uncompressed 4K torrent streaming natively in the Kunai UI.
- **Kunai Sync:** Full cross-device history and bookmark syncing.

To prevent leeches from stealing our Cloud Compute, the open-source CLI generates a dynamic, time-based cryptographic payload using a compiled Rust WebAssembly (`.wasm`) binary. Our backend rejects any scraper requests lacking a perfectly validated WASM signature.