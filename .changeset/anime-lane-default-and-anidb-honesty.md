---
"@kitsunekode/kunai": patch
---

Make the anime lane lead with a provider that answers, and report an AniDB outage as an outage.

Anime search only queries the configured lane default, so a default that cannot
answer is not a slow path — it is a broken entry point. `anidb.app` answers 503
at the origin, and ani-cli itself moved off AniDB onto HiAnime
(`pystardust/ani-cli` c99221d, _"replace anidb with hianime provider"_,
2026-09-11 — a `fix:`, not a `revert:`). The anime lane now leads with HiAnime
and keeps AniDB registered and second, because AniDB still carries the only
verified AID cross-link and XML episode titles. A config that already names
AniDB explicitly is left alone.

Separately, AniDB's browse scrape asked for its HTTP body without asking for the
HTTP status, so a 503 reached the parser as an error page, the parser found no
cards, and `search` returned an empty list. The user saw "No results for …" for
a provider that was down, and the release signoff read the empty failure codes
and filed it as provider drift. It now asks for the status and returns `null` —
the contract's transport-failure channel, which is what HiAnime and AllManga
already do — so an unreachable provider is distinguishable from a title that is
genuinely not on AniDB.
