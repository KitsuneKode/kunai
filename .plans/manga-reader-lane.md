---
status: active
created: "2026-10-10"
---

# Manga reader lane

Terminal manga reading is a proven category — existing readers ship chapter
downloads as PDF/ZIP/CBZ and render pages in-terminal via Kitty/Sixel/iTerm2.
This doc scopes a `manga` content lane for Kunai: the personal-media-hub thesis
extending to a second medium — not manga bolted onto the video pipeline.

## Confirmed scope

On 2026-10-24 the user confirmed manga/comic reading, not changes to the
AllManga anime streaming adapter. This is a separate reader lane. The current
watching candidate does not implement a reader; chapter/page identity, reading
direction, progress and offline behavior remain required before claiming support.

## Why it belongs

Same audience (anime/manga is one hobby), and Kunai's moats map cleanly:
the resolve gate becomes _page-manifest verification_, provider health becomes
_source health_, the personal deck already unifies "what's next for me" across
media. AniList — already integrated for tracking — covers `type: MANGA`
natively, so sync is nearly free.

## What already generalizes (do not rebuild)

- **Image stack — the hardest part exists.** `apps/cli/src/image/`: DA1 sixel
  detection, kitty `_G` probe with error-code recognition, iTerm2 inline,
  half-block fallback, decode + transport. Existing readers make the user pick a
  capable terminal manually; Kunai probes and degrades — the reader inherits
  that for free.
- **Lane model.** `ProviderLane`/`ShellMode` unions + per-lane language
  profiles + `compatibleProviders` search services are already a list, not a
  singleton. `ShellMode = "series" | "anime" | "youtube"` extends to `"manga"`.
- **History/continue/downloads.** Chapter ≈ episode-shaped rows; the queue,
  pause/resume, and offline library carry over.
- **AniList tracker** — progress sync in chapters instead of episodes.

## What must diverge (the honest seams)

| Surface                     | Video assumption                              | Manga shape                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamInfo.protocol`       | `hls`/`dash`/`mp4`/`iframe`/`youtube`         | A resolved _page manifest_ (ordered page URLs + dims), not a playable URL — likely a sibling resolve contract, not a union member                                                                                          |
| `MediaKind` / `EpisodeInfo` | `episode: number`                             | Chapter ids are **decimal** (112.5 exists on MangaDex) — chapter identity needs `chapter: string\|number` or a `Decimal`-safe field; `absoluteEpisode` analog exists (`absoluteChapter` for flat numbering across volumes) |
| Playback surface            | `PlaybackPhase` → mpv handoff                 | A `ReaderPhase`/reader surface — pages rendered via `src/image`, nav = page prev/next + chapter boundary, reading direction (R→L), fit modes, single/double-page                                                           |
| Downloads                   | `DownloadIntentItem` = title/episode → yt-dlp | `{kind:"chapter"}` items → fetch pages → **CBZ (zip) / PDF packaging**, not ffmpeg merge. Progress + partial-resume map fine                                                                                               |
| Language profile            | `audio`/`subtitle`/`quality`                  | Manga wants: `lang`, `dataSaver` (MangaDex data-saver pages), `readingDirection`, `pageFit` — a `mangaReadingProfile`-shaped key, not the video triple                                                                     |

## Source strategy

First source should be **API-first MangaDex** (`api.mangadex.org` — real REST,
auth-free public endpoints, no browser). Some existing readers lean on
Playwright-installed browsers for scraped sources; Kunai providers avoid
browser scraping for the same reasons as always (see
`resolve-ux-and-playwright-lifecycle.md`) — keep it that way. A scrape-requiring
source is a separate, later decision.

## Shape of slice 1

1. `MediaKind`/lane: `"manga"` through `ShellMode`, `ProviderLane`,
   `MediaKind`, default-provider map, `mangaReadingProfile` config key.
2. MangaDex provider adapter: search + chapter list + page manifest resolve.
3. Reader surface: chapter → page-manifest → `src/image` render loop; page
   nav, R→L direction, fit mode; offline chapters read local files.
4. Downloads: `{kind:"chapter"}` → CBZ packaging; offline library entries.
5. History: chapter+page position; continue-reading row on the personal deck.

Explicitly out of scope for slice 1: AniList manga-progress write-back (read
first), non-MangaDex sources, Playwright scrapers, OCR/translation.

## Category lessons (what to adopt vs what we already do better)

- **Adopt:** chapter → CBZ/PDF is the download users expect from a reader; the
  terminal-native reading experience itself is the pitch, not a viewer launch.
- **Already better:** no browser-dependency story (API-first provider rule);
  terminal capability is probed, not left to a README table; AniList tracking is
  written already — manga progress is a schema extension, not a new feature.
