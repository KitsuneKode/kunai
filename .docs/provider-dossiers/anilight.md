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
- `/anime/check-exists?anilistId={anilist}`
- `/anime/{slug}`
- `/watch/{slug}`
- `/sources?id={id}&episode={episode}&language=sub|dub&backup=true|false&refresh=1`
- source-session verification endpoints that the direct adapter does not need for the recorded playback lane

AniList ids bridge to provider-native slugs through `check-exists`. Episodes keep provider-native numeric episode identities. Sub and dub are separate source queries. Source URLs are opaque but are played through the declared media proxy, observed as `https://media.satella.buzz`; the adapter preserves that URL shape rather than inventing a local crypto scheme.

## Live evidence — 2026-11-27

Capability audit in an isolated profile, with provider-native search and episode listing exercised before resolve:

- Search: One Piece resolved to provider id `one-piece-ygce` (8 results); Dandadan resolved to `dandadan` (3 results).
- Episode catalogs: One Piece returned 1,180 rows; Dandadan returned 12 rows, both with provider-native episode identities.
- Resolve/probe: 4/4 cases resolved and independently probed reachable — One Piece episode 1 sub+dub and Dandadan episode 1 sub+dub.
- Decode: mpv `--vo=image` wrote `/var/tmp/kunai-batch1-frames/anilight-one-piece-e1-sub.png`; the PNG was opened and confirmed as real 1440x1080 video.
- Resolve latency measured in the audit: 3.42-5.27 s; independent probes took 0.79-1.24 s.
- Servers/source labels: `Sub kira`, `Sub misa backup`, `Dub kira`, `Dub misa backup`.
- Qualities: 1080p MP4 primary rows plus `auto` HLS backup rows.
- Audio: Japanese in sub lanes and English in dub lanes.
- Subtitles: One Piece episode 1 exposed English; Dandadan episode 1 exposed Arabic, German, English, Spanish, French, Italian, Portuguese, and Russian through `api.anilight.live/api/proxy/captions`.
- Media edge: `media.satella.buzz`; successful MP4 lanes carried no provider-required media headers.

The backup `misa` lane was inventoried but not independently decoded; the audit decodes one proof per provider rather than every source row.

## Independence assessment

`api.anilight.live` and `media.satella.buzz` do not overlap the currently measured HiAnime, KickAssAnime, AnimeGG, Miruro, or AllManga hosts. Because `media.satella.buzz` is a proxy, the ultimate origin host is hidden; independence is established at the API and playback-edge layer, not proven for the concealed origin.
