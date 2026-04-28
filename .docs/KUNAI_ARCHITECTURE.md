# Kunai: The Unified Master Architecture 🥷✨

This document is the absolute source of truth for the Kunai ecosystem. It synthesizes the "Stremio Killer" distribution model, the "Everything Engine" performance mandate, and the "Priceless UX" product vision into a single, uncompromised master plan.

---

## 1. The Core Philosophy: "Zero-Cost, Zero-Leak, Zero-Trust"

If we centralize the scraping (hosting Node.js servers to fetch streams for millions of users), we will go bankrupt from server costs and get our IPs banned instantly. If we use a "Crowd-Cache" (users sending links to a central DB), malicious users will poison the cache with fake links.

**The Solution:** Every user scrapes their own streams, securely, on their own device. We provide the UI and the tools; they provide the compute.

---

## 2. The Compute Strategy (The Stremio Killer)

To reach millions of users without asking them to install complex desktop software, we must have a functional, serverless Web App (`kunai.app`) alongside our elite CLI.

### A. The Web App (The CORS Proxy & Client-Side Scraping)

Browsers block cross-origin requests (CORS). To allow the Web App to scrape providers for free:

1. **The Cloudflare Worker (The Proxy):** We deploy a tiny, free serverless function on Cloudflare (e.g., `proxy.kunai.app`).
2. **The Pass-Through:** When the user's browser wants to scrape Vidking, it calls `https://proxy.kunai.app/?url=https://videasy.net/api`.
3. **Client-Side Decryption:** The proxy strips the CORS headers and returns the raw encrypted data. The user's iPhone or Laptop runs our 0-RAM TypeScript decryption logic entirely in their browser memory. We pay **$0** in compute.

### B. The Local Daemon (Bring Your Own Compute)

The CORS proxy only works for 0-RAM providers (Vidking, Rivestream). For providers that require a real browser to bypass Cloudflare TLS (Anikai, Miruro), the Web App cannot run them.

- Power users run the `kunai` CLI or Desktop App in the background.
- The Web App detects `localhost:8080`. It instantly "unlocks" the heavy providers, routing the Playwright scraping requests through the user's own local machine instead of the CORS proxy.

### C. Bring Your Own Provider (BYOP & Debrid)

Like Stremio, we don't host content. We provide a framework.

- **Debrid Integration:** Users can input their Real-Debrid API Key locally into the CLI or Web App. Kunai will prioritize caching and playing high-quality 4K torrents natively in our UI. We never touch their credentials; it stays in their local storage.

---

## 3. The Performance Mandate: JIT Playwright (Zero Leaks)

To guarantee that the CLI and local daemon run flawlessly on low-spec laptops without memory leaks:

- **The 0-RAM Default:** When browsing or using lightweight providers, Kunai uses exactly **0MB** of background browser memory.
- **The JIT Trigger (Just-In-Time):** If a user selects an episode from Anikai or Miruro, Kunai launches a hidden Playwright instance _at that exact second_, bypasses the Cloudflare challenge, extracts the stream URL, passes it to `mpv`, and **instantly kills the Playwright process.**
- **The Result:** A 1-2 second delay on heavy streams, but the machine's memory is immediately freed. Zero zombie processes.

---

## 4. The Content Scope: Video First, Reader Later

- **V1 Focus (Video Excellence):** We perfectly integrate Anime (AniList) alongside Movies and Series (TMDB). The user gets a unified, lightning-fast UI for all video content.
- **V2 Expansion (The Manga Blueprint):** We will not force a bad reading experience into the terminal. When we add Manga, Kunai will act as the tracking engine (syncing progress with AniList), but will hand off the actual visual rendering to a dedicated, high-res external reader application built for the task.

---

## 5. Solving the Iframe Problem (Maintaining the Premium UI)

If a provider only gives us an iframe (like `mp4upload.com`), we cannot embed it on the Web App without ruining the UI with ads.

1. **The Native Filter (Web Default):** The Web App simply ignores iframe-only servers. It aggressively filters for direct `.m3u8` links to feed into our custom `ArtPlayer` UI.
2. **The Local Extractor (CLI/Desktop):** If the user is running the local daemon, their machine invisibly rips the raw video from the iframe using bundled `yt-dlp` and feeds it to the player.
3. **The Premium Cloud Extractor ($3/mo SaaS):** For mobile web users who _really_ want an obscure anime that only exists on `mp4upload`, we offer a premium subscription. This unlocks a backend microservice we host (`extract.kunai.app`) that runs `yt-dlp` on our servers, rips the link, and sends it to their phone.

---

## 6. The Elite TUI Experience

The terminal app (`kunai` CLI) must feel like a $1,000 developer tool.

- **The Command Palette:** `Ctrl+K` opens a floating, fuzzy-search overlay to jump anywhere (`> settings`, `> history`).
- **Zero-Latency Prefetching:** Hovering over an episode for >400ms silently extracts the `.m3u8` link in the background. Hitting `Enter` launches `mpv` instantly.
- **Zen Focus Mode:** Pressing `m` hides posters and details, collapsing the UI into a distraction-free list.
- **MPV Auto-Heal & AniSkip:** Node.js communicates with `mpv` via IPC sockets. It auto-skips intros. If a stream freezes, Node silently scrapes a backup provider and hot-swaps the video source without closing the window.

---

## 7. The Monorepo Ecosystem

We are abandoning the messy global script and building a strict Turborepo.

```text
kunai/
├── apps/
│   ├── cli/               # The Ink TUI (The Harvester & Local Daemon)
│   ├── web/               # Next.js Web Player (The CORS Consumer)
│   └── experiments/       # (Formerly 'scratchpads/') The isolated reverse-engineering lab
├── packages/
│   ├── scraper-core/      # The unified engine (Vidking, Rivestream, Anikai, Miruro)
│   ├── types/             # Shared TypeScript models
│   └── ui-cli/            # Shared Ink components
```

_Tests are co-located_ with their scrapers (`miruro.ts` next to `miruro.test.ts`).
