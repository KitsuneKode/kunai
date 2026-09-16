---
status: current
lastReviewed: "2026-09-13"
---

# Provider Research Dossier — HiAnime (`hianime`)

> Agent-facing (L3). Live material: responses recorded 2026-09-13 against
> `hianime.at` with plain curl + Chrome 124 UA. No browser, no auth, no account.

Parity reference: ani-cli `5.1.2` (`/home/kitsunekode/Projects/osc/ani-cli`,
single `ani-cli` shell script). Kunai previously used `anidb.app` for the
ani-cli-shaped lane; ani-cli has since moved its primary to HiAnime, so this
provider restores that parity on the new upstream. The 5.1.1 → 5.1.2 delta is
one commit (`#1902`: `hianime_curl` names the failed layer — `no HTTP
response` vs `HTTP NNN` — instead of a bare curl exit), ported into
`splitCurlHttpTrailer` / `hianimeCurlFailureMessage` plus the curl-path HTTP
status check.

## Request Summary

- Provider: HiAnime (`https://hianime.at`, embeds on `zokoanime.video`, HLS on `*.aniwatchtv.uk`)
- Requested by: developer
- Date: 2026-09-13
- Goal: new anime provider with full sub/dub, search, episode catalog, quality
  ladder, subtitles, and MAL-anchored auto-skip parity with ani-cli
- Success criteria: `search` + `listEpisodes` + `resolve` work for sub and dub
  through the ZokoAnime server with referer headers mpv can play, plus
  fixture-backed unit tests and no live dependency in the default test path

## Inputs Supplied By Developer

- Sample titles / URLs: Naruto (`naruto-1335`), Solo Leveling (`solo-leveling-235`),
  Don't Toy with Me, Miss Nagatoro (entity-encoding case)
- Screenshots / recordings: none (HTML/JSON evidence instead)
- Known requirements: all servers, dub/sub selection, search, quality converters
- What already works: n/a (new provider)
- What is broken or missing: n/a (new provider)

## Scope

- Content types:
  - movie: partial — films are catalogued as watch slugs (e.g. The Last) but the
    search markup carries no movie badge, so results type as `series`
  - series: yes
  - anime: yes (only)
- Features requested:
  - multi-source inventory: partial — ZokoAnime per audio mode; other servers observed, unsupported (see below)
  - subtitles: yes (external English VTT, `default:true`)
  - quality variants: yes (HLS ladder expansion, relative URLs)
  - dub / audio variants: yes (separate sub/dub embeds per episode)

## Known

- Search is `GET /search?keyword=<+ joined>`, HTTP 200 with plain curl (Cloudflare
  `server: cloudflare`, `cf-cache-status: HIT`, no challenge observed 2026-09-13).
  Results live in `<div class="film-detail">` blocks before `id="main-sidebar"`
  (the sidebar repeats result markup — it must be cut off first). Each block has
  `<h3 class="film-name"><a href="…/<slug-id>" title="…">`. Titles carry HTML
  entities (`&#039;`, `&quot;`, `&amp;`, also in `data-jname`).
- Show ids are `slug-<positive-numeric>` (same shape as AniDB/anidb.app ids).
  The episodes API takes only the numeric suffix (`${slug##*-}`).
- Episodes are `GET /api/theme/episode/list/<numericId>` → JSON
  `{status, totalItems, html}`. The HTML carries one `<a class="ssl-item ep-item">`
  per episode with `data-number` (display number), `data-id` (episodeId for the
  servers API), and `href="/watch/<slug>?ep=<episodeId>"`. Multi-cour shows paginate
  the dropdown (`EPS: 001-100`) but the single response still lists every episode
  (Naruto: 220 rows). Episode display titles ride `data-jname` / `title` on the
  inner `ep-name` div.
- Servers are `GET /api/theme/episode/servers?episodeId=<episodeId>` → JSON `{html}`
  with `<div class="item server-item" data-type="sub|dub" data-server-name="…"
data-hash="<base64 embed URL>">`. Observed matrix 2026-09-13:

  | Server      | Sub | Dub | Embed host                                      | Verdict                                                                                             |
  | ----------- | --- | --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
  | ZokoAnime   | yes | yes | `zokoanime.video/stream/mal/<malId>/<n>/<mode>` | **supported**                                                                                       |
  | HD-1        | yes | yes | `megaplay.buzz/…`                               | dead — HTTP 200 body is a 410 "file not found" page, old and new titles alike                       |
  | Vidstream-2 | yes | yes | `megaplay.buzz/…`                               | dead — same 410                                                                                     |
  | VidPlay-1   | yes | yes | `vidtube.site/stream/<token>/…`                 | different JWPlayer-style page (`data-id`, `settings.cid`), no `window.__P`; future work, not parity |

