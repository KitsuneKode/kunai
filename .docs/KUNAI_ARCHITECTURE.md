# Kunai: The Unified Master Architecture 🥷✨

This document is the high-level source of truth for the Kunai ecosystem. It synthesizes the "Stremio Killer" distribution model, the "Everything Engine" performance mandate, and the "Priceless UX" product vision into a single, uncompromised master plan.

> Status note: this document is the high-level vision, but several security and scaling details have been superseded by [.plans/kunai-architecture-and-cache-hardening.md](../.plans/kunai-architecture-and-cache-hardening.md), [.plans/kunai-experience-and-growth-moat.md](../.plans/kunai-experience-and-growth-moat.md), and [.plans/kunai-principal-grill-qa.md](../.plans/kunai-principal-grill-qa.md). In particular: use a provider RPC relay instead of a generic CORS proxy, use explicit daemon pairing instead of raw `localhost:8080` detection, treat WASM signatures as clone friction rather than auth, and use provider-scoped Playwright leases instead of assuming pure kill-after-every-resolve JIT.

---

## 1. The Core Philosophy: "Zero-Cost, Zero-Leak, Zero-Trust"

If we centralize the scraping (hosting Node.js servers to fetch streams for millions of users), we will go bankrupt from server costs and get our IPs banned instantly. If we use a "Crowd-Cache" (users sending links to a central DB), malicious users will poison the cache with fake links.

**The Solution:** Every user scrapes their own streams, securely, on their own device. We provide the UI and the tools; they provide the compute.

---

## 2. The Compute Strategy (The Stremio Killer)

To reach millions of users without asking them to install complex desktop software, we must have a functional, serverless Web App (`kunai.app`) alongside our elite CLI.

### A. The Web App (Provider RPC Relay & Client-Side Resolution)

Browsers block cross-origin requests (CORS). To allow the Web App to use cheap browser-safe providers without becoming an open proxy:

1. **The Cloudflare Worker / Pages Function:** We deploy narrow provider RPC endpoints such as `/rpc/provider/vidking/sources`.
2. **The Allowlisted Relay:** The relay accepts fixed provider operations, fixed upstream hosts, fixed path templates, response limits, and per-session budgets. It never accepts arbitrary `?url=` fetches.
3. **Client-Side Decryption:** The user's iPhone or laptop runs our browser-safe 0-RAM TypeScript logic in memory. The relay solves same-origin restrictions; it does not become Kunai's compute engine.

### B. The Local Daemon (Bring Your Own Compute)

The provider RPC relay only works for browser-safe 0-RAM providers (Vidking, Rivestream). For providers that require a real browser to bypass Cloudflare TLS (Anikai, Miruro), the Web App cannot run them directly.

- Power users run the `kunai` CLI or Desktop App in the background.
- The Web App pairs with the local daemon using an explicit QR/code flow, scoped tokens, and an origin allowlist. It never silently commands `localhost:8080`.

### C. Bring Your Own Provider (BYOP & Debrid)

Like Stremio, we don't host content. We provide a framework.

- **Debrid Integration:** Users can input their Real-Debrid API Key locally into the CLI or Web App. Kunai will prioritize caching and playing high-quality 4K torrents natively in our UI. We never touch their credentials; it stays in their local storage.

---

## 3. The Performance Mandate: Provider Leases Without Leaks

To guarantee that the CLI and local daemon run flawlessly on low-spec laptops without memory leaks:

- **The 0-RAM Default:** When browsing or using lightweight providers, Kunai uses exactly **0MB** of background browser memory.
- **The Lease Trigger:** If a user selects or strongly warms a heavy provider such as Anikai or Miruro, Kunai opens a provider-scoped Playwright lease with strict idle TTL, hard TTL, memory caps, and process-group cleanup.
- **The Result:** Pure 0-RAM providers stay browser-free, while heavy providers avoid repeated challenge costs without leaking zombie browser processes.

---

## 4. The Intelligent Cache: Local SWR & Geo-Aware Health
To avoid provider spam while making playback feel instant, Kunai uses an aggressive, self-healing local cache layer and a conservative public metadata layer.

