---
status: current
lastReviewed: "2026-11-27"
---

# VidBolt dossier

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/providers.mdx`.

## Identity and lane

- Config/provider id: `vidbolt`
- Lane: movies and series
- API origin: `https://vidbolt.pro/api`
- Production adapter: `packages/providers/src/vidbolt/direct.ts`
- Fixture suite: `packages/providers/test/vidbolt-direct.test.ts`

## Reverse-engineered contract

VidBolt is TMDB-addressed:

- `GET /api/resolve?type=movie&id={tmdb}`
- `GET /api/resolve?type=tv&id={tmdb}&season={season}&episode={episode}`
- repeat with `exclude={server1,server2}` to enumerate server slots

Responses are JSON. A stream row carries `server`, `sources[]`, optional embedded HLS master text, optional sidecar `subtitles[]`, `resolvedAt`, and `freshUntil`. The adapter exposes each server as source inventory and each quality as a variant. Embedded master `AUDIO` renditions become audio-language evidence; subtitle renditions and sidecar rows become soft-subtitle candidates.

## Playback constraints found live

Two playback-layer facts matter beyond the JSON API:

- The Orion CDN signs playlist URLs with `api_key`. Its master playlist references child playlists without copying that query. RFC relative-URL resolution drops the parent query, so unsigned child playlist fetches can answer 403 even though the master is 200. Kunai propagates a same-origin `api_key` only to nested playlists in the resolve probe and in the HLS playback materializer; media segments keep ordinary RFC resolution.
- Rousav serves valid MPEG-TS bytes from obfuscated object names such as `.jpg` and `.js`. FFmpeg's extension validation rejects those segment URLs before the demuxer can inspect the bytes. The local HLS relay therefore presents media segments to mpv as `.ts` and caption resources as `.vtt` while preserving the original upstream URL in its encoded target. The audit decode uses the same production playback materializer and relay path as normal playback.

This is the difference between an API-only green and actual playback.

## Live evidence — 2026-11-27

Post-fix capability audit in an isolated profile, using the production playback materializer and local HLS relay:

- Resolve/probe: 3/4 cases resolved and every resolved case independently probed reachable. Fight Club, Breaking Bad S01E01, and Dutton Ranch S01E01 succeeded; Inception hit the balanced 12 s provider-attempt timeout.
- Decode: mpv `--vo=image` wrote `/var/tmp/kunai-batch1-frames/vidbolt-fight-club.png`; the PNG was opened and confirmed as real 1920x1080 video.
- Resolve latency: 10.39-22.32 s because multi-server enumeration is sequential; independent probes took 1.01-1.49 s.
- Inventory: 25 stream rows across servers `orion`, `quantum`, `callisto`, `luna`, and `vega`.
- Qualities measured: 360p, 480p, 720p, and 1080p.
- Audio languages measured across the successful cases: `de/en/es/fr/hi/it/ja/pl/pt/tr`.
- Subtitle languages measured across the successful cases: 31 ISO-normalized languages, including `ar/cs/da/de/el/en/es/fi/fr/he/hu/id/is/it/iw/ja/ko/ms/nb/nl/pl/pt/ro/ru/sv/th/tl/tr/uk/vi/zh`.
- Media hosts measured: `img.rousav.tech`, `gzip.rousav.tech`, `proxy.vidbolt.xyz`, `stream.vidbolt.xyz`, and `sbcdn7.hakunaymatata.com` on the Callisto lane.

VidBolt is decode-proven but remains a fragile tail fallback: one of four audit cases timed out, resolution is much slower than the promoted movie/series lanes, and the Rousav lanes require the signed-playlist and obfuscated-segment handling above.

## Independence assessment

VidBolt's primary Orion/Rousav, Quantum, Luna, and Vega lanes do not overlap the currently measured VidLink, Movy, Rivestream, VidRock, or Videasy video hosts. The Callisto lane uses `sbcdn7.hakunaymatata.com`, so it overlaps the public Hakuna Matata CDN family also seen in existing provider inventory; treat that lane as shared infrastructure rather than independent capacity. Overall VidBolt still adds a materially independent movie/series lane through Orion/Rousav and VidBolt's own proxy hosts, but not every enumerated server is independent.