- ZokoAnime embed decoding (ani-cli `deobfuscate_blob` parity, verified byte-for-byte):
  `window.__P="<b64>"` → base64 decode → XOR with `otaku-embed-v1` (repeating) →
  JSON. Payload keys: `src` (master `.m3u8`), `subtitles[]` (`{lang, label,
default, src}` VTT), `skip: {intro, outro: {start, end}}` (either may be null),
  `download_url` (`/download/mal/…`), `poster`, `sprite_vtt` (empty string when
  absent), `default_audio`, `video_id`. Embed referer for playback is the embed
  origin + `/` (e.g. `https://zokoanime.video/`); the MAL id comes from the embed
  URL path `/mal/<id>/`.
- Master playlists use relative variant URLs (`360/index.m3u8` beside
  `master.m3u8`) with `BANDWIDTH` + `RESOLUTION`; observed both multi-variant
  (Solo Leveling S1E1: 360p + 1080p) and single-variant (Naruto E1: 800p only)
  masters. Media playlists are VOD with relative `seg_*.ts` segments. Master,
  segments, and subtitles all answer with the embed origin as `Referer`.
- Dub and sub are fully separate embeds (different `src` hash path, different
  subtitle file, different outro timestamps). Dub still ships an English VTT with
  `default:true`, so subtitle delivery is `external`/`soft` for both modes.
- ani-cli plays only ZokoAnime (`hianime_m3u8` greps `data-server-name="ZokoAnime"`);
  every other server uses a different player and is ignored upstream too.

## Suspected

- `totalItems` on the episodes API likely counts season pages, not episodes
  (Solo Leveling S1: `totalItems: 1` with 12 episodes). Do not use it as a count.
- Signed HLS URLs probably expire (path-hash style like other AniWatch mirrors);
  do not persist them beyond the stream-manifest TTL. Not directly measured.

## Unknown

- Whether `hianime.at` challenges Bun/fetch with Cloudflare while plain curl
  passes (observed 200 with curl only). The provider therefore ships the same
  curl-impersonate fallback as AniDB/Miruro; the fallback path is exercised by a
  unit seam, not live.
- VidTube (`vidtube.site`) extraction contract — page shape captured (JWPlayer
  settings + `data-mediaid`), stream derivation not attempted.
- Rate limits / WAF thresholds — none hit during research (dozens of requests).

## User Flow

Search title → pick show slug → list episodes (`data-number` + `data-jname`) →
pick episode + audio mode (sub/dub) → servers API → ZokoAnime embed for that mode
→ decode `window.__P` → master m3u8 → expand ladder → play best/selected variant
with `Referer: <embed-origin>/` + attach default VTT + feed MAL id to auto-skip.

## URL Patterns

- Landing page: `https://hianime.at/search?keyword=<query>`
- Episode page: `https://hianime.at/watch/<slug>?ep=<episodeId>`
- Embed page: `https://zokoanime.video/stream/mal/<malId>/<n>/<sub|dub>`
- API endpoints:
  - `GET https://hianime.at/api/theme/episode/list/<numericId>`
  - `GET https://hianime.at/api/theme/episode/servers?episodeId=<episodeId>`

## DOM And Interaction Notes

- Buttons/selectors: `.film-detail` / `.film-name a` (search); `.ep-item`
  (episodes); `.server-item` (servers). No click activation — all plain HTTP.
- Needs click: no.
- Season/episode controls: per-season slugs (S1 vs S2 are separate ids); no
  in-provider season routing — discovery must select the right slug.
- Mirror/provider controls: `data-type` (audio) × `data-server-name` (mirror).
- Quality/audio/subtitle controls: quality only exists in the HLS ladder;
  audio is the sub/dub server split; subtitles are the embed `subtitles[]`.

## Network Findings

- Relevant XHR/fetch/API calls: the two `/api/theme/episode/*` endpoints above.
- Relevant manifest requests: `src` master + relative variant/media playlists.
- Relevant subtitle requests: `subtitles[].src` (VTT, `Referer` = embed origin).
- Anti-bot: Cloudflare in front of everything (`server: cloudflare`, `cf-ray`);
  unchallenged for curl 2026-09-13. ani-cli additionally sets Darwin-only cipher
  flags and prefers `curl_*` impersonate builds — mirrored via the shared
  `curl-impersonate` helper.

## Embed / Iframe Chain

1. `hianime.at` search/episode/servers HTML+JSON (metadata only)
2. `zokoanime.video/stream/…` embed page → `window.__P` obfuscated JSON
3. `hls*.aniwatchtv.uk/…/master.m3u8` → variant playlists → `.ts` segments (direct, with Referer)

No iframes, no JS execution, no browser needed.

## Candidate Stream Inventory