### A. The SWR Strategy
We do not make users wait to verify if a cached link is alive. 
*   **The Fast Route:** When a user clicks "Play", Kunai can optimistically try a short-lived local cached candidate if the provider policy allows it.
*   **The Silent Verification:** While the player is loading, the daemon validates the manifest with the cheapest safe probe for that provider. It does not assume every host supports useful `HEAD` behavior.
*   **Auto-Heal:** If the candidate is expired, blocked, or region-wrong, the daemon refreshes the same provider or switches to a ranked fallback and uses player IPC to resume without dumping the user back to search.

### B. Geo-Aware Cache Partitioning
CDN links are geo-routed. A link generated for a user in London might buffer terribly for a user in Sydney.
*   Local caches partition stream candidates by region hint, provider version, runtime, auth mode, subtitle/audio preference, and TTL class.
*   Public edge storage can hold non-sensitive provider health and metadata by region, such as "Anikai APAC degraded" or "Rivestream EU fast."
*   Kunai does **not** centrally accept raw playable links from random clients. That invites cache poisoning, user tracking, provider blocks, and hard-to-debug regional failures.
*   The magic is not a global pile of links. The magic is local SWR, provider health, source confidence, and deterministic fallback.

---

## 5. The Content Scope: Video First, Reader Later

- **V1 Focus (Video Excellence):** We perfectly integrate Anime (AniList) alongside Movies and Series (TMDB). The user gets a unified, lightning-fast UI for all video content.
- **V2 Expansion (The Manga Blueprint):** We will not force a bad reading experience into the terminal. When we add Manga, Kunai will act as the tracking engine (syncing progress with AniList), but will hand off the actual visual rendering to a dedicated, high-res external reader application built for the task.

---

## 6. Solving the Iframe Problem (Maintaining the Premium UI)

If a provider only gives us an iframe (like `mp4upload.com`), we cannot embed it on the Web App without ruining the UI with ads.

1. **The Native Filter (Unpaired Web):** The Web App simply ignores iframe-only servers. It aggressively filters for direct `.m3u8` links to feed into our custom `ArtPlayer` UI.
2. **The Local Extractor (CLI/Desktop):** If the user is running the local daemon, their machine invisibly rips the raw video from the iframe using bundled `yt-dlp` and feeds it to the player.
3. **The Premium Cloud Extractor ($3/mo SaaS):** For mobile web users who _really_ want an obscure anime that only exists on `mp4upload`, we offer a premium subscription. This unlocks a backend microservice we host (`extract.kunai.app`) that runs `yt-dlp` on our servers, rips the link, and sends it to their phone.

---

## 7. The Elite TUI Experience

The terminal app (`kunai` CLI) must feel like a $1,000 developer tool.

- **The Command Palette:** `Ctrl+K` opens a floating, fuzzy-search overlay to jump anywhere (`> settings`, `> history`).
- **Zero-Latency Prefetching:** Hovering over an episode for >400ms silently extracts the `.m3u8` link in the background. Hitting `Enter` launches `mpv` instantly.
- **Zen Focus Mode:** Pressing `m` hides posters and details, collapsing the UI into a distraction-free list.
- **MPV Auto-Heal & AniSkip:** Node.js communicates with `mpv` via IPC sockets. It auto-skips intros. If a stream freezes, Node silently scrapes a backup provider and hot-swaps the video source without closing the window.

---

## 8. The Monorepo Ecosystem

We are abandoning the messy global script and building a strict Turborepo.

```text
kunai/
├── apps/
│   ├── cli/               # The Ink TUI (The Harvester & Local Daemon)
│   ├── web/               # Next.js Web Player (static shell + provider RPC/pairing client)
│   └── experiments/       # (Formerly 'scratchpads/') The isolated reverse-engineering lab
├── packages/
│   ├── core/              # The unified provider and resolution engine
│   ├── types/             # Shared TypeScript models
│   └── ui-cli/            # Shared Ink components
```

_Tests are co-located_ with their scrapers (`miruro.ts` next to `miruro.test.ts`).
