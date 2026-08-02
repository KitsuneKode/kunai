# V2 Hardening & Legacy Removal Plan

## Objective

Address critical bugs identified during the architectural review and eliminate the legacy `src/providers/` system. Transition all provider logic natively to the new dependency-injected `src/services/providers/Provider.ts` interface.

## Phase 1: Core Bug Fixes & Resilience

1. **Fix Subtitle Cache Staleness**
   - **Target**: `src/infra/browser/BrowserServiceImpl.ts`
   - **Action**: When pulling from cache, if `requestedSubLang !== "none"`, verify the cached object has a matching subtitle. If not, but it has `subtitleList`, re-run `selectSubtitle(cached.subtitleList, requestedSubLang)`. If still no match and we must have one, bypass cache and re-scrape.

2. **Fix Duplicate Cache Management**
   - **Target**: `src/scraper.ts`, `src/cache.ts`
   - **Action**: Remove `import { cacheStream }` from `scraper.ts`. All caching should _only_ happen in `BrowserServiceImpl.ts` via the DI `CacheStore`. (Also requires moving the text log append to `BrowserServiceImpl` or a new Logger method).

3. **Handle Playwright 'Target Closed' Exceptions**
   - **Target**: `src/scraper.ts`
   - **Action**: Wrap `newPage.url()`, `newPage.title()`, and `page.close()` calls in `try/catch` or use `.catch(() => ...)` to prevent unhandled promise rejections when popups are aggressively killed by ad-blockers.

4. **Graceful Shutdown on Signals**
   - **Target**: `src/main.ts`, `src/app/SessionController.ts`
   - **Action**: Trap `SIGINT` and `SIGTERM`, notify the `SessionController` to run a `shutdown()` method which awaits pending history and config flushes, then cleanly `process.exit(0)`.

5. **Fix Auto-Next Bugs (Unreleased Episodes & Hijacking)**
   - **Target**: `src/tmdb.ts`, `src/app/playback-policy.ts`, `src/app/PlaybackPhase.ts`
   - **Action**:
     - Update `tmdb.ts` to parse the full `airDate` (YYYY-MM-DD) instead of truncating it to just the year. Update `formatEpisode` to only show the year in the UI.
     - Update `playback-policy.ts` to filter out `CatalogEpisode`s where `new Date(airDate).getTime() > Date.now()`. This prevents auto-next from attempting to scrape unreleased episodes (which causes "Stream not found" loops).
     - Update `PlaybackPhase.ts`: Instead of instantly firing the next episode when `autoNext` triggers, show an interactive 5-second countdown prompt (or simply make the resolving shell cancellable) so the user isn't held hostage by an un-cancellable stream resolution if they wanted to stop watching.

## Phase 2: Legacy Provider Eradication

Currently, the `src/services/providers/definitions/` are just thin wrappers over the legacy `src/providers/` implementations. We need to eliminate the legacy folder entirely.

1. **Migrate Native Playwright Providers (e.g. VidKing)**
   - Move the raw URL construction and scrape instructions directly into the v2 Provider definition (`src/services/providers/definitions/vidking.ts`).
   - Use `this.deps.browser.scrape({ url, title, ... })` natively without passing around arbitrary `embedScraper` callbacks.

2. **Migrate API Providers (e.g. AllAnime, CinebyAnime, Braflix, BitCine)**
   - Move the API logic, crypto algorithms (for AllAnime), and parsing logic directly into the v2 Provider definitions.
   - For hybrid providers like Braflix that need API metadata _and_ browser scraping, they will natively call their API, get the embed URL, and then call `this.deps.browser.scrape()` directly.

3. **Delete Legacy Types**
   - Delete `src/providers/` entirely.
   - Update `src/app-shell/workflows.ts` to source provider lists from the `ProviderRegistry` instead of hardcoded arrays in the legacy folder.

## Phase 3: Advanced Resilience

1. **Stream Fallback Cascade**
   - In `PlaybackPhase.ts`, if stream resolution fails, attempt the next available provider from the registry for that mode (anime vs series) before throwing an error.
