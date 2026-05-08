# Kitsune Design System And Recommendations Plan

Status: mostly completed; remaining work is verification and polish

This plan supersedes the previous generated execution plan, which was created before most implementation landed and still had stale unchecked boxes.

## Completed

- Added `packages/design` as the shared design token package.
- Wired CLI theme usage to shared design primitives.
- Added content badge and label truncation helpers.
- Added `minimalMode` and `discoverShowOnStartup` config fields.
- Fixed `effectiveFooterHints` to honor minimal mode.
- Added viewport policy helpers and resize blockers.
- Added `RecommendationService` and implementation.
- Added shared `buildDiscoverSections`.
- Added `DiscoverShell`.
- Registered and routed `/discover` and recommendation aliases.
- Added search-phase and post-playback Discover entry points.
- Added post-playback discover nudge.
- Added recommendation and discover-related unit coverage.

## Remaining Work

- Add visual/snapshot coverage for Discover at narrow, normal, and wide terminal sizes.
- Audit Discover keyboard behavior against `.docs/keybindings.md`.
- Decide whether Discover remains a dedicated screen or becomes part of a broader browse companion model.
- Keep anime recommendation quality tied to catalog identity work rather than provider-specific recommendation scraping.
- Generate web CSS tokens only when a web app starts consuming `@kunai/design`; until then, TypeScript tokens are the source of truth.

## Recommendation Follow-Up

- Add a refresh action that invalidates only recommendation cache entries, not unrelated search/catalog caches.
- Add graceful empty states for missing history, TMDB failures, and no similar titles.
- Feed schedule-aware sections from the future catalog schedule service:
  - anime airing today
  - TV episodes airing today
  - caught-up titles with next release date
- Keep `/discover` lazy. No recommendation or schedule network calls on startup.

## Canonical Docs

- [.docs/design-system.md](../.docs/design-system.md)
- [.docs/recommendations-and-discover.md](../.docs/recommendations-and-discover.md)
- [.plans/catalog-release-schedule-service.md](./catalog-release-schedule-service.md)
- [.plans/search-service.md](./search-service.md)
