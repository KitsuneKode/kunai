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
