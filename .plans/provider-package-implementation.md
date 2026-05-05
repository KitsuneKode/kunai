# Provider Package Implementation Guide (@kunai/providers) 🥷✨

This document defines the strict engineering standards, interfaces, and code quality expectations for the `packages/providers` module. The core philosophy is **"The UI is pristine; the Provider handles the mess."**

---

## 1. The Core Interface (The Contract)
All providers (Vidking, Miruro, Anikai, Rivestream) MUST implement a standardized `IProvider` interface. The UI will only ever interact with this contract.

```typescript
export interface StreamSource {
    url: string;
    quality: "4k" | "1080p" | "720p" | "480p" | "360p" | "auto";
    isHardsubbed: boolean;
    requiresYtDlp: boolean; // True for raw embeds like mp4upload
    headers?: Record<string, string>; // Must include Referer if required by CDN
    subtitles?: SubtitleTrack[];
}

export interface ProviderResult {
    providerId: string;
    stream: StreamSource;
    trace: ResolutionTrace[]; // Diagnostic log of which internal mirrors failed/succeeded
}

export interface IProvider {
    readonly capabilities: {
        requiresPlaywright: boolean;
        contentTypes: Array<"anime" | "movie" | "series">;
    };
    
    // AbortSignal is MANDATORY for all network operations
    resolveStream(id: string, type: "sub" | "dub", signal: AbortSignal): Promise<ProviderResult | null>;
}
```

---

## 2. Best Practices: Bun Primitives & Resiliency

### A. Mandatory AbortSignals
If a user rapidly scrolls through episodes or hits "Next Episode" twice, we MUST instantly cancel the previous scraping request to prevent memory leaks and API spam.
*   Every `fetch()` call must pass the `signal` parameter.
*   If the provider uses Playwright, you must bind the `AbortSignal` to the browser context so it instantly kills the headless Chrome process if the user cancels.

### B. Encapsulated Retries
Network requests fail. Cloudflare drops packets randomly. 
*   Do not throw errors immediately. Wrap `fetch` calls in an internal retry loop (max 3 attempts) with exponential backoff.
*   The UI should never have to orchestrate a retry.

### C. Movie Release Dates (TMDB)
For movies and western series, AniList is useless. 
*   **The Source:** We use the TMDB API for all non-anime metadata.
*   **Release Dates:** TMDB provides exact theatrical and digital release dates. The UI will parse TMDB's `release_date` and display it cleanly. The `Provider` package never concerns itself with release dates—it only takes the `TMDB ID` and returns a stream.

---

## 3. The Final Sweep: Anikai, Miruro, Rivestream

### 1. Miruro (The 0-RAM Native)
*   **The Strategy:** Completely bypass the `miruro.tv` frontend.
*   **Implementation:** 
    1. Make a pure `fetch()` to `https://theanimecommunity.com/api/v1/episodes...` using the `AniList ID`.
    2. Extract the `pro.ultracloud.cc` or `noahwilliams911` CDN link.
    3. Return the stream with `headers: { Referer: "https://www.miruro.tv/" }` to bypass the CDN 403 block.
*   **Why it's flawless:** No Playwright overhead. Instant resolution.

### 2. Anikai (The Hybrid Fallback)
*   **The Strategy:** JIT Playwright + Internal Server Loop.
*   **Implementation:**
    1. Launch Playwright (bind to `AbortSignal`).
    2. Catch `ERR_ABORTED` Cloudflare drops gracefully.
    3. Get the list of servers.
    4. **The Loop:** Try Server 1. Intercept the `/ajax/links/view` response. Navigate into the wrapper iframe. Extract the 3rd-party embed URL.
    5. If the embed URL is unsupported by `yt-dlp` (e.g., `megaup.nl`), the provider SILENTLY catches its own error, logs it to the `Trace` object, and tries Server 2.
    6. Kill Playwright in a `finally {}` block.

### 3. Rivestream (The Math Wizard)
*   **The Strategy:** True 0-RAM.
*   **Implementation:**
    1. Do not use Playwright.
    2. Execute the ported 32-bit MurmurHash algorithm locally to generate the dynamic `secretKey` using the TMDB ID.
    3. Fetch the `/api/backendfetch` endpoint.
    4. Extract the direct `.m3u8` from the JSON payload.
*   **Why it's flawless:** Zero memory footprint, perfectly mimics the browser math without actually running a browser.

---

## 4. The Global Orchestrator (The Ultimate Fallback)

Inside the core engine, we have a `Resolver` class that acts as the traffic cop.

```typescript
const ORCHESTRATION_CONFIG = {
    anime: {
        primary: "miruro", // Fast, 0-RAM
        fallback: ["allanime", "anikai"] // Anikai is last because it requires heavy Playwright
    },
    movie: {
        primary: "rivestream", // Fast, 0-RAM
        fallback: ["vidking", "cineby"]
    }
};
```
When the UI calls `Kunai.play(animeId)`, the engine:
1. Hits Miruro. 
2. If Miruro fails (or Cloudflare blocks the raw fetch), it instantly hits AllAnime.
3. If AllAnime fails, it spins up Playwright and hits Anikai.
4. The user sees one seamless loading spinner, completely blind to the fact that their local machine just cycled through 3 different global streaming infrastructures in 1.5 seconds.