---
"@kitsunekode/kunai": patch
---

fix(downloads): English-anime downloads re-resolve to the dub catalog

`persistLanguageHintsFromEnqueueInput` mapped every non-"dub" audio value to
`anime_lang: "sub"`, so a profile with `animeLanguageProfile.audio: "en"` (the
documented "Prefer English audio" option) stored `"sub"` on its download jobs —
and repair/runway re-resolves then pulled the sub catalog instead of the dub the
user asked for. The hint now derives from `resolveAnimeAudioIntent`, the same
mapping the resolver uses, so `"en"` and `"dub"` both record the dub catalog.

fix(providers): movy records gate evidence per lane and stops re-walking dead lanes

Movy's resolve gate refusal carried `endpointScoped` into a cycle that never
received `endpointHealth`, so the flag was dropped and a definitively-dead lane
was re-fetched on every resolve. The cycle now gets `endpointHealth`/`titleId`
keyed by lane (each lane is a distinct upstream scraper), and cycle failures are
pushed into the resolve's failure list like Rivestream does.
