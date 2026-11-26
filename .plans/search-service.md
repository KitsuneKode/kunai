---
lastReviewed: "2026-11-24"
---

# Kunai Search, Catalog, And Mapping Service Plan

Status: Active design, current implementation stays pragmatic

Use this when changing search, catalog metadata, anime identity mapping, recommendations, provider-owned search, or result enrichment.

## Problem

Search and catalog ownership are still too spread out.

- Movies and TV series currently use TMDB/Videasy-style search.
- Anime providers can own their own search behavior.
- AllAnime is a concrete provider/API client inspired by AllManga/ani-cli behavior, not the base abstraction for anime search.
- Miruro, Anikai, HiAnime, AllAnime, and future anime providers may expose different IDs, episode catalogs, images, titles, subtitles, trailers, and backend mappings.
- Provider choice should not randomly change the user's movie/series catalog/search experience when the selected provider consumes TMDB-compatible IDs.
- Anime provider search is allowed to be provider-specific until we have evidence-backed mappings.

## Target Ownership

Long term, search/catalog should become its own package:

```text
@kunai/catalog
  content identity
  search services
  mapping services
  metadata enrichment
  recommendation signals
  episode catalogs

@kunai/providers
  provider-specific stream/source/subtitle resolution
  provider-native metadata enrichment when useful

@kunai/storage
  local SQLite cache for search, mappings, catalogs, metadata, and health

apps/cli
  UI, selection, commands, and user-facing search flow
```

Do not move this package until the CLI flow is stable enough to avoid churn. But new code should align to this ownership.

Current rule:

- do not build a fake global mapping layer before research proves mappings
- use TMDB/Videasy for movie and series providers that support TMDB-compatible IDs
- use the best working anime route per provider
- promote similarities only after experiments/dossiers prove they are real and repeatable

## Search Domains

### Movie And Series Catalog

Primary service:

- TMDB-compatible search through `db.videasy.net` today
- direct TMDB fallback where appropriate

Expected output:

- title ID
- title
- year
- overview
- poster/backdrop
- rating/popularity
- media kind
- season and episode metadata where available

### Anime Catalog

Anime eventually needs a provider-neutral catalog layer, but not by pretending current providers already share one identity model.

Current approach:

- each anime provider may own its own search/episode route when required
- choose the best working route one provider at a time
- use experiments to discover whether AniList, MAL, AllAnime, Miruro, Anikai, HiAnime, or other IDs can be connected reliably
- only then promote shared mappings into catalog code

Provider examples:

- AllAnime: concrete AllAnime/AllManga-style GraphQL API client/provider
- Miruro: may accept AniList IDs directly and expose backend episode/source mappings
- Anikai: may expose provider-native IDs and hard-sub/source details
- HiAnime/Cineby Anime: may be useful for search and provider-native episode linkage

Future expected output:

- canonical anime identity
- provider mappings
- episode catalog
- poster/banner/cover images
- English/native/romaji titles
- trailer when available
- season/year/status
- recommendations later

## Provider Enrichment Rule

Providers may enrich catalog data, but they do not own the app's whole search model.

Allowed provider enrichment:

- provider-specific ID mapping
- source/mirror availability hints
- episode IDs
- provider episode names
- provider thumbnails
- subtitle/audio availability evidence
- trailer or metadata when the provider has better data

Not allowed:

- provider-specific search shape leaking into CLI UI
- one provider becoming the generic anime search base
- stream resolution code mutating global catalog state directly
- assuming an anime provider mapping exists before a dossier proves it

## Over-Engineered Ideas Worth Keeping

### Identity Rosetta Layer

Future idea: build a local mapping graph after provider research proves enough stable edges.

```text
TMDB <-> IMDb
AniList <-> MAL <-> Kitsu
AniList/MAL <-> provider IDs
provider ID <-> episode/source IDs
```

This lets search feel instant, makes provider switching deterministic, and avoids repeated provider-native searches.

Do not make this a blocking dependency for the current CLI. It is a future acceleration layer, not the current architecture.

### Search Fusion

Future idea: for anime, search multiple catalog/provider services in parallel when useful, then dedupe by identity confidence.

Example:

```text
AniList result
  + Miruro mapping
  + Anikai mapping
  + AllAnime mapping
  -> one enriched Kunai result
```

The user sees one result, not provider duplicates.

This should only ship after we have confidence scoring and clear fallback behavior. Until then, provider-native anime search is safer.

### Provider Readiness Score

Search results can show whether a title is likely playable before the user clicks:

- known working provider mappings
- recent provider/source health
- subtitle availability
- episode catalog confidence
- expected runtime cost: fetch-only vs JIT browser

This gives Kunai a "smart catalog" feel instead of a dumb search list.

### Metadata Warm Cache

Cache search and catalog metadata separately from streams:

- search result cache
- title detail cache
- episode catalog cache
- mapping cache
- poster/image URL cache
- provider readiness cache

This is safe to keep much longer than stream URLs and avoids repeating expensive lookups.

## Implementation Phases

### Phase S1: Clarify Current Boundaries

- rename AllAnime helper references to concrete AllAnime API client naming
- document that AllAnime is a provider/API client, not the base for anime providers
- keep TMDB search for movie/series
- keep anime provider search behavior working while plans evolve
- document that anime mapping is research-backed and provider-by-provider, not assumed globally

### Phase S2: Service Contract

- define shared `CatalogSearchService`, `CatalogMappingService`, `TitleMetadataService`, and `EpisodeCatalogService` contracts
- include provider compatibility and output identity confidence
- model search result enrichment without requiring stream resolution
- allow provider-native anime search adapters without forcing them into a shared mapping graph

### Phase S3: Anime Catalog Layer

- add AniList-backed anime search service
- add mapping records for Miruro, Anikai, AllAnime, HiAnime/Cineby Anime only where evidence exists
- use experiments and provider dossiers as mapping evidence
- keep provider-native search as fallback/enrichment, not the default UI model

### Phase S4: Package Extraction

- create `@kunai/catalog`
- move TMDB/Videasy search, anime search, mapping, and catalog cache policy into it
- keep provider source resolution in `@kunai/providers`
- keep persistence in `@kunai/storage`

### Phase S5: Premium UX

- show readiness, provider/mirror health, subtitle likelihood, and runtime cost in browse/details
- support "why this result?" diagnostics
- prewarm safe metadata/mapping caches after search
- never prewarm expensive JIT browser work unless user intent is strong

## Acceptance

- provider choice does not unexpectedly reshape base search results
- anime search can stay provider-specific until mappings are proven
- future anime mappings do not treat AllAnime as the anime base
- movie/series search remains TMDB-centered
- providers can enrich metadata without owning global catalog state
- search/catalog cache is separate from volatile stream cache
- future web/daemon can reuse catalog contracts without pulling provider runtime code
