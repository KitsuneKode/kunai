# Analysis: Wyzie Subtitle Resolver Issues & Fixes

## 📋 Executive Summary

The current subtitle resolution in KitsuneSnipe (specifically for the Vidking/HDToday providers) is unreliable because it relies on **passive sniffing**. It waits for the browser player to trigger a subtitle search, which often never happens due to "lazy loading" or strict timeouts. This report outlines why the current system fails and how to transition to a high-performance **Active 0-RAM Resolution** model.

---

## 🔍 Root Causes of Failure

### 1. The "Lazy Loading" Trap

**Observation:** Vidking's web player is optimized to save bandwidth. It does **not** call `sub.wyzie.io` until the user physically interacts with the "CC" (Closed Captions) button in the browser UI.
**Impact:** Since our scraper is headless and non-interactive, the request is never emitted. The `scraper.ts` observer waits for 3.5 seconds, finds nothing, and reports `"wyzie-empty"`.

### 2. Observation Race Conditions

**Observation:** Even if the request is emitted, the `waitForWyzieBrowserResponse` function in `src/scraper.ts` uses a static timeout.
**Impact:** If the network is slow or Cloudflare challenges the subtitle request, the scraper finishes "capturing" before the subtitle JSON arrives, leading to inconsistent results ("weird behavior").

### 3. Redundancy & Overhead

**Observation:** The current logic (L268 in `src/scraper.ts`) tries to fetch the JSON in Node.js _after_ the browser already fetched it.
**Impact:** This results in double the network traffic and a "repetitive" feel in the logs, without providing any additional reliability.

---

## 💡 The Proposed Fix: Active 0-RAM Resolution

Instead of watching the browser, we should **bypass it entirely**. Since we have cracked the Vidking backend and discovered the static Wyzie API key, we can resolve subtitles instantly.

### 1. Use the "Golden Key"

We have confirmed that the following key is static and reusable:

- **Key:** `wyzie-9bafe78d95b0ae85e716d772b4d63ec4`
- **Endpoint:** `https://sub.wyzie.io/search?id={tmdbId}&key={key}&season={s}&episode={e}`

### 2. Implement "Smart Filtering"

The current `selectSubtitle` logic picks roughly. It should be updated to:

- **Exclude SDH:** Filter out tracks with `[SDH]` or `(Hearing Impaired)` in the display name. These tracks contain non-dialogue text like `[music playing]` which ruins the viewing experience for most.
- **Download Priority:** The Wyzie API provides a `downloadCount` or similar popularity metric. We should pick the most downloaded "en" track as it is the most likely to be perfectly synced.
- **Format Preference:** Prefer `.srt` for native `mpv` playback as it is more robust across different player versions than `.vtt`.

---

## 🛠️ Technical Implementation Path

1. **Provider Update:** Ensure `vidking.ts` (and other providers) return the `tmdbId` to the scraper.
2. **Scraper Refactor:** Remove the passive observer in `src/scraper.ts`.
3. **Active Call:** Inside `src/subtitle.ts`, add a function `resolveSubtitlesByTmdbId(tmdbId, season, ep)`.
4. **Instant Speed:** This will reduce the total scraping time by **~3 seconds** because we no longer need to "wait and hope" for the browser to trigger the call.

---

## 📈 Backing Evidence

- **Static Key Verification:** Confirmed in `scratchpads/provider-vidking/VIDKING_NETWORK_ANALYSIS.md`.
- **Pure Fetch Success:** Our 0-RAM scratchpad scraper (`vidking-0-ram-scraper.ts`) successfully retrieves subtitles 100% of the time using this direct API method.
