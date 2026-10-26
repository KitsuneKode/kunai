---
status: current
lastReviewed: "2026-10-27"
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
- 20 s per-request timeout, at most 2 attempts. A 429 `Retry-After` is
  parsed as delta-seconds or an HTTP-date without shortening its window.
  Windows up to 10 s are awaited before an inline retry; longer windows
  immediately exhaust this resolve as `rate-limited` so provider fallback can
  proceed without an early second request. A missing or invalid header keeps
  the 500 ms retry spacing. Both API and enc-dec paths dispose rejected response
  bodies before waiting or falling back. This bounds inline retries; it does
  not establish a shared cooldown across independent resolve contexts.
  5xx keeps the fixed 500 ms sleep; other statuses throw after recording.
  HTTP semantics: [RFC 9110, Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after).

## Failure honesty (post-2026-09-29)

- Non-ok statuses throw `createProviderHttpError` — the status survives as a
  classified `ResolveErrorCode` through `resolveDirectStreamSource`'s unwrap.
  Before that, a plain `Error("HTTP N")` was flattened to `network-error` /
  `retryable: true` twice (once at throw, once in the shared catch), so a 404
  title and a dead host looked identical and every blip retried.
- A successful enc-dec response without `result` is `parse-failed`,
  non-retryable response-shape drift, rather than a network fault.

## Known gaps

- A bounded comparison on 2026-10-26 UTC reproduced Dune (438631) returning
  HTTP 200 with JSON `null`, both with the production `webkit` header and with
  that header omitted. The same encryption and movie request path returned DASH
  manifests and 15 captions for Fight Club (550) and Inception (27205). This
  narrows the observed failure to a title-specific upstream no-source response;
  it is not evidence that the encryption or entire movie endpoint is broken.
  No response-shape workaround, default change or resolve-gate bypass was added.
  The strict default-movie signoff remains red until that route is qualified.

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

## Adaptive quality inventory (2026-10-24)

A remote DASH MPD remains one `auto` stream. `playbackMetadata.resolutions`
is a declaration of available renditions, not a representation constraint passed
to playback. The existing deferred MPD materializer handles AllManga Ak descriptors;
it does not filter VidLink's remote MPD. Do not duplicate the same URL at several
qualities or append virtual fragments: neither selects a DASH representation.
Per-file quality URLs and safe HLS variant URLs remain separate selectable rows.

A bounded isolated TMDB 550 movie resolve on October 24 returned DASH, declared
720/480, 15 subtitles and one Auto stream through the unchanged candidate gate.
This confirms the current request/resolve path on one Linux host, not decoded
playback or the availability of 1080p on other titles. Signed URLs and cookies
were omitted from retained evidence.
