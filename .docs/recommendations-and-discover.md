# Kunai — Recommendations And Discover

This is the canonical product and architecture reference for the `/discover` recommendation surface.

## Goals

- Recommendations are lazy-loaded and never slow startup.
- Discovery is explicit: the user opens `/discover`, chooses a post-playback nudge, or enables an optional startup hint.
- Recommendation code stays outside provider adapters. Providers resolve streams; catalog/recommendation services provide browseable metadata.

## Current Implementation

| Capability                                   | Canonical location                                                                            | Status      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| Recommendation service contract              | `apps/cli/src/services/recommendations/RecommendationService.ts`                              | Implemented |
| TMDB-backed implementation and cache helpers | `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`                          | Implemented |
| Shared section builder                       | `apps/cli/src/app/discover-sections.ts`                                                       | Implemented |
| Discover shell                               | `apps/cli/src/app-shell/discover-shell.tsx`                                                   | Implemented |
| Command routing                              | `apps/cli/src/domain/session/command-registry.ts`, `apps/cli/src/app-shell/command-router.ts` | Implemented |
| Search-phase entry                           | `apps/cli/src/app/SearchPhase.ts`                                                             | Implemented |
| Post-playback nudge                          | `apps/cli/src/app/PlaybackPhase.ts`                                                           | Implemented |
| Startup hint config                          | `discoverShowOnStartup` in config                                                             | Implemented |
| Minimal mode                                 | `minimalMode` in config and shell layout policy                                               | Implemented |

## Data Sources

Recommendations use TMDB surfaces on demand:

- title recommendations for recently watched titles
- trending
- genre affinity from local history signals when available

The shell should keep these as suggestions, not as autoplay or background network work.

## Runtime Rules

- Do not fetch recommendations on process startup.
- Keep history-derived personalization local.
- Cache recommendation responses with an explicit TTL.
- If recommendations fail, show an empty/error state in Discover rather than failing search or playback.
- Do not couple Discover to provider selection. Opening a recommendation should return to normal browse/title selection flow.

## Remaining Product Work

- Add stronger visual verification for Discover shell layouts at small and wide terminal sizes.
- Decide whether recommendations should become a right-side browse panel or remain a dedicated surface.
- Add an explicit refresh affordance if stale cache behavior feels confusing.
- Extend anime recommendation quality later through catalog identity work; do not add a provider-specific recommendation path.
- Add a "releasing today" or "up next" section only after the catalog schedule service exists.

## Related

- [search-service plan](../.plans/search-service.md)
- [metadata and trending contract](../.plans/metadata-and-trending-contract.md)
- [design system](./design-system.md)
