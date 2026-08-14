# Kunai Core: Provider Metadata Contracts

This document maps the exact JSON schemas required to build flawless, multi-source provider plugins in `@kunai/core`.

## 1. AllManga / AllAnime

- **JP/EN Title Mapping:** They natively support mapping via `name` (Romaji), `englishName`, and `nativeName` (Kanji). Example: `undefined` vs `undefined`.
- **Sub/Dub Flags:** Handled explicitly in the catalog endpoint via the `availableEpisodesDetail` object:

```json
undefined
```

- **Next Release Date:** Found natively via the `nextEpisode` GraphQL field (Unix timestamp or null): `undefined`.
- **HardSub vs SoftSub:** AllAnime uses HardSubs for standard streams. SoftSubs are sometimes embedded directly in the HLS `.m3u8` manifest, but are not exposed as separate `.vtt` arrays in the JSON payload.

## 3. Vidking / HDToday (api.videasy.net)

- **JP/EN Title Mapping:** Vidking uses **TMDB IDs** (not AniList). It has poor support for JP Romaji names. Searching via TMDB ID is mandatory for perfect mapping.
- **Sub/Dub Flags:** Vidking does NOT separate Sub and Dub endpoints. If an episode is Dubbed, the title usually explicitly says "(Dub)".
- **HardSub vs SoftSub:** Vidking is the gold standard for SoftSubs. The decrypted JSON payload natively provides an array of subtitle tracks:

```json
"subtitles": [
  { "url": "https://...en.vtt", "lang": "eng", "language": "English" },
  { "url": "https://...sdh.vtt", "lang": "eng", "language": "English (SDH)" }
]
```

- **Quality Selector:** The payload explicitly provides qualities so we don't have to parse the HLS manifest:

```json
"sources": [
  { "url": "...", "quality": "1080p" },
  { "url": "...", "quality": "720p" }
]
```
