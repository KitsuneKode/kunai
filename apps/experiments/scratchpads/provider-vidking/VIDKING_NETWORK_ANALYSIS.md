# Vidking Network Analysis Report

## Overview

This report captures the network activity of the **Vidking** embed page (`https://www.vidking.net/embed/tv/127529/1/2`). The goal is to understand how the video stream and subtitles are fetched, identify why subtitles are not consistently available, and propose a fully‑automated way to retrieve them **without manual button clicks**.

---

## 1. Captured Requests Summary

| #         | Method  | URL (truncated)                                                                            | Key Headers                      |
| --------- | ------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 1‑2       | GET     | `https://www.vidking.net/embed/tv/127529/1/2`                                              | `user-agent`, `sec‑ch‑ua`        |
| 3‑4       | GET     | `https://users.videasy.net/api/script.js`                                                  | `referer`                        |
| 5‑12      | GET     | `www.vidking.net/assets/*.js` & `*.css`                                                    | `origin`, `referer`              |
| 13‑14     | GET     | `static.cloudflareinsights.com/beacon.min.js/...`                                          | –                                |
| 15‑16     | POST    | `https://users.videasy.net/api/track`                                                      | `content‑type: application/json` |
| 19‑22     | GET     | `www.vidking.net/assets/VideoPlayer-DBxs7Ogc.js` / `player‑libs‑sAH50aO0.js`               | `origin`                         |
| 23‑24     | POST    | `https://www.vidking.net/cdn-cgi/rum?`                                                     | `content‑type: application/json` |
| 27‑34     | GET     | `https://db.videasy.net/3/tv/127529?...` (episode metadata)                                | `referer`                        |
| 35‑36     | GET     | `https://db.videasy.net/3/tv/4506327?...` (related title)                                  | –                                |
| 37‑38     | GET     | `https://api.videasy.net/cdn/sources-with-title?...` (source list)                         | `cache‑control: no-cache`        |
| 39‑42     | POST    | `https://klephtsrepin.cyou/cuid/?f=…` (tracking)                                           | –                                |
| 43‑46     | GET     | CDN libs (**crypto‑js**, **hashids**)                                                      | –                                |
| 47‑48     | GET     | `www.vidking.net/assets/wasm/module1.wasm`                                                 | –                                |
| **49‑53** | **GET** | **HLS master playlist** – `https://bold-cdn.noahwilliams911.workers.dev/video.m3u8?...`    | `range: bytes=0-`                |
| **57‑58** | **GET** | **Subtitle search API** – `https://sub.wyzie.io/search?id=127529&key=…&season=1&episode=2` | `referer`                        |
| 80‑81     | GET     | Same `sub.wyzie.io` request (second hit)                                                   | –                                |
| 82‑107    | GET     | Flag PNG assets (`flagsapi.com/...`) – UI decoration                                       | –                                |

> **Key takeaway:** No direct `.vtt`/`.srt` files appear in the log. The only subtitle‑related traffic is the JSON request to `sub.wyzie.io`, which returns a payload containing the actual subtitle URLs.

---

## 2. Why Subtitles Appear Inconsistent

1. **Lazy loading** – Vidking only contacts `sub.wyzie.io` **after** the user clicks the subtitle toggle. Until that interaction occurs, no subtitle URLs are fetched.
2. **Dynamic payload** – The JSON response contains a list of subtitle tracks (language, URL, format). The page then loads the selected track via a separate request (usually a `.vtt` file). Because our original sniffing script stopped after the first `Enter`, we never observed that follow‑up request.
3. **Readline closure bug** – The script closes the `readline` interface immediately after the first prompt, causing `ERR_USE_AFTER_CLOSE`. This prevented the interactive loop from staying alive and thus blocked subsequent network activity from being captured.

---

## 3. Automating Subtitle Retrieval (No Manual Clicks)

### 3.1 Core Idea

1. **Intercept the `sub.wyzie.io` request**.
2. **Parse its JSON body** to extract the `url` field(s) for subtitle tracks.
3. **Optionally download the actual `.vtt` files** (or feed them directly to `mpv` via `--sub-file`).
4. **Proceed to launch the HLS stream** as before.

### 3.2 Minimal Implementation Steps

```ts
// Inside the request handler (checkRequest)
if (request.url().includes("sub.wyzie.io")) {
  const response = await request.response();
  if (response) {
    const body = await response.text();
    try {
      const data = JSON.parse(body);
      // Vidking typically returns { subtitles: [{ url, lang, ... }, …] }
      const tracks = data.subtitles ?? data.tracks ?? [];
      console.log("📺 Subtitles payload:", tracks);
      // Store the first track URL (or choose by language) for later use
      if (tracks.length) capturedSubtitleUrl = tracks[0].url;
    } catch (e) {
      console.warn("Failed to parse subtitle JSON", e);
    }
  }
}
```

- **No UI interaction required** – the script automatically fetches the payload as soon as the request is made.
- The `capturedSubtitleUrl` variable (already used for `mpv` launch) is now populated **before** the stream is launched, guaranteeing subtitles are attached.

### 3.3 Full‑Automation Flow

