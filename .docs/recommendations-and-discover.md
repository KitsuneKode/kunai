# Kunai — Recommendations And Discover

This is the canonical product and architecture reference for the `/discover`, `/calendar`,
and `/random` / `/surprise` discovery surfaces.

## Goals

- Discovery surfaces are lazy-loaded and never slow startup.
- Recommendations are explicit: the user opens `/recommendation`, chooses a post-playback nudge, or enables an optional startup hint.
- Calendar is a schedule lens: it shows catalog release timing, not provider playability.
- Random is controlled: it shows a small explained tray and never auto-plays.
- Recommendation code stays outside provider adapters. Providers resolve streams; catalog/recommendation services provide browseable metadata.

## Current Implementation

| Capability                                   | Canonical location                                                                                               | Status      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| Recommendation service contract              | `apps/cli/src/services/recommendations/RecommendationService.ts`                                                 | Implemented |
| TMDB-backed implementation and cache helpers | `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`                                             | Implemented |
| SQLite recommendation cache                  | `packages/storage/src/repositories/recommendation-cache.ts`                                                      | Implemented |
| Shared section builder                       | `apps/cli/src/app/discover-sections.ts`                                                                          | Implemented |
| Unified discover result loader               | `apps/cli/src/app/discover-results.ts`                                                                           | Implemented |
| Browse-shell discover loading + SWR          | `apps/cli/src/app-shell/ink-shell.tsx`, `apps/cli/src/app/SearchPhase.ts`                                        | Implemented |
| Release schedule service + SQLite cache      | `apps/cli/src/services/catalog/CatalogScheduleService.ts`, `packages/storage/src/repositories/schedule-cache.ts` | Implemented |
| Calendar result loader                       | `apps/cli/src/app/calendar-results.ts`                                                                           | Implemented |
| Random result loader                         | `apps/cli/src/app/random-results.ts`                                                                             | Implemented |
| Surprise catalog pool                        | `apps/cli/src/services/catalog/CatalogDiscoveryService.ts`, `apps/cli/src/app/discovery-lists.ts`                | Implemented |
| Command routing                              | `apps/cli/src/domain/session/command-registry.ts`, `apps/cli/src/app-shell/command-router.ts`                    | Implemented |
| Search-phase entry                           | `apps/cli/src/app/SearchPhase.ts`                                                                                | Implemented |
| Startup discovery routes                     | `--calendar`, `--random`, `/calendar`, `/random`                                                                 | Implemented |
| Post-playback nudge/action                   | `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/app-shell/ink-shell.tsx`                                      | Implemented |
| Startup hint config                          | `discoverShowOnStartup` in config                                                                                | Implemented |
| Discover mode + item limit config            | `discoverMode`, `discoverItemLimit` in config                                                                    | Implemented |
| Minimal mode                                 | `minimalMode` in config and shell layout policy                                                                  | Implemented |

## Data Sources

Recommendations use TMDB surfaces on demand:

- title recommendations for recently watched titles
- trending
- recency-weighted genre affinity from local history

Calendar uses catalog schedule services on demand:

- AniList releasing-today for anime mode
- TMDB airing-today for series mode
- SQLite schedule cache keyed by source, mode, title, season, episode, and local day window
- release-aware TTLs so future entries refresh around known release time rather than through a global daily sync

Random mixes the cached discover pipeline with a short-lived surprise catalog pool:

- anime mode samples a randomized AniList page/sort/genre combination
- series mode samples a randomized TMDB discover media type, page, and sort
- the surprise pool is cached briefly so rerolls are fast and do not hammer upstream APIs
- the tray guarantees a surprise-sourced candidate when that pool is available

It only changes browse results; it does not mutate playback state.

The shell should keep these as suggestions, not as autoplay or background network work.

## Post-Playback Rail

The post-playback rail is deliberately lightweight: it carries recommendation
identity (`id`, media type, optional source id, title, and year) into the shell,
but it does not resolve streams or call providers when the user presses a number.

`1`, `2`, and `3` queue the visible picks into the playlist at the end. The
mutation stays in `PlaybackPhase`; the shell only renders rows and reports the
typed action. This keeps playback context stable and prevents the rail from
turning into a hidden provider-resolution path.

`i` opens a recommendation action panel. Details are rendered from cached
recommendation metadata only. Download is available from that panel, but it
requires an explicit confirmation before Kunai performs provider mapping or
stream resolution. A cancelled download action must leave the post-playback
context untouched and perform no provider calls.

## Runtime Rules

- Do not fetch recommendations or calendar data on process startup unless the user explicitly starts in that route (`--calendar` or `--random`).
- Keep history-derived personalization local.
- Cache recommendation responses with explicit TTLs in SQLite cache DB.
- Cache schedule responses with release-aware TTLs in SQLite cache DB.
- Use stale-while-revalidate for discover loading in browse shell.
- If recommendations fail, show an empty/error state in Discover rather than failing search or playback.
- Do not couple Discover to provider selection. Opening a recommendation should return to normal browse/title selection flow.
- Do not treat `airs today` as playable. Provider availability is checked only after the user chooses playback.
- Do not auto-play random picks. The user can rerun `/random` or `/surprise` to spin again, or select a title normally.

## Remaining Product Work

- Add stronger visual verification for discover, calendar, and random loading/layout at small and wide terminal sizes.
- Keep refining the discover companion treatment inside browse so recommendations, calendar entries, and random picks feel native.
- Evaluate whether explicit cache age text is needed for discover/calendar SWR results.
- Extend anime recommendation quality later through catalog identity work; do not add a provider-specific recommendation path.

## Related

- [search-service plan](../.plans/search-service.md)
- [metadata and trending contract](../.plans/metadata-and-trending-contract.md)
- [design system](./design-system.md)
