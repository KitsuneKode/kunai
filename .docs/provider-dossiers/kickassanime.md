---
status: current
lastReviewed: "2026-09-12"
---

# Provider: KickAssAnime

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Request Summary

Give the anime lane a second source independent of Miruro that ships subtitles
as tracks rather than burned in. AnimeGG (added 2026-09-11) is independent too,
but its subs are hard-subbed and its search exposes no year to match on.

## Scope

- **Runtime class:** direct-http. A plain JSON catalog API, one HTML player page,
  one HLS master. No crypto, no challenge, no headless step.
- **Module:** `packages/providers/src/kickassanime/` (`site.ts` parses,
  `direct.ts` is the contract).
- **Catalog identity:** provider-native slugs (`sousou-no-frieren-2d15`) —
  name plus a four-hex discriminator.

## Known

Observed directly on 2026-09-12 unless noted.

- `POST /api/fsearch` `{query, page}` → `{result[], maxPage}`. Rows carry
  `slug`, `title`, `title_en`, `year`, `type`, `locales`, `poster.hq`,
  `watch_uri`. `episode_count` is **0 even for finished shows** — it is not an
  episode count and is dropped. An announced show has `locales: []` and
  `watch_uri: null`; those rows are dropped too.
- `GET /api/show/<slug>/episodes?ep=<page>&lang=<locale>` →
  `{current_page, pages[], result[]}`. **`pages[].eps` lists the whole run on
  every page**, so one request gives every episode number; `result[]` holds only
  that page's rows, with a per-episode `slug`, `title` and `thumbnail.hq`.
- Locales: `ja-JP` is sub, `en-US` is dub. Both listings exist for Frieren, with
  **different episode slugs** (ep 1: `f897b3` vs `aa83b7`).
- `GET /api/show/<slug>/episode/ep-<n>-<epSlug>` → `{servers[], next_ep_slug, …}`.
  Servers seen: `VidStreaming` (HLS) and `BirdStream` (DASH).
- The VidStreaming page `https://krussdomi.com/cat-player/player?id=…` carries
  the stream as serialized **Astro island props** — `[0, value]` for a value,
  `[1, [...]]` for an array — holding `manifest` and every `subtitles[]` track.
  Nothing on the path is encrypted; the site's own JS is obfuscated but unused.
- Images: `/image/poster/<poster.hq>.webp` and
  `/image/thumbnail/<thumbnail.hq>.webp`, both 200 with no referer.

## The finding that shaped the adapter: one file, many dubs

The ja-JP and en-US listings for Frieren resolve to the **same** manifest id.
The master carries the dub as an audio rendition:

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",LANGUAGE="eng",…
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Japanese",DEFAULT=YES,LANGUAGE="jpn",…
```

Nine tracks for that episode (jpn, eng, hin, tam, ger, spa, fra, ita, por). Two
consequences, both verified with mpv:

1. **The track is the player's choice, via `--alang`.** `--alang=en` selects
   `--aid=3 eng`; `--alang=orig` and `--alang=ja` both land on the DEFAULT jpn
   track. So the adapter reads the rendition group (`selectKaaAudio`) and only
   calls a stream a dub when an English rendition is really there.
2. **`--alang=dub` matched nothing and silently played Japanese.** Kunai's
   Tracks panel writes the _mode_ (`"sub"`/`"dub"`) into the language profile,
   and it reached mpv verbatim. Fixed in `toMpvLanguageToken` (dub → `en`,
   sub → `orig`), and `alang` is now also set per `loadfile` so a mid-session
   switch is not left on the spawn-time value. Every other provider serves sub
   and dub as separate URLs, which is why this never showed before.

The variant playlists are **video-only** — the audio is in the rendition group —
so the ladder is never expanded into per-quality URLs. mpv gets the master and
picks; `qualityRank` stays 0 rather than inventing a height.

## Trap: three hops, three different headers

| Hop                                        | Needs                             |
| ------------------------------------------ | --------------------------------- |
| `hls.krussdomi.com/manifest/…/master.m3u8` | `Referer: https://krussdomi.com/` |
| Segments (MPEG-TS served as `.jpg`)        | `Origin: https://krussdomi.com`   |
| `subst.krussdomi.com/….vtt`                | `Origin` — same as the segments   |

The referer alone is refused by the segment host, and it **rotates**
(`st1.advancedairesearchlab.xyz` on 2026-09-11, `st1.narutokun.xyz` on
2026-09-12), so it is never hardcoded — both headers are derived from the
player's own origin. mpv applies the stream's headers to `--sub-file` and
`sub-add` too, so the `.vtt` tracks attach with nothing per-track
(verified: `● Subs --sid=1 … (webvtt) [external]`).

`ffmpeg` fails on this master where mpv succeeds; it is not a reachability
signal, and no probe over these URLs should be trusted to judge the stream.

## Candidate Stream Inventory

One source per episode (VidStreaming), one stream: the master. BirdStream's DASH
is parsed but never chosen — its manifest 404'd for the title tested, and its
`src` carries a doubled slash (`https:////bl.krussdomi.com`) that the URL
normalizer repairs if it is ever enabled.

## Subtitle Inventory

External `.vtt` tracks, one per language, emitted as `SubtitleCandidate` with
`source: "provider"`. Frieren ep 1 exposes 8+ languages; the count varies per
episode (ep 5 exposed one). This is the only anime provider in the tree with
soft subs — Miruro's kiwi server and AnimeGG both burn them in.

## Sample Cases For Regression

| Case         | Slug                          | Episode | Expectation                                                  |
| ------------ | ----------------------------- | ------- | ------------------------------------------------------------ |
| Sub          | `sousou-no-frieren-2d15`      | 5       | `presentation: "sub"`, jpn rendition, mpv writes a frame     |
| Dub          | same                          | 5       | `presentation: "dub"`, `--aid=3 eng` selected                |
| Bridge       | AniList 154587 + title + year | 5       | matches the slug by name/year and stores it on `titleBridge` |
| Ambiguous    | title `"Frieren"`             | —       | `not-found`, never a guessed show                            |
| Late episode | `sousou-no-frieren-2d15`      | 3       | fetches listing page 2 for the slug                          |

Verified end to end on 2026-09-12: search 0.9 s, resolve ~2–6 s, 1920x1080 h264
frame written for both audio modes.

## Risks And Drift Watchlist

- **The domain rotates** (`kaa.to` → `kaa.mx` → `kickass-anime.ro` → `kaa.lt`).
  `kickass-anime.ro` still redirects to the current one and is asked when the
  current base stops answering _at connection level_ — an HTTP error is not a
  rotation signal, and an alias that answers without redirecting is not a new
  domain.
- The Astro props are matched by shape. A player rewrite must surface as "no
  playable server", never as a wrong stream — `parseKaaPlayerPage` returns null
  rather than guessing.
- `episode_count: 0` may start being populated; the parser drops 0 today, which
  stays correct either way.
- The title bridge matches on name **and** year with exactly one hit. Loosening
  it would play the wrong season.

## Implementation Handoff Notes

Registered in `loadProductionProviderModules()` and **second** in the default
anime order, ahead of AnimeGG. Both take over a title found in any catalog by
name through the shared `matchProviderCatalogTitle`; KickAssAnime's rows carry a
year, so its match can tell a sequel from its first season where AnimeGG's can
only refuse the pair as ambiguous, and it has real subtitle tracks. Miruro stays
first for catalogue breadth.
