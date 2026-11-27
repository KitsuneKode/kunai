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

## Playback constraint found live

The Orion CDN signs playlist URLs with `api_key`. Its master playlist references child playlists without copying that query. RFC relative-URL resolution drops the parent query, so unsigned child playlist fetches can answer 403 even though the master is 200. Kunai now propagates a same-origin `api_key` only to nested playlists in the resolve probe and in the HLS playback materializer; media segments keep ordinary RFC resolution. This is the difference between an API-only green and actual playback.

## Live evidence — 2026-11-27

Fixture-independent live resolve against Fight Club (`tmdb:550`):

- Resolve: `resolved` after the signed-playlist probe fix.
- Probe: shared HLS resolve gate reachable.
- Decode: mpv `--vo=image` wrote `/tmp/kunai-batch1-live/vidbolt-dune-frame/00000001.png` for Dune (`tmdb:438631`) through a credential-propagating local master. The PNG was opened and confirmed as real video; mpv also printed `VO: [image] 1920x1080 yuv420p`, but the PNG is the proof.
- Servers measured on Fight Club: `orion`, `quantum`, `callisto`, `luna`, `vega`.
- Qualities measured: 1080p, 720p, 649p, 480p, 360p.
- Audio languages declared by the Orion master: `de/en/es/fr/it/ja/pl/pt/tr`; other lanes expose title-specific rows such as `uk`, `it/en`, or `hi`.
- Subtitles: Orion HLS renditions `ar/de/en/es`; additional server lanes expose many SRT sidecars through `cacdn.hakunaymatata.com`.
- Media CDNs measured: `img.rousav.tech`, `proxy.vidbolt.xyz`, `proxy.streamrip.fun`, `stream.vidbolt.xyz`.
- Latency in the capability audit: fastest 9.29 s, median 18.58 s because server enumeration is sequential. Three of four cases resolved; Breaking Bad S01E01 decoded at `/tmp/kunai-batch1-live/audit-frames/vidbolt-breaking-bad-s01e01.png`. Fight Club exposed flaky 403s and Inception exhausted during the same sweep, so VidBolt stays a tail fallback rather than a promoted lane.

## Independence assessment

The API and media hosts are not the same media backends as VidLink, Movy, Rivestream, VidRock, or Videasy. Subtitle sidecars can use the shared/public `hakunaymatata` CDN family also seen in existing provider inventory; that is a subtitle CDN overlap, not evidence of a shared video backend. Treat VidBolt as an independent movie/series media lane with overlapping third-party subtitle infrastructure.
