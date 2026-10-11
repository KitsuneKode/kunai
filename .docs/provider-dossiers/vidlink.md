---
status: current
lastReviewed: "2026-10-04"
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
- The 2026-09-29 delivery contract used `webkit` to select the DASH manifest on
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

- Live default-route qualification on 2026-10-04 at `b8c69881745430ea3a8ca43e7af3f7a650d0acd5`
  failed for both TMDB lanes from the review host. Dune (438631) returned HTTP 200
  without a usable stream. Dutton Ranch (299167), season 1 episode 1, returned a
  `file` stream with qualities 360/480/720/1080 and no playlist or playlist headers,
  despite the unchanged `x-playback-environment: webkit` request. Its selected media
  probe returned HTTP 429. A second isolated production-engine resolve reproduced
  both failures; a schema-only fetch observation confirmed the API response shapes.
  This is evidence from one host, not a global outage or proof of an API repair.
- Do not turn the refusal into success, add a media relay, or silently switch the
  default to make signoff green. Requalify the delivery contract and any proposed
  alternative on the actual supported routes and regions before changing defaults.
- No dossier-grade wire capture yet; the observations above omit signed URLs,
  cookies and response bodies. The hianime dossier shows the depth a real session
  log adds.
- enc-dec.app is a single external dependency for the id-encryption step; its
  outage degrades the provider to nothing — fallback providers cover it.
