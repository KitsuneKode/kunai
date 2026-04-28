# Kunai V1 Strategy: The Unclonable Elite TUI & Monetization Plan 🥷✨

Based on the strategic alignment, we are prioritizing the **CLI-Only Daemon** with an **Elite Hacker UI** as the V1 product. The goal is to build an engineering marvel that attracts users, fame, and monetization, while technically preventing low-effort clones from stealing our backend resources.

---

## 1. The Monetization & Defensive Strategy ("The Unclonable Core")

The danger of open-source streaming tools is that someone forks the repo, changes the logo, and profits off your scraping logic or cloud compute. We must protect the "Secret Sauce."

### A. The "Open-Core" Model (How we protect the Cloud Compute)
- **Open Source (The Client):** The CLI UI, the `mpv` player bindings, the AniList GraphQL fetching, and the 0-RAM scrapers (Vidking, Rivestream) are 100% open source. Users can review the code and trust that we don't steal credentials.
- **Closed Source (The Cloud API):** The backend API (`api.kunai.app`) that provides the **Cloud Playwright Compute** (for mobile/TV users or those who don't want a local daemon) and the **Cloud yt-dlp Extractor** is closed source.
- **The Cryptographic Hack (Anti-Leech):** To prevent someone from forking our Web App and using our free Cloud Compute backend:
  - We do not use static API keys.
  - The open-source CLI generates a dynamic, time-based cryptographic payload (e.g., HMAC-SHA256 of the current timestamp + AniList ID + a rotating salt fetched from a secure endpoint).
  - The payload is obfuscated in a WASM (WebAssembly) binary. The CLI passes the variables to the WASM file, which spits out the final `x-kunai-signature` header.
  - If a cloner forks the repo, they can't easily reverse-engineer the WASM binary to figure out how to generate valid API requests. Our backend rejects any request without a perfect signature.

### B. Value-for-Money Premium Tier ($3-$5/mo)
We don't charge for the content (which is illegal/unethical). We charge for the **Convenience Ecosystem**.
1.  **Cloud Compute Access:** Play Anikai/Miruro streams on your phone/TV without running your PC at home.
2.  **The "Kunai Sync" Engine:** A real-time WebSocket backend. Pause on the CLI, resume on the Web App instantly. Cross-device watch history and bookmarks.
3.  **Real-Debrid Integration:** Premium users can input their Debrid credentials into the Web/TV app to unlock instant 4K torrent streaming without buffering.
4.  **Community Socials:** Comments, Discord Rich Presence, and sync-watching with friends.

---

## 2. The V1 CLI: The "Elite Hacker" UI & UX

The terminal app will not feel like a script; it will feel like a $1,000 developer tool.

### Visuals & Information Density
-   **High-Res Kitty/Sixel Posters:** Genuine, high-quality anime posters rendering natively inside the terminal next to the search list.
-   **Terminal Video Trailers:** When a user focuses on an anime, we use `chafa` (or Kitty graphics) to stream a low-fps, silent trailer loop directly in the terminal preview pane!
-   **The Bento Box Detail Pane:** A dense, gorgeously formatted sidebar showing:
    -   MAL / AniList / IMDb / TMDB Ratings (Color-coded: Green > 8.0, Yellow > 6.0).
    -   Episode counts, air dates, and studio info.

### The UX & Interactions
-   **The Command Palette (`Ctrl+K` or `/`):** A VS-Code style floating palette that dims the background. Type `> settings` or `> history` or `> provider miruro` to jump anywhere instantly.
-   **Zero-Latency Hover Prefetching:** The moment the cursor rests on "Episode 5" for more than 400ms, the CLI silently kicks off the scraping process in the background. When the user hits `Enter`, `mpv` launches instantly because the `.m3u8` link is already in memory.
-   **Auto-Skip & Auto-Next (AniSkip):** 
    -   The CLI queries the `ani-skip` API for the exact timestamp of the OP/ED.
    -   We pass these timestamps to `mpv` via IPC (Inter-Process Communication) or Lua scripts, automatically jumping past the intro without the user touching the keyboard.
    -   When the episode ends, the CLI detects the `mpv` close event and automatically starts pre-fetching the next episode.

---

## 3. Engineering Marvels (How to gain Fame & Career Capital)

If you want this to build your career and attract jobs/business, the codebase must be a masterpiece of modern engineering.

1.  **The Monorepo (Turborepo):** Proves you understand enterprise-scale architecture. We share `@kunai/scraper-core`, `@kunai/types`, and `@kunai/ui-cli`.
2.  **State Machines (XState / Zustand):** Terminal apps usually suffer from "spaghetti state." We will use a strict state machine to handle the transitions between `Search -> Resolving -> Playback -> Post-Play`. It makes the UI bulletproof and highly testable.
3.  **The WASM Cryptography:** Writing the API signature generator in Rust and compiling it to WebAssembly (`.wasm`) to run inside the Node/Bun CLI. This shows extreme technical depth and security awareness.
4.  **The Background IPC Daemon:** Building the CLI so that `kunai serve` runs a detached background process communicating via Unix Domain Sockets.

---

## 4. Immediate Execution Plan

1.  **Initialize Turborepo:** Create the monorepo structure.
2.  **Migrate Scrapers:** Move the 0-RAM and Hybrid scrapers into the shared `@kunai/scraper-core` package.
3.  **Build the V1 Ink Shell:** 
    -   Implement the Red/Gray Kunai design tokens.
    -   Build the grid layout (Search Left, Bento Box Details Right).
    -   Implement the `Ctrl+K` Command Palette.
4.  **Integrate AniList GraphQL:** Replace the slow HTML search scraping with instant, cached AniList API calls to populate the UI.