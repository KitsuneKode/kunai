---
"@kunai/providers": patch
"@kitsunekode/kunai": patch
---

fix(providers): revive KickAssAnime on the CatStream rotation and wire AllManga into endpoint health

KickAssAnime's servers list renamed `VidStreaming` to `CatStream` on the same
cat-player page, and its manifest now arrives protocol-relative
(`//bl.krussdomi.com/…`) rather than double-slashed — both names are playable
and the URL normalizer pins the bare `//` form to https. AllManga's source
cycle now keys candidates on each stream's own host and feeds the shared
endpoint quarantine, so a mirror host refused by the resolve-gate probe is
skipped on the next resolve instead of being re-probed forever. The status
sweep probes all twelve production modules (vidrock, movy, animegg and
kickassanime were missing) and a roster-parity test fails loudly if the lists
drift again.
