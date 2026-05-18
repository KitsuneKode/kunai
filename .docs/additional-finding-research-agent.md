# Codebase Architecture & Redundancy Audit

**Date:** May 18, 2026
**Focus:** Bottom-up architectural review of the CLI, Core, and Provider layers to identify redundant 3rd-party metadata fetching, unnecessary network hops, and multi-call reconciliation where native provider support exists.

## Executive Summary

KitsuneSnipe currently operates a "split-brain" architecture. The CLI Shell (acting as the presentation layer) attempts to enrich data by independently calling 3rd-party services (AniList, TMDB, Haglund ARM) for metadata, thumbnails, schedules, and AniSkip mappings. However, our provider engines (Layer 1) already receive the vast majority of this data natively from their upstream APIs. This results in heavy redundancy, N+1 network requests, and unnecessary vulnerability to rate limits.

---

## 1. Identified Redundancies & Multi-Calls

### A. Anime Search Enrichment vs. Native AllManga GraphQL

**Current Behavior:**
When a search is performed, `apps/cli/src/app/anime-metadata.ts` invokes `enrichAnimeSearchResultsWithAniList`, which makes a direct GraphQL query to `https://graphql.anilist.co`.
**The Redundancy:**
In `packages/providers/src/allmanga/api-client.ts` (`searchAllManga`), the native provider query _already requests and receives_:

- `malId`
- `aniListId`
- `thumbnail`, `banner`
- `description`, `score`, `genres`, `altNames`
  **Conclusion:** The CLI is re-fetching the exact same metadata from AniList that AllManga just provided in the raw GraphQL response. If AllManga is the active provider, we can completely bypass `enrichAnimeSearchResultsWithAniList` and `CatalogDiscoveryService` AniList calls.

### B. AniSkip MAL ID Reconciliation

**Current Behavior:**
In `apps/cli/src/aniskip.ts`, when requesting skip times, the code makes a network request to map an AniList ID to a MAL ID by calling `arm.haglund.dev/api/v2/ids` or making a GraphQL query to AllAnime again via `fetchMalIdFromAllAnimeShow`.
**The Redundancy:**
_The redundancy is NOT the call to `api.aniskip.com` (we still need that)._ The redundancy is the fact that the CLI has to make a network request just to figure out the `malId`. The streaming provider (AllManga) already returned the exact `malId` in its initial catalog load! Because the SDK boundary drops it, the CLI has to blindly ask the network "What is the MAL ID again?".
**Conclusion:** By bubbling `malId` up through the SDK in the V2 overhaul, the CLI can skip the ID reconciliation network hops and go straight to `api.aniskip.com`.

### C. Episode Release Schedules (CatalogScheduleService)

**Current Behavior:**
`apps/cli/src/services/catalog/CatalogScheduleService.ts` makes polling queries to `graphql.anilist.co` to find out when the next episode of an ongoing anime is airing.
**The Redundancy:**
According to the `.docs/provider-dossiers/allmanga.md` report, AllManga has a hidden `episodeInfos` query that inherently returns `uploadDates` and `broadcastInterval`.
**Conclusion:** We are relying on a generic 3rd-party AniList schedule service when the actual streaming provider already tells us exactly when _their_ file will be available. Using the provider's native schedule guarantees we don't display a "Play" button before the provider actually hosts the file.

### D. Thumbnails & Seek-Bars

**Current Behavior:**
`PlaybackPhase.ts` uses `resolveSubtitlesByTmdbId` and tries to fetch preview images from TMDB (`poster-source-cache.ts`).
**The Redundancy:**

- **Miruro:** Natively returns VTT sprite coordinates in its `bee` server Pipe API response.
- **VidKing/Cineby:** Natively include `#EXT-X-IMAGE-STREAM-INF` in the resolved `.m3u8` stream.
- **AllManga:** Natively provides a `thumbnails[]` array per episode via `episodeInfos`.
  **Conclusion:** The Shell does not need to guess or scrape TMDB for seek-bar thumbnails. The provider engine `resolve()` should attach a `seekBarVttUrl` or `thumbnailArray` directly to the `ProviderSourceInventory`, and MPV should be configured to use them natively (e.g. via `--demuxer-mkv-subtitle-preroll` or IPC loading).

### E. Account Sync & History Re-Mapping

**Current Behavior:**
When an episode is finished, `SyncService` attempts to push progress to AniList or TMDB (`apps/cli/src/services/sync/AniListAdapter.ts`). It relies on `HistoryProgress` which only holds the generic `titleId` (e.g., an internal AllManga or Cineby ID).
**The Redundancy:**
Because the `HistoryProgress` database record lacks the canonical `aniListId` or `tmdbId` that the provider engine _already knew_, the Sync Adapter is forced to make a GraphQL query to `graphql.anilist.co` to re-search the title by name and reverse-engineer the AniList ID before it can post the progress update.
**Conclusion:** Local `history` database tables must be updated to store optional `aniListId` and `tmdbId` columns. If they are populated during the initial catalog load, `SyncService` can post progress instantly without a preliminary mapping query.

---

## 2. Bottom-Up Layer Analysis (The Disconnect)

