---
status: current
lastReviewed: "2026-09-21"
---

# Provider: VidRock

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

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
  hosts), Astra (usually null). Each lane is a switchable source.
- **Quality model:** HLS ladders on the playlist side; the API exposes no
  per-lane quality label, so rows are one-per-lane and mpv picks rendition.
- **Known failure modes:** AES key rotation on deploy (decrypt throws → lane
  skipped); gated lanes that only serve real browsers — see below.

## User-Facing Capabilities

| Capability            | Supported | Evidence                             | Notes                                                    |
| --------------------- | --------: | ------------------------------------ | -------------------------------------------------------- |
| Search                |        no | n/a                                  | Resolve-only; TMDB id is the lookup key.                 |
| Episode list          |        no | n/a                                  |                                                          |
| Server switch         |       yes | per-lane stream rows                 | Nova, Atlas, Luna, Orion, Astra.                         |
| Quality switch        |        no | API gives no quality labels          | HLS master internals only.                               |
| Audio language switch |       yes | `language`/`flag` lane fields        | `audioLanguages` per row.                                |
| Direct mpv playback   |       yes | verified `movie/550` + `tv/1396/1/1` | Requires the `User-Agent: " "` header trick — see below. |

## The `User-Agent: " "` contract (why streams carry a space)

The ngcorp segment hosts (`p16-sg.tiktokcdn.com` et al.) drop any HTTP request
that carries a **real** User-Agent — curl with `Mozilla/5.0`, `Lavf/*`, or any
nonempty UA hangs; a request with **no** UA header answers 206. ffmpeg always
sends its own UA and cannot omit it, but `mpv --user-agent=" "` (a single
space) propagates to the demuxer and passes the gate. Verified end-to-end:
1080p h264 + AAC demuxed in mpv with only that header set.

The payload therefore ships `headers: { "user-agent": " " }` and **no
Referer** — `Referer: vidrock.net` gets connections to the segment hosts
killed, while ffmpeg's automatic playlist-URL referer is accepted.

Gated lanes (Luna `*.workers.dev`, Orion CF-challenged hosts) additionally
check TLS fingerprint — no header set makes mpv pass. `resolveGateProbe`
filters them at resolve so startup failover doesn't burn attempts on
browser-only lanes.

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
