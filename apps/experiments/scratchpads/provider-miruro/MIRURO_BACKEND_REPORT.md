# Miruro Reverse-Engineering & Backend Report

> **Evidence update (2026-05-25):** Live probe `probe-evidence-2026.ts` shows production `PIPE_KEY` still decodes pipe episodes (1163 for AniList 21). `theanimecommunity.com` episode URL returns only `{ mediaItemID }`, not HLS. Treat §2 “Holy Grail” as **stale/unverified** until a second endpoint yields playable URLs. Current production truth remains Miruro's `/api/secure/pipe` path on the official domains that respond from this egress.

> **Latency audit update (2026-05-25):** Official mirrors `miruro.bz` and `miruro.ru` respond to the pipe endpoint shape while `miruro.tv`, `www.miruro.tv`, and `miruro.to` can close Bun fetch sockets. Pipe inventory can be fast, but direct `uwucdn` / `owocdn` HLS playback currently returns HTTP 403 outside the browser player path in the lab. Do not treat a working browser watch page as proof of direct mpv-compatible playback.

## Overview
This report details the successful reverse-engineering of **Miruro.tv**. 
We initially built a Hybrid Scraper (Playwright + Node Decryption) to bypass their frontend Cloudflare protections, but further research discovered that Miruro is merely a UI wrapper for a massive, unprotected 3rd-party database.

---

## 1. The Frontend (Hybrid Approach)
Miruro is heavily protected by Cloudflare Turnstile and TLS fingerprinting. A raw Node.js `fetch()` to their homepage or search bar will instantly return `403 Forbidden` or drop the socket (`ECONNRESET`).

### The API & Decryption
If Playwright is used to clear Cloudflare, the frontend fetches data from an internal API:
`GET /api/secure/pipe?e={Base64URL_Payload}`

The response from this API is heavily obfuscated. We successfully ported the decryption logic to pure TypeScript (`miruro-decrypt.ts` and `miruro-0-ram-scraper.ts`):
1. **The Key:** The site uses a static key derived from their environment variables: `VITE_PIPE_OBF_KEY = 71951034f8fbcf53d89db52ceb3dc22c`.
2. **The Algorithm:** The response is Base64 decoded, and then a rolling bitwise XOR cipher is applied using the hex bytes of the `PIPE_KEY`.
3. **The Compression:** If the resulting decrypted bytes start with the magic numbers `31, 139`, the payload is compressed using **Gzip** and must be decompressed via Node's `zlib.gunzipSync()` before parsing the final JSON.

---

## 2. The Holy Grail (The Backend Discovery)
During an aggressive deep-sniffing session (`backend-hunt.ts`), we monitored all XHR requests fired *after* Cloudflare was bypassed. 

We discovered a silent request made directly to a 3rd-party database:
`GET theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID=21&mediaType=anime&episodeChapterNumber=1`

### What this means for Kunai:
1. **Miruro does not use proprietary internal IDs.** Their backend natively accepts standard **AniList IDs** (e.g., `21` for One Piece). 
2. **We can bypass search.** We do not need to scrape Miruro's search bar or map slugs. If a user clicks an anime in Kunai's UI, we already know the AniList ID, and we can immediately construct the episode fetch URL.
3. **The Raw Streams:** The final stream returned by this backend is a direct, uncompressed Apple HLS Playlist (`.m3u8`) hosted on massive CDNs like `pro.ultracloud.cc` or `bold-cdn.noahwilliams911.workers.dev`.
4. **The Ultimate Strategy:** We can completely abandon the slow Playwright scraper and hit `theanimecommunity.com` directly. This turns Miruro from a heavy "Hybrid" provider into a blazing fast, "True 0-RAM" native provider.

---

## 3. Integration Requirements for `@kunai/scraper-core`
When porting this provider to the main app:
- **Mode:** `True 0-RAM` (Direct Backend API).
- **Identifier:** `AniList ID`.
- **Quality Extraction:** The backend returns multiple qualities (360p, 720p, 1080p). The parser must select the highest resolution available.
- **Headers:** The `.m3u8` CDNs strictly require a `Referer` header matching the streaming site (e.g., `https://www.miruro.tv/`) or the request will return `403 Forbidden`. Ensure this is passed to `mpv` via `--referrer=...`.
