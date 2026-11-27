---
status: current
lastReviewed: "2026-11-27"
---

# AniLight dossier

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/providers.mdx`.

## Identity and lane

- Config/provider id: `anilight`
- Lane: anime
- Site/API: `https://anilight.live`, `https://api.anilight.live/api`
- Production adapter: `packages/providers/src/anilight/direct.ts`
- Fixture suite: `packages/providers/test/anilight-direct.test.ts`

## Reverse-engineered contract

The frontend bundle uses:

- `/search?q={query}&hideAdult=true`
- `/anime/{slug}`
- `/watch/{id}`
- `/sources?id={id}&episode={episode}&language=sub|dub&backup=true|false&refresh=1`
- source-session verification endpoints that the direct adapter does not need for the recorded playback lane

AniList ids bridge to provider-native numeric ids. Episodes keep provider-native identities. Sub and dub are separate source queries. Source URLs are opaque but are played through the declared media proxy, observed as `https://media.satella.buzz`; the adapter preserves that URL shape rather than inventing a local crypto scheme.

## Live evidence — 2026-11-27

Title: Frieren: Beyond Journey's End, AniList `154587`, provider id `156`, episode 1 sub.

- Resolve: `resolved`, 3 candidates.
- Probe: shared resolve gate reachable.
- Decode: mpv `--vo=image` wrote `/tmp/kunai-batch1-live/audit-frames-r2/anilight-one-piece-e1-sub.png`; opened and confirmed as real 1440x1080 video. A separate Frieren MP4 decode was also confirmed at `/tmp/kunai-batch1-live/manual-frames/anilight/00000001.png` (1920x1080).
- Servers/source labels: `Sub kira`, `Sub misa backup`.
- Qualities: 1080p MP4 plus `auto` HLS backup rows.
- Audio: Japanese for sub. The recorded dub lane was unavailable and the adapter fails closed rather than silently substituting sub.
- Subtitles: soft external captions; the audit measured Arabic, German, English, Spanish, French, Italian, Portuguese, and Russian through `api.anilight.live/api/proxy/captions`.
- Media CDN/proxy: `media.satella.buzz`.
- Latency in the capability audit: 3.06-3.94 s across One Piece and Dandadan sub/dub; all 4 cases resolved and probed.

## Independence assessment

`api.anilight.live` and `media.satella.buzz` do not overlap the currently measured HiAnime, KickAssAnime, AnimeGG, Miruro, or AllManga hosts. Because `media.satella.buzz` is a proxy, the ultimate origin host is hidden; independence is established at the API and playback-edge layer, not proven for the concealed origin.
