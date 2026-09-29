---
"@kitsunekode/kunai": patch
---

feat(catalog): season→entry resolution contract over the relation graph (#266)

`TitleIdentity` gains `relations` + `aliases`, and `resolveSeasonEntryId` walks
the prequel/sequel graph deterministically — continuations ("Part 2") and
movies are traversed but never counted as seasons, so the AoT chain resolves
S4 to Final Season rather than S3 Part 2. Ambiguous graphs fail closed.
Graph population and the AniDB consumer land as follow-ups.
