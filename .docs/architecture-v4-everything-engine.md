# Kunai Architecture V4: The Zero-Leak "Everything" Engine 🥷✨

Based on our final, rigorous grilling session, we have cemented the ultimate technical and product strategy for Kunai. This document outlines how we achieve a flawless, premium experience that supports Anime, Movies, and Series immediately, while laying the groundwork for Manga, without ever succumbing to memory leaks or bloated code.

---

## 1. Scope & Expansion: The "Video First, Reader Later" Strategy

You made a crucial point: terminal image viewers for manga are a terrible UX. We will not compromise the premium feel of Kunai by shoehorning a bad reading experience into the terminal.

*   **V1 Focus (Video Excellence):** We perfectly integrate Anime (AniList) alongside Movies and Series (TMDB). The `scraper-core` elegantly routes requests to Vidking (for Movies/Series) or Anikai/Miruro (for Anime). The user gets a unified, lightning-fast UI.
*   **V2 Expansion (The Manga Blueprint):** When we add Manga, we will build a dedicated, external reader application (or integrate with an existing premium one). Kunai will act as the tracking engine—silently syncing your reading progress with AniList in the background, but handing off the actual visual rendering to a proper tool built for high-res images.

---

## 2. The Performance Mandate: Zero Memory Leaks

To guarantee that Kunai runs flawlessly on low-spec laptops and never hogs memory, we are adopting the **Just-in-Time (JIT) Playwright Lifecycle**.

*   **The 0-RAM Default:** By default, Kunai uses exactly 0MB of background browser memory. When searching or browsing, it relies entirely on pure Node.js `fetch` requests to AniList/TMDB.
*   **The JIT Trigger:** If a user selects a stream from a "True 0-RAM" provider (Vidking, Rivestream), Kunai fetches the `.m3u8` instantly via HTTP. Playwright is *never* launched.
*   **The Surgical Strike (Hybrid Providers):** If a user selects an episode from Anikai or Miruro, Kunai launches a hidden Playwright instance *at that exact second*. It navigates the Cloudflare challenge, extracts the stream URL, passes it to `mpv`, and then **instantly kills the Playwright process.**
*   **The Result:** The user experiences a 1-2 second delay on hybrid streams, but their machine's memory is immediately freed. There are zero zombie processes, zero memory leaks, and Kunai remains incredibly lightweight, even if left open for weeks.

---

## 3. The Premium TUI: Filters & "The Aha Moment"

To make the terminal app feel like a $1,000 developer tool, we must eliminate friction. "Nothing should feel like a bad miss."

*   **The Smart Watchlist:** The default view upon opening Kunai isn't an empty search bar. It's a dynamically sorted list of your "Continuing" shows that have *new, unwatched episodes available*.
*   **On-the-Fly Audio/Sub Toggles:** Users shouldn't have to dig into global settings just to switch from Sub to Dub for one show. The episode picker will have a native toggle (e.g., press `a` to swap Audio tracks) before hitting play.
*   **Advanced Catalog Filters:** When browsing, users can press `f` to open a filter overlay, allowing them to instantly drill down by Genre, Year, Status (Airing/Finished), and Format (TV/Movie).

---

## 4. Codebase Purity: The Turborepo Structure

We are migrating from a messy, globally-installed script to a pristine, enterprise-grade Monorepo.

```text
kunai/
├── apps/
│   ├── cli/               # The Ink terminal app (The TUI)
│   ├── web/               # Next.js Web Player (Future)
│   └── experiments/       # (Formerly 'scratchpads/') The isolated reverse-engineering lab
├── packages/
│   ├── scraper-core/      # The unified scraping engine (Vidking, Rivestream, Anikai, Miruro)
│   ├── config/            # Shared ESLint, Prettier, and TS configs
│   └── types/             # Shared TypeScript models (StreamSource, Episode)
```

### The Fate of the Scratchpads (`apps/experiments/`)
Reverse-engineering streaming sites is messy work. It requires downloading weird JSON blobs and writing hacky scripts to test decryptions.
We will not pollute the main codebase with this. `apps/experiments/` will serve as our isolated laboratory. When an experiment successfully cracks a new provider (like we just did with Anikai), we cleanly port the finalized logic into `packages/scraper-core/`.

### Co-Located Testing
Tests will no longer live in a distant `test/` folder. They will be co-located with the code they verify (e.g., `packages/scraper-core/src/providers/miruro.ts` sits right next to `miruro.test.ts`). This ensures that as we update a scraper, we update its test simultaneously.