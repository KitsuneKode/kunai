---
"@kitsunekode/kunai": patch
---

Restore AllManga anime playback after the upstream crypto rotation.

mkissa rotated its client crypto and every pinned constant moved at once — the
build id, all four mask fragments, the derivation constants, the boot prefix and
separator, the boot payload field order, and the persisted-query hash. Between
rotations the provider failed silently: bootstrap fell back to bundled material,
the episode query decoded nothing, and every resolve reported zero streams,
which reads as "this anime has no sources" rather than "our constants expired".

`bun run test:live:allmanga-crypto` now answers whether the pinned set still
works and which half is stale, so the next rotation is a lookup rather than an
investigation.
