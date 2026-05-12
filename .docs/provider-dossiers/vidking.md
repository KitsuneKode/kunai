# VidKing Provider Dossier

- **Status:** production
- **Provider ID:** vidking
- **Domain:** www.vidking.net / api.videasy.net
- **Supported content:** movie, series
- **Runtime class:** node fetch (0-RAM)
- **Search support:** External TMDB ID required; no native search.
- **Stream resolution path:** Two-tier: (1) API call to `api.videasy.net/{server}/sources-with-title` + WASM + AES, (2) fallback to `www.vidking.net/embed/tv|movie/{tmdbId}` scrape.
- **Quality/source inventory behavior:** Multiple quality streams from API; single auto-quality from embed scrape.
- **Header/referrer/user-agent requirements:** Browser-like headers including `sec-*` headers, origin, and referer.
- **Cache key and TTL recommendations:** 2 hours for streams, 24h for catalog.
- **Known failure modes:** 504 Gateway Timeout from Videasy backend, Cloudflare challenge on API endpoint.
- **What is proven in production code:** 0-RAM extraction using patched WASM + empty AES key.
- **What is only proven in experiments:** Embed-page HLS extraction (scrape path).
- **Minimum tests/fixtures needed before Provider SDK promotion:** WASM decrypt test, embed scrape fixture.

## Two-Tier Request Strategy

**Tier 1 — API (primary):**

```
GET https://api.videasy.net/{server}/sources-with-title?title=...&mediaType=...&tmdbId=...
Origin: https://www.vidking.net
Referer: https://www.vidking.net/
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-site
```

Returns an encrypted payload that is decrypted in two stages:
1. Patched WASM binary (`module1_patched.wasm`) with TMDB ID as key → base64
2. `crypto-js` AES decrypt with empty string key → JSON

The decrypted JSON contains `sources[]` (URL + quality + type) and `subtitles[]` in various field-name conventions.

Four server endpoints are probed in order: `mb-flix`, `cdn`, `downloader2`, `1movies`.

**Tier 2 — Embed scrape (fallback):**

```
GET https://www.vidking.net/embed/tv|movie/{tmdbId}/{season}/{episode}?autoPlay=true&episodeSelector=false&nextEpisode=false
Accept: text/html,...
Referer: https://www.vidking.net/
```

Extracts HLS URL from HTML via regex:
- `"hls","url":"..."` → stream URL
- `"subtitles":[{"src":"..."}]` → subtitle URL

Used when the API path returns empty or errors for all servers.

## Decryption

### WASM Decrypt
- Binary: `assets/module1_patched.wasm` (263 KB)
- Loads via `@assemblyscript/loader`
- `wasm.decrypt(payloadPointer, tmdbId)` → base64 string
- The WASM `tmdbId` argument is the integer TMDB ID; the Hashids library seen in browser traffic is a decoy/trap.

### AES Decrypt
- `crypto-js` AES decrypt with **empty string key** (`""`)
- Input: base64 from WASM step
- Output: JSON with `sources[]` and `subtitles[]`

## Subtitles

- **Current production subtitle behavior:** Provider-native subtitles merged with Wyzie fallback.
- **Wyzie API:** `sub.wyzie.io/search?id={tmdbId}&key=wyzie-9bafe78d95b0ae85e716d772b4d63ec4&season={s}&episode={e}`
- **CLI adapter:** Calls `resolveSubtitlesByTmdbId()` when provider subtitles don't satisfy preference.
- **Known gap:** Need robust fallback if Wyzie goes down.
