# Miruro harvest 2026-10-13 — player chain mapped (strm.cx + embed bridge)

Method: headless Chromium (Playwright), search-driven navigation
(`box.fill("one piece")` → first `/watch` result → `?ep=1`), request/response
interception. Two runs: URL-shape capture, then response-body capture
(redacted). No production code; decision gate in the dossier still holds —
module stays at the anime tail until a fetch-only replicate lands.

## Route shapes (first-party, all HTTP 200)

- Watch route: `/watch/{obfuscatedId}/{slug}?ep=N`. The id is an opaque
  per-title token, NOT an AniList id; direct `/watch/21` renders the homepage
  shell (ruled out, two runs). Search returns the token:
  `GET /api/v1/anime?q=<query>&limit=5&sort=-popularity`.
- Show bootstrap: `GET /api/v1/anime/{id}`, `/show`,
  `/episodes?limit=10000`, `/relations`, `/recommendations`.
- Play entry: `GET /api/v1/anime/{id}/episodes/{n}/play` → 200 with a
  compressed (gzip/deflate) payload. Not yet decompressed — that is the next
  step; it likely names the embed source.

## Player chain (third-party)

- `https://strm.cx/?embed=1` mounts as the player iframe (vidstack assets).
- `GET https://strm.cx/client.js` is a postMessage bridge (`strmcx/v1`
  protocol: ready/state/time/duration/ended/error/next/previous requests;
  source kinds `direct` and `playlist`). No secrets in it.
- `POST https://strm.cx/v1/embeds` → 204 (analytics beacon).
- `theanimecommunity.com/embed.js` → `/embed-widget` iframe (sibling frame).
- `GET theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID=<id>&mediaType=anime&episodeChapterNumber=<n>`
  → clean JSON `{"mediaItemID": <number>}`. This is the episode→source mapping.
- Thumbnails via `vault-N.keeply.top` hosts (image CDN role, not streams).

## Honest negatives

- The player showed its error state on both runs (`player-error.webp`
  fetched); no media URL (m3u8/mp4) was observed, so nothing here is a stream
  yet. Server picker (`Sub`, episode list) renders — `Sub`/`EP 1` clicks did
  not change the outcome in headless mode.
- No `/api/secure/pipe` traffic anywhere (consistent with pipe removal).

## Next step (one run)

Decompress the `/play` payload, then trace embed-widget → mediaItemID →
source to the first media URL. After that: fetch-only replicate of
`/play` + embeds POST, `verifyCandidateStream` on the candidate with the
shipped headers, and an mpv frame proof — the dossier's re-add gate.

## Breakthrough (same day, follow-up runs) — API decode cracked

- The shared fetch client (`assets/Button-*.js`) decodes every
  `application/octet-stream` API body as: raw bytes XOR repeating key
  `miruro/catalog` (UTF-8) → gzip decompress → JSON. Verified locally
  against live `/api/v1/anime?q=`: magic `1f 8b` after XOR, valid JSON
  with `data[]` carrying obfuscated ids plus full `external_ids`
  (anilist/mal/tmdb/etc).
- Search → One Piece maps to its obfuscated id via `external_ids.anilist`.
- `GET /api/v1/anime/{id}/episodes/{n}/play` → `tracks[]`
  (`sub`/`dub`/`ssub`), each with `providers[]` (6 seen: animepahe,
  animegg, aniwaves, anikoto, icarus, kickassanime), each with `servers[]`
  carrying per-server `headers` (Referer) and `streams[]` (url/format/
  quality/resolution/codec + embed url). 21 streams for One Piece E1.
- Gate evidence, One Piece E1 animepahe 1080p HLS: ranged GET with the
  shipped Referer → 206 + valid `#EXTM3U` VOD (AES-128 segments, which
  mpv handles natively); mpv headless 30 frames exit 0.
- Proxy builder (same WatchRoute chunk): `VITE_PROXY_OBF_KEY` XOR +
  base64url with path suffixes `/pl.m3u8`, `/sub.vtt`, `/seg.jpg` —
  the keeply proxy URL shape for playlists, subtitles, segments.
- Raw payloads kept out of the repo (home-disk scratch only); unit
  fixtures for any revival must be synthetic.
- Revival shape (for whoever implements it — manifest/mirrors are being
  touched in another in-flight change, so no code here): search → map
  anilist → `/play(n)` → sub/dub track → provider order → per-server
  headers → `verifyCandidateStream` per candidate (bounded: ~21) →
  return verified. The old coverage exemption ("per-candidate budget
  cannot contain a probe") is stale against this API and should retire
  with the rewrite. Keep the tail priority until the new path proves
  stable; priority reorder is a separate product call.
