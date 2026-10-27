---
status: current
lastReviewed: "2026-10-26"
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

## HLS inventory recovery (2026-10-24)

Lane `sources` containing HLS are expanded through the shared bounded, guarded
manifest reader. Safely separable variants carry distinct real URLs, quality rows
and the same lane identity and headers through the normal candidate gate.
Masters requiring separate audio remain one Auto stream. Manifest audio languages
and subtitle renditions survive even when the lane's `subtitles` array is empty;
sidecar and manifest duplicates collapse by URL. Source switching still resolves
the requested lane; it does not advertise other lanes as already playable.

The research suggestion to query `subtitles.vidy.st/search` remains unverified.
Primary asset retrieval did not establish that endpoint or its alleged response
schema; no external subtitle host or search endpoint was added. The confirmed
missing seam is HLS manifest inventory, not proof that every title has subtitles.

An isolated, bounded October 24 TMDB 550 movie resolve returned a real
2160/1080/720/480 HLS ladder and zero subtitles through the unchanged resolve
gate. The deterministic encrypted-payload fixture separately proves recovery
of manifest-only subtitles and exact variant URLs. Neither is a decoded-frame
playback qualification, and no signed URLs or seeds are retained in reports.

## Mislabeled segment MIME recovery

The shared HLS probe accepts a `text/html` segment only when its bounded prefix
contains three MPEG-TS sync bytes at 188-byte packet boundaries. A single ASCII
`G`, an HTML error page, and an undersized body remain failures. The probe captures
only the required 1 KiB prefix and cancels the body even if Range is ignored; it
does not buffer full segments or bypass HTTP, redirect, DNS, or candidate gates.
Fixture coverage establishes this exception and bounded reading, not current live
Movy playback or support for every container mislabeled as HTML.

The HTML MIME exception also recognizes a complete, bounded fMP4 movie fragment
with `mfhd`, `traf`/`tfhd`, `tfdt` and `trun` boxes followed by a nonempty `mdat`
prefix. Declared child sizes and relative sample offsets must fit the captured
fragment; media payload may extend beyond it. A bare `ftyp` marker, malformed
boxes, missing decode time, and an incomplete `moof` do not qualify. Recognition
requests at most 64 KiB and captures that larger prefix only for HTML-labeled
responses. Ordinary segments retain the 1 KiB minimum/read; positive TS or fMP4
evidence can cancel an HTML-labeled read early. All reads cancel at their cap
even if the server ignores Range. Metadata beyond 64 KiB remains unsupported;
this does not claim full container conformance or remote frame decoding. A locally generated
HLS fMP4 fixture was separately decoded by ffmpeg and passed this MIME check.
The segment layout follows [W3C's ISO BMFF media-segment definition](https://www.w3.org/TR/mse-byte-stream-format-isobmff/#media-segments).
