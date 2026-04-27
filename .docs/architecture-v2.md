# Kunai Architecture V2: The "Crowd-Cached" Ecosystem 🥷✨

Based on our intensive grilling session, we have forged the ultimate architecture for Kunai. It solves the biggest problems in the anime streaming space: server costs, IP bans, slow UI, and intrusive ads.

Here is the blueprint for how we will dominate HiAnime and Miruro by building a vastly superior, minimal product.

---

## 1. The Core Philosophy
1. **Never Show an Iframe:** We will use `ArtPlayer` or `Plyr` in the Web/Desktop apps. If a provider forces an embed, the local daemon extracts the raw video invisibly via `yt-dlp`. The user sees nothing but a sleek, Netflix-style custom player.
2. **Lightning Fast Catalog:** We do not scrape for search. The entire catalog, metadata, and images are powered by the **AniList GraphQL API** and cached in Upstash/Redis. Searching is instantaneous.
3. **Zero Web Compute (The Secret Weapon):** The Web App does **not** run Playwright or heavy scrapers. It relies on the "Crowd-Cache" model (explained below).
4. **Clean Income:** No popups, no redirects, no invisible overlays. Only tasteful, static banner ads and GitHub Sponsors/Patreon for the web version. The CLI/Desktop remain 100% pure.

---

## 2. The "Crowd-Cached" Compute Model (How we win)

You noted: *"Try not to scrape when possible so that we don't actually have to worry about compute for the webapp, cli is bring ur compute."*

This leads us to the most brilliant, scalable architecture possible: **Crowd-Sourced Stream Caching**.

### How it works:
1. **The CLI / Desktop Users (The Harvesters):**
   When a user runs `kunai watch "one piece" ep 1159` on their laptop, *their* machine does the heavy Playwright scraping and Cloudflare bypassing.
2. **The Silent Push:**
   Once their local CLI successfully extracts the raw `.m3u8` stream link (e.g., `https://vault-99.owocdn...uwu.m3u8`), the CLI silently makes a tiny, authenticated POST request to our central `api.kunai.app` server. It says: *"Hey, AniList ID 21, Episode 1159 maps to this raw HLS link for the next 4 hours."*
3. **The Central Redis Cache:**
   Our server (Next.js Edge Function) takes that raw link and saves it in a super-fast Redis database. (Cost: practically $0).
4. **The Web App Users (The Consumers):**
   When a mobile user goes to `kunai.app` and clicks "Play" on One Piece Ep 1159, the web server **does not scrape anything**. It just instantly reads the `.m3u8` link from Redis and feeds it to the custom video player. 

**The Result:** 
- The Web App costs us nothing to host (Vercel Edge + Upstash Redis free tiers). 
- We never get IP banned because our servers aren't scraping anything; our CLI users are doing the work for us, distributed across thousands of residential IP addresses globally!
- The Web App feels faster than Netflix because stream links load instantly from memory.

---

## 3. The Tech Stack

### A. Packages (`packages/`)
- `@kunai/scraper`: The Node.js scraping engine we just built. Runs in the CLI and Desktop app.
- `@kunai/types`: Shared TypeScript interfaces (SearchResult, Episode, Stream).
- `@kunai/ui`: Radix UI / Shadcn components for the Web and Desktop apps.

### B. Applications (`apps/`)
- **`apps/cli` (Ink + Node.js):** The elite terminal tool. Connects to `mpv`. Pushes successful stream links to our central cache to help the community.
- **`apps/web` (Next.js 14 App Router):** The beautiful, minimal frontend. Uses AniList for the UI. Pulls stream links from Redis. Serves clean ads.
- **`apps/desktop` (Tauri + Rust/React):** The ultimate consumer app. Looks like the Web App but bundles the `@kunai/scraper` locally so the user can scrape directly if a link isn't in the global cache yet.

---

## 4. Next Steps for Implementation
To start building this ecosystem today, we need to take the following concrete steps:

1. **Initialize Turborepo:** Create the monorepo structure.
2. **Migrate the Scrapers:** Move our finalized `scratchpads` logic (Anikai Hybrid, Miruro Hybrid, Vidking 0-RAM, Rivestream 0-RAM) into `packages/scraper-core/src/providers/`.
3. **Build the API Contract:** Create a unified interface so that all scrapers return the exact same `StreamSource` object.
4. **Setup the Database/Cache:** Spin up a free Upstash Redis database to store the mappings: `AniListID:EpisodeNum -> RawStreamURL`.
5. **Build the Web Player:** Start the Next.js app, integrate `ArtPlayer` (it has the best HLS support and UI customization), and connect it to the Redis cache.

This architecture scales infinitely, costs almost nothing to run, and provides an immaculate user experience.