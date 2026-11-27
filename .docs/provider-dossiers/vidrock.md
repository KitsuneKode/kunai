---
status: current
lastReviewed: "2026-11-27"
---

# Provider: VidRock

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Live capability audit (2026-11-27)

**Status: broken for playback despite API resolution.** Do not read a
`resolved` result here as a working stream: the resolve gate did not positively
verify these cases, and independent probes refused them.

- Fixture coverage: Inception, Fight Club, Breaking Bad S01E01, Dutton Ranch
  S01E01.
- Result: 4/4 API resolves returned streams, but 0/4 independently probed
  selected streams were reachable; probes answered HTTP 502. mpv exited without
  writing a decode frame.
- Inventory: 4-7 named servers per case (`Astra`, `Atlas`, `Elara`, `Lyra`,
  plus case-specific rows), with advertised audio labels `en`, `hi`, and `ta`;
  no quality rank, dynamic-range, or subtitle inventory was exposed.
- Resolve latency was 3.43-4.54 s.
- Actual attempted media dependencies: `cdn.ngcloud.app`,
  `cdn2.ngcloud.app`, `img1.hscow.com`, and `img1.fcxmb.com`.
- Disposition: keep registered but demoted behind VidLink, Movy, and
  Rivestream. No deterministic adapter fix was established; the measured
  failure is upstream media delivery.

## Production status (2026-11-24)

The November 23 hosted sweep reached the site and received HTTP 403 from
its configured `vidrock.net` API. On November 24 the same API returned
HTTP 200 JSON locally for the sweep's Fight Club fixture. The production
adapter resolved six probe-accepted streams for that movie and seven for
Breaking Bad S01E01. This qualifies local resolution. Hosted egress and
decoded playback are still unverified.

VidRock [announced a move from `vidrock.ru`](https://vidrock.ru/) to
[`vidrock.to`](https://vidrock.to/). The public move notice names the old
`.ru` host, and the configured `.net` API still works from this network.
There is no confirmed request or response change to apply to Kunai's adapter.

## Summary

- **Media kinds:** Movies, TV Series (TMDB-keyed).
- **Search support:** No (resolve-only — TMDB id goes straight into the API path).
- **Episode catalog support:** No.
- **Stream resolve support:** Yes. `GET https://vidrock.net/api/movie/{tmdbId}` /
  `GET https://vidrock.net/api/tv/{tmdbId}/{season}/{episode}` answers a JSON
  map of server lanes; each lane's `url` is a base64url blob of
  `iv(12) ‖ AES-256-GCM(ciphertext)` decrypting to a direct stream URL.
- **Crypto:** AES-256-GCM, 256-bit key recovered from the site's player bundle
  (`vidrock.net/assets/index-*.js`, hex constant `7f3e9c…`). Key is shared
  site-wide; the per-lane IV rides inside the ciphertext blob.
- **Language/audio/subtitle model:** Lane entries carry `language`/`flag`
  (e.g. `"English"`/`"us"`), mapped to `audioLanguages`. Subtitles live on a
  sibling service (`sub.vdrk.site`, v1/v2 endpoints) — not wired into resolve.
- **Server/source model:** ~5 named lanes per title — Nova/Atlas
  (`cdn*.ngcorp.dad`), Luna (`*.workers.dev`), Orion (rotating `.lol`/`.site`
  hosts), Astra (usually null). Lane names remain stream flavor labels within the shared direct source.
- **Quality model:** `/playlist/` lanes return JSON entries with `url` and
  `resolution`; these become quality rows through `qualityHint`. Other lanes are inspected through the bounded, guarded HLS reader, including
  extensionless endpoints. Parsed masters expose real variant URLs; media playlists
  remain one Auto row. A master requiring separate audio remains whole.
- **Known failure modes:** AES key rotation on deploy (decrypt throws → lane
  skipped); gated lanes that only serve real browsers — see below.

## User-Facing Capabilities

| Capability            | Supported | Evidence                                   | Notes                                                                          |
| --------------------- | --------: | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Search                |        no | n/a                                        | Resolve-only; TMDB id is the lookup key.                                       |
| Episode list          |        no | n/a                                        |                                                                                |
| Server switch         |       yes | per-lane stream rows                       | Nova, Atlas, Luna, Orion, Astra.                                               |
| Quality switch        |   partial | JSON playlist `resolution` → `qualityHint` | JSON playlist rows and safely separable HLS variants.                          |
| Audio language switch |       yes | `language`/`flag` lane fields              | `audioLanguages` per row.                                                      |
| Direct mpv playback   |       yes | verified `movie/550` + `tv/1396/1/1`       | Current browser UA, VidRock Referer and Origin; requalify playback separately. |

## Stream headers and manifest evidence

The current adapter sends a browser UA, `Referer: https://vidrock.net/` and
`Origin: https://vidrock.net` on discovery, HLS expansion and the candidate gate.
The old space-UA/no-Referer recommendation is superseded by this request contract.
Opaque worker URLs are not intrinsically HLS: only observed `#EXTM3U` document
bytes establish HLS inventory, never a host suffix or MIME alone. Bounded failures
retain the original unknown candidate for the unchanged resolve gate to judge.
Manifest subtitles and audio languages are retained when present; no external
subtitle service was added.

An isolated, bounded October 24 TMDB 550 movie resolve produced two adaptive Auto
rows plus 1080/800/720/534/360/266 HLS rows, with no sidecar subtitles. Discovery
reported nine populated lane names. The probe succeeded with the current headers;
this is resolve evidence on one Linux host, not a decoded-frame playback test.

## Failure modes

- **`Invalid encrypted URL` (400/403):** lane token invalid or bound to a
  browser session — expected on gated lanes.
- **Key rotation:** `decryptVidrockStreamUrl` throws; the lane is skipped, not
  fatal. If every lane throws, the scheme rotated — recover the new hex
  constant from the site's `index-*.js` (search `AES-GCM`/`importKey`).
- **Empty lane map:** some titles return all-null lanes (brand-new releases).

## History

- Pre-2026-09 adapter used AES-CBC-encrypted item ids in the API path — the
  live API rejects those ids (`Invalid ID`). Replaced by the plain-id +
  per-lane AES-GCM scheme on 2026-09-21.
