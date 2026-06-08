# Cineplay (ex-Bitcine) playback research — 2026-06-08

## RAM note (why earlier probes spiked memory)

Avoid these in automated loops:

| Pattern                                                     | Impact                                           |
| ----------------------------------------------------------- | ------------------------------------------------ |
| Concatenating all `/_next/static/chunks/*.js` into one file | ~1MB+ held in Node/Bun heap per run              |
| `eval()` of Cineplay WASM `serve()` (~112KB anti-tamper JS) | Large VM + retained closures                     |
| Playwright headless on Cloudflare-fronted pages             | Full Chromium (~200MB+), often no useful capture |
| Parallel Videasy fetches with 90–120s timeouts              | Many hung sockets; swap pressure when combined   |

Use `light-probe.ts` instead: **one server at a time**, **25s timeout**, optional `--decrypt`.

## Domain / product

- **Old:** `bitcine.tv` → **New:** `cineplay.to`
- Same Videasy backend (`api.videasy.to`), app id **`bc-frontend`**
- UI server names unchanged (Neon, Yoru, Cypher, …)

## Root cause: website works, Kunai/mpv fails

### 1. Wrong referer/origin (primary for mpv)

Kunai sent `origin: https://www.vidking.net` + `referer: https://www.vidking.net/` even when
`videasyAppId` was `bc-frontend`. Cineplay CDNs expect **`https://www.cineplay.to`** on both API
and segment requests.

**Fix landed:** `resolveVideasyClientProfile()` in `packages/providers/src/vidking/direct.ts`
switches origin/referer/stream headers when app id is `bc-frontend`.

### 2. Neon endpoint rename on Cineplay (secondary)

Cineplay player bundle calls **`/e3b0c442/sources-with-title`** for Neon, not `/mb-flix/`.
Legacy `mb-flix` still responds for some titles (e.g. Study Group `tmdb=233347`) with Cineplay
referer; other titles return HTTP 500 on both routes.

| Probe (light-probe)    | `276161` (Teach You a Lesson) | `233347` (Study Group)     |
| ---------------------- | ----------------------------- | -------------------------- |
| `e3b0c442` (Neon)      | HTTP 500                      | decrypt error / short body |
| `mb-flix`              | HTTP 500                      | HTTP 200, 3 sources        |
| `downloader2` (Cypher) | HTTP 200, 3 sources           | timeout                    |

**Action:** keep flavor map; consider Neon fallback `e3b0c442` → `mb-flix` when `bc-frontend`.

### 3. Session token (guarded API)

Without `x-session-token` + `x-app-id: bc-frontend`, some routes error or rate-limit.
Mint with:

```sh
cd apps/experiments
bun scripts/videasy-attended-mint.ts cineplay tv 233347 1 1
```

Settings: **Videasy app id** → `bc-frontend`, paste token from DevTools.

### 4. Decrypt stack

Cineplay bundle references `b35ebba4` + `/module.wasm` with `window.hash` anti-tamper.
**Practical finding:** with Cineplay referer, **`downloader2` / `mb-flix` payloads still decode
with existing VidKing WASM + empty AES key** (same as legacy path). No separate decrypt port
required for those servers today.

### 5. TMDB id on URL

`https://www.cineplay.to/tv/276161` → TMDB **Teach You a Lesson**, not Study Group.
Study Group ≈ **`tmdb=233347`**. Wrong id → wrong upstream scrape → empty/500 sources.

## mpv checklist

1. `/settings` → **Videasy app id** = `bc-frontend`
2. Mint session on **cineplay.to** (not bitcine.tv)
3. Pick server that resolves (Cypher/downloader2 if Neon fails)
4. After fix: stream headers should carry `referer: https://www.cineplay.to/tv/...`
5. **Luffy / `light.goldweather.net`:** manifests are ~300KB VOD playlists with host-root
   segment paths (`/token/.../seg.jpg`). FFmpeg's HLS demuxer only probes the first 128KB over
   HTTP and misparses segment URLs (404 / infinite buffer). Kunai materializes the full manifest
   to a local `.m3u8` with absolutized segment URLs before mpv launch
   (`apps/cli/src/infra/player/hls-manifest-materializer.ts`). mpv also needs `--ytdl=no` on HLS.

## Lightweight repro

```sh
cd apps/experiments
bun scratchpads/provider-cineplay/light-probe.ts          # API only
bun scratchpads/provider-cineplay/light-probe.ts --decrypt 233347
```