### Layer 1: Provider Data Engines (`packages/providers`)

- **Strengths:** Doing the heavy lifting. Decoding WASM (VidKing), executing XOR/Gzip (Miruro), executing AES-256 (AllManga). They have access to the raw payload, which is incredibly rich (Sub/Dub split arrays, native IDs, release dates).
- **Issues:** They flatten this rich data into a lowest-common-denominator shape before handing it to `packages/core`.

### Layer 2: Core SDK Boundary (`packages/core` & `packages/types/src/index.ts`)

- **Issues:** My deep inspection of `packages/types/src/index.ts` definitively proves the bottleneck. The `ProviderSearchResult` interface strictly omits `malId` and `aniListId`. The `ProviderEpisodeOption` interface omits `thumbnails` and `releaseDate`. The `ProviderResolveResult` does not enforce `seekBarVttUrl`.
- **The Result:** Even though Layer 1 (`allmanga/api-client.ts`) perfectly extracts `malId` and `thumbnails[]`, the TypeScript compiler forces the provider implementations to drop this data before it reaches the Shell. Because these fields aren't part of the contract, the UI layer assumes they are missing.

### Layer 3: Shell Workflows & App Phases (`apps/cli/src/app`)

- **Issues:** Because the Shell assumes the provider only returns raw stream links and basic titles, it invokes `CatalogDiscoveryService`, `CatalogScheduleService`, `anime-metadata.ts`, and `aniskip.ts` to "fill in the gaps". This causes N+1 API calls to external services.
- **The Fix:** The Shell must implement **"Trust but Verify"**. If the `ProviderSourceInventory` payload includes `malId`, skip Haglund. If it includes `thumbnails`, skip TMDB fallback. If it includes a countdown, skip the AniList schedule fetch.

---

## 3. Actionable Recommendations for Architecture V2

To maximize performance, achieve 0-RAM streaming, and eliminate rate-limit bottlenecks:

1. **Pass-Through Native IDs:**
   Modify the Catalog Search and Episode schemas in `packages/types` or `packages/core` to include optional `malId`, `aniListId`, and `tmdbId` fields. Have AllManga, Miruro, and VidKing populate these directly.
2. **Bypass 3rd-Party Timing:**
   Update `PlaybackTimingAggregator.ts` and `aniskip.ts`. If the provider gave us `malId` on catalog load, pass it directly into the `fetch()` payload to bypass the `arm.haglund.dev` mapping.
3. **Provider-Native Schedules:**
   Refactor `CatalogScheduleService.ts`. Before it hits AniList, it should check if the Provider Engine can supply `countdownReleaseDate` via `episodeInfos`. Only fall back to AniList if the provider is dumb (like an older aggregator).
4. **Thumbnail Passthrough:**
   Ensure `resolve()` returns `artwork.seekBarVttUrl`. In `mpv.ts` or `PlaybackPhase.ts`, directly mount this VTT to MPV's subtitle/image stream so the seek-bar preview renders without an extra TMDB HTTP call.

---

## 4. V2 Rollout & Migration Strategy (The Operational Blind Spots)

Transitioning from V1 to V2 requires handling existing data and fallback scenarios carefully.

### A. Cache Schema Versioning

`packages/providers/src/shared/provider-cache.ts` and `SourceInventoryService.ts` currently use `SOURCE_INVENTORY_SCHEMA_VERSION = "v1"`.
**Action:** This MUST be bumped to `v2` when the new `ProviderSourceInventory` types are implemented. If not, the CLI will read V1 caches from disk, see missing `malId` fields, and silently trigger the redundant network hops we are trying to eliminate.

### B. Conditional Fallbacks ("Dumb" Providers)

While "Elite" providers (AllManga, Miruro) return rich metadata natively, "Dumb" aggregators (like Rivestream) only know how to scrape raw video files and lack metadata like `malId` or schedules.
**Action:** Do _not_ delete the 3rd-party fetching logic in `CatalogDiscoveryService` or `aniskip.ts`. Instead, implement a **"Trust but Verify" Conditional Fallback Chain**:

1. Check if the metadata (`malId`, `releaseDate`) exists on the provider payload. If yes, use it directly (0-RAM).
2. If missing (dumb provider), execute the legacy 3rd-party network hops to fill in the gaps.

### C. SQLite Schema Updates (Testing Phase Caveat)

To fix the `SyncService` redundancy, the SQLite `history` database must be updated to store `aniListId` and `tmdbId`.
**Action:** Because we are not focusing on strict backwards compatibility for thousands of users right now, **we will skip writing complex SQL migration scripts to save complexity.** For the immediate V2 testing phase, we will simply manually wipe or alter the primary developer's local `.sqlite` file. The TypeScript entity types should be updated, but we accept that existing databases will be blown away during testing.

## Conclusion

We have been artificially slowing down our CLI and introducing points of failure by asking AniList and TMDB questions that AllManga and VidKing already answered in their first response. By strictly enforcing the new `ProviderSourceInventory` contract, bubbling up native metadata, and implementing conditional fallbacks, we can eliminate at least 3 distinct network hops in the critical playback path.
