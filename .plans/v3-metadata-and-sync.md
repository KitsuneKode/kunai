# Kunai V3: Metadata, Mapping, & Sync Engine 🥷✨

This document finalizes the architectural blueprint for the data layer of Kunai. We are stripping away the slow, error-prone practice of scraping for UI/Search, and replacing it with an enterprise-grade, 0ms-latency metadata engine powered by official APIs, local caching, and real-time syncing.

This is a V3 strategy document. Backend vendor selection is intentionally not final until the sync event model, account model, cost envelope, and portability requirements are validated.

---

## 1. The Catalog Source of Truth (Split Modes)

To maintain pristine metadata without massive engineering overhead, V1 of Kunai will utilize **Split Modes**. The UI will explicitly toggle between two distinct universes:

*   **Anime Mode (Powered by AniList GraphQL):**
    *   The absolute gold standard for anime. Provides exact release schedules, high-res banners, studio info, and community recommendations.
    *   Users log in via AniList OAuth to seamlessly track their watch status (`Watching`, `Completed`, `Dropped`).
*   **Movie & TV Mode (Powered by TMDB):**
    *   The industry standard for Western media. Provides "Trending," "Top Rated," and "In Theaters" lists instantly.
    *   Users log in via Trakt.tv OAuth to scrobble their watch history.

This split greatly reduces metadata collisions. We should still keep provider-neutral content identity internally so future unified search can map AniList, TMDB, Trakt, MAL, IMDb, and provider IDs without rewriting the core data model.

---

## 2. The "Rosetta Stone" Mapping Strategy

Scraping search bars on streaming sites (e.g., `anikai.to/search?q=naruto`) is slow, requires bypassing Cloudflare just to get a list of results, and is highly prone to typos.

**The Solution: Local Mapping Databases**
We can download and parse allowed open-source mapping databases (such as MAL-Sync-style mappings or other licensed datasets) directly to the user's machine or browser cache.
*   **The Flow:**
    1. User clicks "Play" on *Demon Slayer Season 2* (AniList ID: `142329`).
    2. Kunai instantly queries the local JSON mapping file.
    3. The mapping file returns: `{ "anikai": "demon-slayer-entertainment-district-arc-xyz", "miruro": "watch-demon-slayer-s2" }`.
    4. Kunai passes the exact slug directly to the provider resolver when confidence is high.
*   **The Result:** We bypass the provider's search engine when the mapping is reliable. Clicking "Play" becomes much faster, with provider search as a fallback when mappings are stale or missing.

Mapping requirements:

- mapping source licenses must be acceptable
- mappings need versioned TTLs
- bad mappings must be diagnosable in `ResolveTrace`
- provider search remains as fallback
- mappings should include confidence and source metadata

---

## 3. Aggressive Local SQLite Caching (0ms UI)

To make Kunai feel like a $100M native app, it must never show a loading spinner when navigating menus the user has already visited.

*   **The Architecture:** The CLI/Desktop app initializes a local SQLite database (via `bun:sqlite`) once the schema stabilizes. The web app uses IndexedDB.
*   **The TTL (Time To Live):** Responses use typed TTL classes, not one global TTL. Trending can be short-lived; stable metadata can live longer; stream URLs stay short-lived.
*   **The UX:** When a user opens Kunai on an airplane with no Wi-Fi, the app opens instantly. Their watchlist and the episodes they browsed yesterday are fully loaded and interactable.

---

## 4. Hybrid Sync & The Premium Sync Engine

Watch history and cross-device syncing are the stickiest features of any streaming platform. We will offer a two-tier hybrid system.

### A. The Free Tier (3rd-Party Scrobbling)
Free users can connect AniList and Trakt.tv accounts via OAuth. As they watch episodes in `mpv`, the local Kunai daemon sends API updates to those services marking progress or completion where supported. This is robust, familiar, and costs us little to host.

### B. The Premium Tier powered by Kunai Sync
For users who pay for the Kunai Convenience Ecosystem, we upgrade them to a real-time, cross-device sync engine.

Convex is a strong candidate because it is type-safe and reactive, but it is not a locked-in decision yet. The backend choice must satisfy:

- event-log based watch history
- device IDs and offline reconciliation
- low-latency resume handoff
- export path if we outgrow the vendor
- predictable cost at scale
- strong auth and entitlement integration

*   **The Magic:** If a user is watching Episode 5 on their CLI (PC) and hits Pause at `04:12`, the local daemon emits a `progress_checkpoint` event.
*   **The Handoff:** The user opens the Kunai Web App on their phone. Sync state has already converged, and the "Resume Playing" button jumps to `04:12`.
*   **The Rule:** Settings can use last-write-wins, but watch history and progress should use an event log so offline devices cannot erase completed episodes with stale state.

---

## 5. The "Netflix Feel" (AniSkip Integration)

To round out the premium feel, Kunai will natively integrate the community `ani-skip` API.
*   Before launching `mpv`, Kunai fetches the exact millisecond timestamps for the Opening (OP) and Ending (ED) themes.
*   We inject a custom Lua script or use Node IPC to command `mpv`.
*   When the video hits the intro timestamp, `mpv` instantly seeks past it. The user's hands never touch the keyboard. 

By combining the **real-time sync engine**, the **AniList/TMDB metadata layer**, the **local mapping translation**, and the **AniSkip automation**, Kunai transitions from a "cool terminal scraper" into an elite, indispensable daily driver.
