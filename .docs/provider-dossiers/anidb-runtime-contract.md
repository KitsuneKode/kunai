---
status: current
lastReviewed: "2026-08-26"
---

# Provider: AniDB — runtime contract

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Catalog capabilities live in [anidb-metadata-capabilities.md](./anidb-metadata-capabilities.md).
This file holds the runtime behaviour that used to sit in `.docs/providers.md`.

### AniDB catalog search compatibility

Advanced AniDB discovery uses the explicitly declared compatible AniList catalog
(`compatibleProviders` in `apps/cli/src/services/search/definitions/`), retaining AniList identity
until a validated AniDB slug is found. It **never** falls through to the default TMDB catalog: when
no compatible catalog exists, `SearchRoutingService` returns either a diagnosed provider-native
fallback or an `unsupported` result carrying filter evidence, each with
`attemptedDefaultFallback: false`.

### AniDB browse parsing

`packages/providers/src/anidb/browse-parser.ts` is the single parser for both markup generations,
used by search and resolve so they cannot drift apart:

- It captures the complete anchor opening tag first and only then parses and validates `href`;
  href matching never delimits the attributes used for title extraction.
- Attribute matching is anchored on a start-or-whitespace boundary, so `data-href`, `xlink:href`
  and `data-original-title` cannot shadow the real attribute.
- Title precedence is anchor `title` / `aria-label` → image `alt` → nested text, so a `title`
  placed after `href` still wins.
- Legacy relative `/anime/<slug-id>` cards and current absolute `https://anidb.app/anime/<slug-id>`
  cards both parse; entities decode in a single pass; rows without a positive numeric suffix are
  rejected; results dedupe by validated slug.
- Only anchors carrying result-card evidence (a `title`/`aria-label` attribute or nested card
  markup) become results, so nav, breadcrumb, related-rail and footer links cannot become
  `results[0]` and pin the wrong show.
- Live cards also carry a poster `img`, a TV/Movie/ONA/… badge, and a star rating (`5.3`). Search
  maps poster and rating onto `ProviderSearchResult`; a Movie badge becomes `type: "movie"`. The
  card has no year — Kunai does not invent one. Placeholder `img` srcs (`placeholder.svg`) and
  non-http(s) srcs are dropped. Relative posters resolve against `https://anidb.app/`.

### AniDB metadata and language evidence

The active `anidb.app` episode endpoint is a stream catalog, not a rich episode metadata catalog:
it currently returns episode ids, numbers, and filler flags. `anidb.listEpisodes()` first follows
the title page's explicit cross-link to the official AniDB AID and enriches from the official XML
catalog. It then uses the existing shared AniList/Jikan path for still thumbnails and missing fields
when the title identity carries an AniList or MAL id. This keeps the metadata authority explicit
instead of pretending those fields came from `anidb.app`.

- `anidb.app` language evidence is per episode: `jpn` is the sub/original embed and `eng` is the
  dub embed when present. Search does not advertise both modes blindly; availability is confirmed
  only by the episode languages response.
- A missing requested language is an exhausted AniDB attempt. It must not fall back to the other
  language and label the stream incorrectly.
- Only exact `jpn` (sub/original) and `eng` (dub) catalog evidence is accepted.
  The requested mode resolves first; the alternate starts concurrently but is
  skipped for `fast`, bounded to 1 second for `balanced`, and bounded to 4
  seconds for `quality-first`. A timed-out alternate is aborted and is not
  advertised as an available source.
- The embed probe currently exposes an HLS source but no independently addressable subtitle track.
  AniDB results keep `subtitles: []` and mark subtitle delivery unknown; `jpn` is not sufficient
  evidence that captions are hardcoded.
- Official AniDB XML is a separate catalog namespace. It can provide richer anime and episode
  metadata, but its AIDs must not be confused with the numeric ids in `anidb.app` URLs. See
  [the metadata capability dossier](./provider-dossiers/anidb-metadata-capabilities.md).

The cost model matters as much as the data, because this runs in front of the episode picker:

- Official AniDB XML is **one request for the whole series**, cached for a month and seeded into
  the shared episode-metadata cache, so a second listing of the same show is free.
- AniList runs even when every title is already known — it is a single request and the only source
  of episode stills AniDB has.
- Jikan is the expensive pass (100 episodes per page, strict rate limit) and is **skipped** when
  official titles already cover the catalog, matching the AllManga path via
  `shouldSkipExternalEpisodeMetadataEnrichment()`.
- An official response that carries `<error>` (rate limit, ban, bad client credentials) is never
  cached. Caching what it parses to would suppress every episode title for that show for a month
  after the block lifted.
- AniDB is relay-registered (`/rpc/anidb`, settings toggle). Metadata HTML/JSON uses `context.fetch`
  with curl fallback. HLS ladder expansion uses the same path so a relay miss does not collapse
  qualities to a silent `auto` row. Video remains direct from `hls.anidb.app`; the relay has no
  media route or video fallback configuration.

### AniDB season routing and episode numbering

AniDB models each season as its own title, so `routeAnidbSeason()` in
`packages/providers/src/anidb/season-routing.ts` decides identity and numbering from evidence:

- Season 1 retains the base title.
- Season 2+ searches `<normalized base> Season N` and requires both a matching parsed season and
  exact/prefix normalized base-title evidence. An ambiguous best score fails closed with a
  structured `not-found` rather than resolving the wrong title.
- `absoluteEpisode` survives CLI adaptation but is consumed **only** when the routed title's own
  resolved AniDB episode catalog contains that exact episode number. A missing season label is not
  evidence. A season-specific title, an unconfirmed base, and every routed season sibling use the
  one-based cour episode.
- The resolve trace records requested season, base id, routed id, route evidence, numbering
  evidence and reason, episode number, and whether the absolute episode was used.
