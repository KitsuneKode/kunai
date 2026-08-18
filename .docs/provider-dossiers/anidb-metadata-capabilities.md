---
status: current
lastReviewed: "2026-08-18"
---

# AniDB Metadata And API Capabilities

> Agent-facing (L3). Research dossier for the active `anidb` provider. This is
> not a claim that AniDB authorizes or operates the stream sources used by
> `anidb.app`.

## Executive Summary

There are two different services in this repository's AniDB path:

- **Official AniDB:** `anidb.net` and `api.anidb.net:9001`. The live HTTP API is
  a rich anime catalog. It exposes anime titles, title languages/types, dates,
  episode numbers/types, episode titles, air dates, lengths, summaries,
  relations, external resources, and an anime-level poster filename.
- **The active stream site:** `anidb.app`. Its current frontend exposes a
  separate catalog identity, episode IDs, per-episode `eng`/`jpn` embed choices,
  and an HLS player source. Its numeric IDs are not official AniDB AIDs.

For example, the `anidb.app` page for Frieren uses slug ID `1663` and links to
official AniDB AID `17617`. The active provider calls
`/api/frontend/anime/1663/episodes`, not the official AniDB API for AID `17617`.
Do not use the slug suffix as an AniDB database ID without an explicit
crosswalk.

## Capability Matrix

| Capability                     | Official AniDB HTTP/XML                                                                                                                               | Current `anidb.app` behavior                                                                                                                                                                                                                                                       | Kunai `anidb` provider                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Anime title metadata           | **Yes.** `<type>`, episode count, start/end dates, description, ratings, creators, resources, and titles.                                             | **Yes, partial.** Page title, native/alternate title, synopsis, genres, runtime, ratings, and cross-links are rendered.                                                                                                                                                            | Search keeps one scraped result title only. It does not map official title variants or rich title metadata. |
| Episode numbers                | **Yes.** `<epno type="1">` for regular episodes and other types for specials, openings/endings, previews, etc.                                        | **Yes, partial.** JSON returns `id`, `number`, `number2`, and `filler`.                                                                                                                                                                                                            | Keeps only positive `id`, `number`, and optional `filler`.                                                  |
| Episode titles                 | **Yes.** Multiple localized `<title>` elements occur on each episode.                                                                                 | **Not in the observed episode JSON.**                                                                                                                                                                                                                                              | Official XML title, preferring English, is mapped; external metadata can fill a missing title.              |
| Episode air dates              | **Yes.** `<airdate>YYYY-MM-DD</airdate>`.                                                                                                             | **Not in the observed episode JSON.**                                                                                                                                                                                                                                              | Official XML air date is mapped, with external metadata as fallback.                                        |
| Episode length                 | **Yes.** `<length>` is present; live values are minute-scale integers such as `25` and `30`.                                                          | The title page displays a series runtime, but the episode-list JSON did not return per-episode length.                                                                                                                                                                             | Not currently surfaced by the shared episode contract.                                                      |
| Episode synopsis               | **Yes.** `<summary>` may be present.                                                                                                                  | Not in the observed episode-list JSON.                                                                                                                                                                                                                                             | Official XML synopsis is mapped, with external metadata as fallback.                                        |
| Episode thumbnails/images      | **No evidence in the official HTTP anime response.** The response has `<picture>` for the anime and characters, but no episode-level `<picture>`.     | No per-episode thumbnail field was observed. The player uses the anime poster as artwork.                                                                                                                                                                                          | AniList stills are used when available; otherwise the title-page poster is a truthful fallback.             |
| Poster/artwork                 | **Yes, anime-level.** XML returns a filename such as `295082.jpg`; the official image CDN serves it. No backdrop field was observed.                  | Yes, but the page currently uses `cdn.xlsbox.com`, a separate image host.                                                                                                                                                                                                          | Title-page poster is carried into episode options; search/resolve do not invent a separate backdrop.        |
| Relations                      | **Yes.** `<relatedanime>` includes typed relations such as `Sequel`; similar anime and recommendations are also present.                              | Not relied on for the active stream flow.                                                                                                                                                                                                                                          | Season routing searches title text; it does not consume official relation data.                             |
| Language/title variants        | **Yes.** Anime and episode titles carry `xml:lang`; anime titles also carry types such as `main`, `official`, and `synonym`.                          | One primary title plus one alternate/native title is visible in the sampled page.                                                                                                                                                                                                  | No variant inventory; only the selected browse-card title is kept.                                          |
| Dub/sub/audio catalog metadata | **Not in the verified anime XML.** No `audio`, `dub`, `sub`, or track fields were present. `resources` are external entity links, not audio evidence. | **Yes, as stream availability.** The frontend language endpoint returned `eng`/`English` and `jpn`/`Japanese` embed choices for the sample episode. This is provider runtime data, not official AniDB catalog metadata.                                                            | Maps exact `eng` to `dub` and exact `jpn` to `sub`; missing requested modes fail closed.                    |
| Playable media streams         | **No.** The verified official anime XML contains catalog data and external resources, not media URLs or manifests.                                    | **Yes.** The returned embed page configures JW Player with an HLS `master.m3u8` source on `hls.anidb.app`.                                                                                                                                                                         | **Yes.** Extracts the embed's `file:` value and expands the HLS ladder into direct candidates.              |
| Subtitle tracks                | **No official track URL was found.** The verified catalog XML has no subtitle-track fields.                                                           | **No independently addressable track was observed.** The current embed config contains JW Player captions styling but no `tracks` array or VTT/SRT URL. This does not prove that every title is hardsubbed; it proves only that no soft-track evidence was exposed in this sample. | Always returns `subtitles: []`; subtitle delivery remains unknown.                                          |

