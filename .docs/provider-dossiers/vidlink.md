---
status: current
lastReviewed: "2026-09-29"
---

# Provider: VidLink (`vidlink`)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Summary

- **Runtime class:** direct HTTP resolve by TMDB id — no own search or episode
  list; identity arrives from the TMDB lane.
- **Production module:** `packages/providers/src/vidlink/*` (in
  `loadProductionProviderModules()`).
- **Shape:** `resolveDirectStreamSource` shared engine + `providerFetch`.
- **Relay:** `relaySafe`, upstreams `vidlink.pro` + `enc-dec.app`.

## Request contract

- Encrypt the TMDB id through `GET https://enc-dec.app/api/enc-vidlink?text=<id>`
  (30 min memo, 256-entry cap, TTL from receive time).
- Fetch `https://vidlink.pro/api/b/<type>/<encryptedId>` with
  `referer: https://vidlink.pro/`, `origin: https://vidlink.pro`, desktop UA, and
  `x-playback-environment: webkit`.
- `webkit` is load-bearing: it selects the DASH manifest on
  `sacdn.hakunaymatata.com` whose CloudFront signed cookies arrive in the
  payload's `playlistHeaders` — those headers must reach the player, or the
  manifest 403s. The `file` lane (`bcdn.hakunaymatata.com` MP4s) is flagged
  `requiresProxy` upstream and answers 429 to non-browser clients; do not
  "simplify" to it.
- Payload carries `stream.qualities` (per-rendition URLs), `captions`
  (provider subtitles), and `playbackMetadata` (codec/resolution hints).
- 20 s per-request timeout, 2 attempts with 500 ms backoff (5xx only sleeps
  inside the try; any error retries once via the catch).

## Failure honesty (post-2026-09-29)

- Non-ok statuses throw `createProviderHttpError` — the status survives as a
  classified `ResolveErrorCode` through `resolveDirectStreamSource`'s unwrap.
  Before that, a plain `Error("HTTP N")` was flattened to `network-error` /
  `retryable: true` twice (once at throw, once in the shared catch), so a 404
  title and a dead host looked identical and every blip retried.
- "enc-dec.app did not return an encrypted id" remains a generic error — the
  upstream contract is `{result}` and nothing else distinguishes drift from a
  bad id today.

## Known gaps

- No dossier-grade live recordings yet (this file is a contract summary, not a
  wire capture — the hianime dossier shows the depth a real session log adds).
- enc-dec.app is a single external dependency for the id-encryption step; its
  outage degrades the provider to nothing — fallback providers cover it.
