# Catalog Release Schedule Service Plan

Status: in progress

## Goal

Create one catalog schedule service that can answer release-date questions for both anime and TV/series without asking providers or recomputing metadata in random UI paths.

## Why

Playback already has honest released/upcoming behavior for TMDB series. Anime currently falls back to uncertainty when provider episode lists do not include the next episode. Browse/trending also lacks a unified "releasing today" or "next airing" model. A schedule service gives the shell one reliable place to ask:

- is the next episode released?
- when does the next episode air?
- what is releasing today?
- should autoplay/prefetch be blocked?
- what badge should browse/playback show?

## Sources

| Content   | Preferred source                                                                 | Use                                                   |
| --------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Anime     | AniList GraphQL `nextAiringEpisode`, airing schedule windows                     | next-airing labels, releasing-today lists, countdowns |
| TV/series | TMDB season episode `air_date`, TV `on_the_air` / `airing_today` where available | released/upcoming status, releasing-today lists       |
| Movies    | TMDB `release_date` / release status                                             | browse badges only; no episode navigation             |

Providers must not own release dates. They can expose playable episode/source facts only.

## Contract Sketch

```ts
type CatalogScheduleItem = {
  source: "tmdb" | "anilist";
  titleId: string;
  titleName: string;
  type: "anime" | "series" | "movie";
  season?: number;
  episode?: number;
  episodeTitle?: string;
  releaseAt: string | null;
  releasePrecision: "date" | "timestamp" | "unknown";
  status: "released" | "upcoming" | "unknown";
};

interface CatalogScheduleService {
  getNextRelease(
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ): Promise<CatalogScheduleItem | null>;
  loadReleasingToday(
    mode: "anime" | "series",
    signal?: AbortSignal,
  ): Promise<readonly CatalogScheduleItem[]>;
}
```

## Cache Policy

- Cache schedule results by catalog source, title id, season, episode, and mode.
- Use short TTLs for upcoming windows:
  - 30 minutes for `releasing today`
  - 2 hours for next-airing metadata
  - 24 hours for historical released dates
- Abort unused requests, but cache healthy completed responses even if the UI no longer needs them.

## Implementation Slices

### Slice 1: Contract And Tests

- Add `CatalogScheduleService` under `apps/cli/src/services/catalog`.
- Add deterministic tests for released, upcoming, unknown, and cache isolation.
- Keep the service UI-free.

Completed in `CatalogScheduleService` with deterministic cache/in-flight tests.

### Slice 2: TMDB Adapter

- Move TV release-date logic out of direct playback-only code into the service.
- Keep `resolveEpisodeAvailability` consuming service output or a compatible adapter.
- Preserve current invariant: autoplay and prefetch only use released episodes.

### Slice 3: AniList Adapter

- Extend anime discovery GraphQL to include `nextAiringEpisode` where useful.
- Add direct schedule fetch by AniList id for playback pages.
- When the provider list omits the next episode but AniList says the next airing is future, show that instead of generic uncertainty.

### Slice 4: Shell Surfaces

- Add browse/discover badges:
  - `airs today`
  - `next Fri`
  - `caught up`
  - `release unknown`
- Add playback caught-up copy that uses the same service for anime and TV.
- Add a releasing-today command or Discover section once the service is stable.

## Verification

- Unit tests with fixed clocks.
- Integration tests for autoplay block reasons.
- Manual smoke for one TMDB series with future episode metadata and one AniList anime with `nextAiringEpisode`.

## Related

- [metadata-and-trending-contract.md](./metadata-and-trending-contract.md)
- [series-catalog-end-state-and-upcoming-episode-ux.md](./series-catalog-end-state-and-upcoming-episode-ux.md)
- [.docs/recommendations-and-discover.md](../.docs/recommendations-and-discover.md)