## Official AniDB Evidence

### Live HTTP XML

The following live request succeeded on 2026-08-18 with the client name
`anidb` (that the endpoint answered is the evidence here; this dossier makes no
claim that the name is registered to this project) and returned the current XML
shape for AID `17617`:

[`httpapi?request=anime&...&aid=17617`](http://api.anidb.net:9001/httpapi?request=anime&client=anidb&clientver=1&protover=1&aid=17617)

Relevant fields in that response:

- Anime-level fields: `<type>`, `<episodecount>`, `<startdate>`, `<enddate>`,
  `<description>`, `<picture>`, `<resources>`, and `<titles>`.
- Anime titles: `xml:lang` values include `ja`, `en`, `de`, `fr`, `pt-BR`,
  `zh-Hans`, and others; title `type` values include `main`, `official`, and
  `synonym`.
- Relations: `<relatedanime><anime id="18886" type="Sequel">...` was present.
- Regular episodes: each record has an episode ID, `<epno type="1">`,
  `<length>`, `<airdate>`, localized titles, and sometimes `<summary>` and
  external resources.
- Non-regular entries are represented in the same catalog with other episode
  number types, including `S` specials, `C` opening/ending content, and `T`
  previews. A consumer must not flatten all entries into one regular-episode
  sequence without preserving the `epno` type.
- The live response includes `<picture>295082.jpg</picture>` for the anime and
  many character pictures, but no episode picture element.

The public HTTP endpoint is an anime request that embeds episode metadata. A
direct probe of `request=episode` returned `error code=320 request type invalid`,
and the same happened for `request=file`. This bounds the finding to the
current public HTTP API endpoint: it is not evidence that no file metadata has
ever existed in other AniDB interfaces, but it is evidence that the endpoint
used here is not a media-file or subtitle delivery API.

### Images

For the `picture` filename returned by the official API, the current official
image path is:

- Legacy image URL: `https://img7.anidb.net/pics/anime/295082.jpg`
- Current CDN target: `https://cdn.anidb.net/images/main/295082.jpg`

The legacy URL currently redirects through the official AniDB image service to
the CDN target, which returned `image/jpeg` and `200`. The XML gives a filename,
not a full URL. No episode-image URL or current image-policy text could be
retrieved from the official wiki in this environment.

### Official Documentation And XSD Access

Official documentation targets:

- [AniDB HTTP API](https://wiki.anidb.net/w/HTTP_API)
- [AniDB HTTP API definition](https://wiki.anidb.net/w/HTTP_API_Definition)
- [AniDB official site](https://anidb.net/)

The official wiki returned HTTP `403` for the API and image-policy pages during
this research. The guessed legacy downloads
`https://anidb.net/api/anime.xsd`, `episode.xsd`, and `file.xsd` returned `404`;
`http://api.anidb.net:9001/httpapi.xsd` returned an AniDB API error rather than
an XSD. Therefore this dossier cites the live XML response for field claims and
does not claim a current downloadable XSD URL. Re-check the official wiki/XSD
before implementing a strict schema validator.

## Current `anidb.app` Evidence

The following are live first-party pages for the host used by the repository's
provider. They are cited as stream-site behavior, not as official AniDB API
documentation:

- [`anidb.app` home](https://anidb.app/) currently advertises HD playback,
  adaptive quality, and sub/dub switching.
- [Frieren title page](https://anidb.app/anime/frieren-beyond-journeys-end-1663)
  renders a poster from `cdn.xlsbox.com`, shows `24m`, and links to official
  AniDB AID `17617`, MAL, AniList, and Kitsu.
- [`/api/frontend/anime/1663/episodes`](https://anidb.app/api/frontend/anime/1663/episodes)
  returned records shaped like `{ id, number, number2, filler }` and no title,
  air date, length, synopsis, or thumbnail fields.
- [`/api/frontend/episode/3062/languages`](https://anidb.app/api/frontend/episode/3062/languages)
  returned `eng`/`English` and `jpn`/`Japanese` with opaque `/embed/...` URLs.
- The embed page returned by that endpoint configured JW Player with one HLS
  `master.m3u8` source and the anime poster as `image`. Its config had captions
  styling but no subtitle-track URL or `tracks` array. The source URL is
  intentionally not copied here because it is a volatile media locator.

## Repository Comparison

### Active Provider Flow

- `packages/providers/src/anidb/client.ts:18-21` sets the provider base to
  `https://anidb.app`, not `anidb.net`.
- `packages/providers/src/anidb/client.ts:116-125` searches scraped browse HTML.
- `packages/providers/src/anidb/client.ts` retains episode ID, positive numeric
  episode number, and filler from the stream catalog; the title-page crosswalk
  and official XML parser provide episode titles, dates, and synopses separately.
- `packages/providers/src/anidb/client.ts:189-223` retains language code/name
  and the embed URL, but not a catalog audio-language model.
- `packages/providers/src/anidb/client.ts:225-231` extracts a `file:` value
  from the embed page; `:269-282` expands the HLS master into stream links.
- `packages/providers/src/anidb/direct.ts` does not advertise unprobed audio
  modes. Its episode list merges official AniDB XML with AniList/Jikan metadata,
  populating episode names, detail/synopsis, release dates, external ids, and
  artwork.
- `packages/providers/src/anidb/direct.ts` returns direct HLS results, the
  selected episode's release/artwork, external IDs, and an empty `subtitles`
  array because no concrete track URL is exposed.
- `packages/providers/src/anidb/manifest.ts:5-54` correctly declares an
  anime-only direct HTTP stream provider. It does not declare catalog metadata
  enrichment or subtitle-track support.
- The module is production-wired by
  `apps/cli/src/container/bootstrap-providers.ts:36-68`.

### Relevant Contracts

The repository already has places for the missing data:

- `packages/types/src/index.ts:568-588` supports `nativeTitle`, `englishTitle`,
  `altNames`, release/artwork, language evidence, and duration on search rows.
- `packages/types/src/index.ts:605-615` supports episode `name`, release, and
  artwork on episode options.
- `packages/types/src/index.ts:211-223` supports provider subtitle candidates
  with URL, language, format, and cache policy.
- `packages/types/src/index.ts:286-295` supports resolve-level subtitles,
  release, artwork, and external IDs.

## Concrete Gaps And Next Steps

1. **Keep identities separate.** Model official AniDB AID and the
   `anidb.app` stream-site ID as different namespaces. The active provider now
   follows the title page's explicit `anidb.net/anime/{aid}` cross-link rather
   than treating `1663` as official AID `1663`.
2. **Keep the metadata authority explicit.** Official AniDB XML is now the
   primary episode metadata source; AniList/Jikan remain best-effort fallback
   sources for thumbnails and fields absent from the official response.
3. **Preserve official episode semantics.** The XML parser keeps only
   `epno type="1"` records for the stream site's regular episode list, so
   specials, openings/endings, and previews are not silently flattened into the
   playable sequence. Current `anidb.app` JSON is insufficient for a full
   non-regular catalog.
4. **Fill contract fields only from evidence.** Official metadata can populate
   title variants, episode names, air dates, lengths, release info, relations,
   and poster artwork. It cannot justify stream audio or subtitle claims.
5. **Downgrade audio/subtitle assertions.** Keep `eng`/`jpn` as per-episode
   runtime availability from `anidb.app`; do not describe it as official AniDB
   dub metadata. Keep `subtitles: []` unless a future live sample exposes a
   concrete track URL or the media is independently proven hardsubbed.
6. **Verify image terms before product use.** The official CDN path is
   technically usable, but the current image policy was not retrievable here;
   confirm attribution, caching, and redistribution terms before adding an
   artwork cache.
7. **Keep drift fixtures current.** The provider tests now cover official XML,
   title-page crosswalks, episode JSON, language responses, and embed parsing.
   Keep volatile stream tokens out of committed fixtures.

## Request Budget

Official AniDB's terms are strict about repeat traffic and it answers abuse by
blocking the client name, so the provider treats the official API as a
once-per-series read:

- One `request=anime` call per show, cached for 30 days in process and seeded
  into the shared episode-metadata cache. Nothing here may run per episode or
  per playback.
- A response carrying `<error>` (rate limit, ban, invalid client values) arrives
  as HTTP 200. It is never cached: caching what it parses to would suppress
  every episode title for that show until the TTL expired, long after the block
  lifted.
- AniList is still called for stills even when titles are complete (one
  request). Jikan, which pages 100 episodes at a time under a rate limit, is
  skipped whenever official titles already cover the catalog.

Measured on 2026-08-18 for Gintama (`gintama-1816`, 200 playable episodes):
cold `listEpisodes` 4.4s with 200/200 titles, synopses, air dates, and stills;
warm 1ms.

## Known Limitation: Positional Stills

AniList `streamingEpisodes` is an ordered array with no episode numbers, so
stills are matched by position. When a stream catalog's numbering has gaps —
`anidb.app` carries 200 of Gintama's 201 official episodes, with no `2` — a
still can drift from its episode. The provider accepts this because the
alternative is no stills at all, and it is the same trade-off AllManga and
Miruro already make. A numbered still source (TMDB episode images, Jikan
`/pictures`) would remove the guesswork.
