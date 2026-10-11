---
"@kitsunekode/kunai": patch
---

feat(cli): `-i` accepts namespaced catalog ids (`anilist:21`, `mal:`,
`youtube:`)

A bare `-i` id was TMDB-only, and a namespaced one was parsed then dropped —
`kunai -i anilist:21` did nothing. Namespaced ids now reuse the share-link
`cat=ns:id` vocabulary: they carry `externalIds` into provider resolution, and
`anilist:`/`mal:`/`youtube:` imply their lane so `-a`/`-y` is not needed. A
namespace that conflicts with a lane flag, or an unknown namespace, warns on
stderr instead of silently ignoring the id. `imdb:` is rejected until a TMDB
/find resolution exists.
