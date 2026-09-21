---
status: current
lastReviewed: "2026-09-21"
---

# Provider: Movy

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Summary

- **Site:** `https://www.movy.sx/` — Next.js frontend.
- **Backend:** `api.wecollege.net` (Fastify), metadata DB at `db.wecollege.net/3`.
- **Media kinds:** Movies, TV series. Anime lane exists (`anikoto/sources-id`) but is unwired.
- **Search support:** No. Resolver-only — catalog identity comes from TMDB.
- **Stream resolve support:** Yes. Multi-lane aggregator: each named lane
  (`denver`, `atlanta`, `phoenix`, `portland`, `seattle`, `miami`, `boise`,
  `paris`, `cancun`, `austin`, `dallas`, `delhi`, `munich`, `orlando`, `tampa`,
  `berlin`) wraps a different upstream scraper (stillhaven, vidzy,
  Cloudflare-worker proxies, ridomovies, idlix, moflix, kinoger, …).
- **Server/source model:** 16 lanes surface as individual sources — server
  switching and cycle failover work per lane. Dead upstreams return per-lane
  HTTP 500s with the scraper name in the message
  (`"dallas: title not found on idlix"`).
- **Audio model:** Multi-language lanes (austin/delhi) return audio labels in
  the `quality` field (`"Hindi"`, `"English"`, `"Tamil"`) — mapped to
  `audioLanguages` so sub/dub-style switching works.
- **Quality model:** Labeled rows (`1080p`, `720p`, `360p`, `Auto`,
  `Auto HLS`, `Auto - Vidara`) plus HLS masters where applicable.
- **Subtitle model:** `subtitles` array in the lane payload (empty for most
  titles today).
- **Known failure modes:** dead upstream scrapers per lane (500s), seed TTL
  expiry (30 s, re-seeded on 401 once), lane coverage gaps for very new titles.

## STREAMCRYPTO wire protocol (enc=2)

```text
GET {api}/seed?mediaId={tmdbId}
  → { "seed": "<u32>.<b64>", "ttlMs": 30000 }

GET {api}/{lane}/sources?title={enc}&mediaType={movie|tv}&year={y}
    &totalSeasons={n}&seasonId={s}&episodeId={e}&tmdbId={tmdb}&imdbId={tt}
    &enc=2&seed={seed}
  → base64url ciphertext

decrypt: XOR keystream keyed by (seed, mediaId) → "mvm1" magic → UTF-8 JSON
  → { "sources": [{ "quality", "url", "type"? }], "subtitles": [...] }
```

The keystream is a custom 32-bit-word generator: seed-length parity picks
between an RC4-style 256-entry KSA s-box (odd) and a sparse 61-entry s-box
seeded by `fmix(FNV-1a(seed) ^ fmix(mediaId ^ 0x9e3779b9))` (even). Port lives
in `packages/providers/src/movy/streamcrypto.ts`; the module is dependency-free.

## Integration notes

- `resolve` gates on a numeric TMDB id; series needs season+episode
  (`seasonId`/`episodeId` params).
- Cycle candidates are built per lane via `buildMovyCycleCandidates` —
  `preferredSourceId` (`source:movy:{lane}`) promotes a lane; hedged/sequential
  cycling and source inventory come from `runProviderCycle` +
  `finalizeCycleSourceInventory`.
- Stream headers: `Referer: https://www.movy.sx/` — verified sufficient for
  stillhaven/vidzy/workers.dev hosts (mpv plays them as-is).
- Seed cache: module-level map, TTL from `ttlMs`, 5 s headroom, 64 entries.

## Verification (2026-09-21)

- `Resident Evil` (TMDB 1423191): 11/16 lanes returned sources; denver/atlanta/
  miami/phoenix/seattle/paris/austin/boise/delhi/portland/berlin alive.
- Real mp4 (stillhaven, 206 + `ftyp`), workers.dev proxied HLS, and
  multi-language lanes (austin: hi/en/ta) all probed live.
- `bun test test/movy-direct.test.ts`: fixture decrypt (real captured
  ciphertext), resolve, lane exhaustion, pinned-source cycle, candidate order —
  all green.