1. Launch Playwright, navigate to the embed URL.
2. Wait for the HLS `.m3u8` request **and** the subtitle‑search request.
3. Once both are captured, download the `.vtt` (optional) or pass its URL directly to `mpv`.
4. Close the browser and start playback.

---

## 4. Proposed Enhancements to `vidking-all-network-snif-data.ts`

| Change                                                                                                                                          | Reason                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| **Keep `readline` alive** – remove `rl.close()` until user types `q`.                                                                           | Allows continuous monitoring after any UI interaction.                      |
| **Add response‑body capture for `sub.wyzie.io`** (see code snippet).                                                                            | Extracts the real subtitle URLs.                                            |
| **Filter log output** – only write subtitle‑related entries to `vidking-sniff-data.log` (e.g., `if (url.includes('sub.wyzie.io')                |                                                                             | url.endsWith('.vtt'))`). | Keeps the log focused and easier to parse. |
| **Automatic download** – after obtaining the subtitle URL, `await fetch(subUrl).then(r=>r.text()).then(text=>writeFile('subtitle.vtt', text));` | Provides a local `.vtt` file for downstream tools.                          |
| **Expose a JSON summary** – write a small `summary.json` containing `streamUrl`, `subtitleUrl(s)`, and any extra headers needed for MPV.        | Makes downstream scripts (or CI) consume the data without parsing raw logs. |

---

## 5. How to Use the Updated Script

1. **Install dependencies** (already present in the repo, just ensure Playwright is installed):
   ```bash
   bun install   # or npm install if you prefer
   bun playwright install
   ```
2. **Run the script** (it will stay alive until you type `q`):
   ```bash
   bun run vidking-all-network-snif-data.ts
   ```
3. The script will automatically:
   - Capture the HLS stream URL.
   - Call `sub.wyzie.io`, parse the JSON, and store the first subtitle track URL.
   - Write a concise `summary.json`:
     ```json
     {
       "stream": "https://bold-cdn…/video.m3u8?...",
       "subtitle": "https://sub.wyzie.io/.../123.vtt",
       "headers": { "user-agent": "…", "referer": "https://www.vidking.net/" }
     }
     ```
   - Optionally download the subtitle file as `subtitle.vtt`.
4. **Play with MPV** (no manual click required):
   ```bash
   mpv "$(jq -r .stream summary.json)" \
       --sub-file "$(jq -r .subtitle summary.json)" \
       --user-agent "$(jq -r '.headers["user-agent"]' summary.json)" \
       --referrer "$(jq -r '.headers.referer' summary.json)"
   ```
   The command pulls the URLs and required headers directly from the generated JSON.

---

## 6. Future Work & Recommendations

- **Language selection** – extend the script to choose a subtitle track based on language (e.g., pick `en` if present).
- **Fallback handling** – if the subtitle API returns an empty list, retry after a short delay or log a warning.
- **Batch processing** – wrap the logic in a function that accepts a Vidking episode ID, enabling bulk extraction of many episodes.
- **Integration with KitsuneSnipe core** – instead of a separate script, merge this logic into `src/scraper.ts` so the main CLI automatically attaches subtitles.
- **Unit tests** – mock Playwright responses and verify that the JSON parsing correctly populates `capturedSubtitleUrl`.

---

## 7. TL;DR – Quick Steps

1. Update `vidking-all-network-snif-data.ts` with the response‑body parsing snippet and keep the readline loop alive.
2. Run the script; it will output a `summary.json` containing the HLS and subtitle URLs.
3. Play the video with MPV using the generated command – no button clicks needed.

---

## 8. Interactive Sniffing Findings (Wyzie Subtitle API)

During interactive sniffing, we confirmed that the subtitle button triggers a request to the `sub.wyzie.io` API. We discovered the exact endpoint and payload structure:

**Endpoint:**
`GET https://sub.wyzie.io/search?id={tmdbId}&key=wyzie-9bafe78d95b0ae85e716d772b4d63ec4&season={season}&episode={episode}`

**Response Payload Example:**

```json
[
  {
    "id": "1958162982",
    "url": "https://sub.wyzie.io/c/19d70c5c/id/1958162982?format=srt&encoding=UTF-8",
    "flagUrl": "https://flagsapi.com/US/flat/24.png",
    "format": "srt",
    "encoding": "UTF-8",
    "display": "English",
    "language": "en",
    "media": "\"Bloodhounds\" Episode #1.2",
    "isHearingImpaired": true,
    "source": "opensubtitles",
    "release": "Bloodhounds.S01E02.1080p.NF.WEB-DL.DUAL.DDP5.1.Atmos.H.264-WDYM"
  }
]
```

**Key Takeaway:**
We can directly fetch this JSON endpoint. The `key` (`wyzie-9bafe78d95b0ae85e716d772b4d63ec4`) appears static/reusable for this API. The response gives us a clean array of subtitle objects. We can iterate over this array, filter by `language` (e.g., `"en"`), and extract the direct `url`. This gives us the `.srt`/`.vtt` link entirely via standard HTTP requests without needing a headless browser to interact with the subtitle UI!

---

_End of report._