| Candidate            | Source host          | Quality                                   | Audio               | Subs            | Evidence                   | Notes                    |
| -------------------- | -------------------- | ----------------------------------------- | ------------------- | --------------- | -------------------------- | ------------------------ |
| ZokoAnime sub ladder | `hls2.aniwatchtv.uk` | 360p+1080p (Solo S1E1) / 800p (Naruto E1) | ja                  | en VTT external | live decode + master fetch | supported                |
| ZokoAnime dub ladder | `hls2.aniwatchtv.uk` | same shape, distinct URLs                 | en                  | en VTT external | live decode                | supported                |
| HD-1 / Vidstream-2   | `megaplay.buzz`      | —                                         | —                   | —               | 410 error page             | dead upstream            |
| VidPlay-1            | `vidtube.site`       | unknown                                   | sub/dub pages exist | unknown         | JWPlayer settings page     | different player, future |

## Subtitle Inventory

| Track             | Language | Format | Source                   | Notes                        |
| ----------------- | -------- | ------ | ------------------------ | ---------------------------- |
| English (default) | en       | vtt    | Zoko embed `subtitles[]` | present on sub and dub alike |

## Headers / Referer / Cookies

- Referer requirements: embed origin + `/` on master, media, segment, and
  subtitle fetches and on mpv playback (`--referrer`).
- Header requirements: browser `User-Agent` (Chrome 124); `Origin` = embed origin
  alongside `Referer` on ladder fetches (mirrors the Miruro convention).
- Cookies or anti-bot state: none observed; Cloudflare may challenge non-browser
  TLS — curl-impersonate fallback included.

## Runtime Contract Recommendation

- Provider kind: API-first HTTP (`direct-http`), no browser. Single `ZokoAnime`
  server per audio mode; no provider-local cycling beyond sub/dub source rows.
- What should be extracted: show slug catalog, episode `(number, episodeId,
title)`, per-mode embed payload (`src`, subtitles, skip, MAL id), expanded
  HLS ladder, `inventory:audio-modes` when servers expose both modes.
- What should be deferred: VidTube support, Megaplay revival watch, per-episode
  MAL enrichment at list time (resolve supplies it).
- Diagnostics needed: stage-coded embed failures (base64 vs JSON vs shape),
  server matrix in trace attributes (which servers were observed vs used),
  `blocked` on Cloudflare challenge text, `not-found` on HTTP 404/410 (gone
  routes never retry), and `ladder:fallback` when the HLS ladder collapses to
  the single `auto` row.
- Failure classification: `not-found` (404/410) and `parse-failed` are
  non-retryable; only `blocked` and `network-error` retry. Retryability is an
  allowlist — a future code must opt in.
- Caching: title-query → slug lookups share the episode catalog's 30-minute
  memory TTL (hits only, never empty); native-id resolves bypass it.

## Sample Cases For Regression

- Anime case: Naruto E1 sub (`naruto-1335`, episodeId `22676`, MAL `20`) —
  single-variant 800p master, outro-only skip.
- Anime case: Solo Leveling S1E1 sub (`solo-leveling-235`, MAL `52299`) —
  two-variant ladder (360p/1080p), null skip.
- Subtitle case: dub embed still carries default English VTT.
- Dub/audio case: same episodeId, `dub` embed resolves distinct `src`.
- Multi-mirror case: servers HTML with Zoko + HD-1 + Vidstream-2 + VidPlay-1 —
  only Zoko resolves; the rest are recorded as observed/unsupported.
- Entity case: `Don't Toy with Me, Miss Nagatoro` search + `I&#039;m used to it`
  episode titles decode to apostrophes.

## Risks And Drift Watchlist

- What is likely to change first: embed obfuscation (`otaku-embed-v1` key,
  `window.__P` name), embed host (`zokoanime.video`), CDN host
  (`hls2.aniwatchtv.uk`), servers HTML attributes. Megaplay already died once.
- What evidence should be re-collected if it breaks: compare against ani-cli
  first (parity policy: ani-cli is the reference implementation for this lane),
  then re-capture servers HTML → embed page → blob decode in that order.

## Implementation Handoff Notes

- Shared helpers that may be reusable: `expandHlsMasterPlaylist` /
  `parseHlsMasterVariants` (ladder), `animeQualityFields` +
  `formatAnimeSourceLabel/Detail/Archetype` (presentation), `resolveAnimeAudioIntent`
  (sub/dub intent), `normalizeIsoLanguageCode` + `inferSubtitleFormat` (subs),
  `selectReadyStream` (selection), `finalizeCycleSourceInventory` (sources),
  `resolveCurlCandidate` + `curlCipherArgs` (CF fallback), `decodeMarkupEntities` /
  `markupToPlainText` (titles), `selectProviderEpisodeNumber` (numbering),
  `formatAnimeEpisodeLabel` (labels), `createExhaustedResult` + `emitTraceEvent`
  (results), `TTLCache` (episode catalog).
- Open implementation questions: none blocking; VidTube left for a follow-up.
- Things the next agent should not assume: Megaplay is not a fallback (410);
  `totalItems` is not an episode count; dub needs its own embed fetch (no
  audio fallback — fail closed like AniDB); each season is a separate slug.
