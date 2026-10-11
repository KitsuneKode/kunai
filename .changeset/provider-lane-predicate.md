---
"@kitsunekode/kunai": patch
---

Three call sites re-derived the lane predicate as `isAnimeProvider === (mode
=== "anime")` — a two-way boolean that treats the YouTube lane as "series".

The provider picker in YouTube mode offered and persisted series providers,
the post-play provider count included them, and a "series lane" health reset
silently cleared YouTube's failure memory. All three now use the canonical
`providerMetadataMatchesLane(metadata, shellModeToProviderLane(mode))`, and
the health-reset lane boundary is pinned by a test.
