---
"@kitsunekode/kunai": minor
---

Make Miruro the default anime provider, with AniDB and AllManga behind it.

anidb.app — the previous default, and the only source ani-cli v5 uses — has been
in maintenance since 3 September. With it selected, anime search came back empty
and nothing played. Miruro fronts roughly a dozen streaming backends behind one
AniList-keyed service, so when one of them goes down Kunai moves to the next
server instead of failing the episode. AniDB and AllManga stay registered and are
tried automatically when Miruro fails.

Anime search now goes through Miruro as well, which matters because AniList's own
API was switched off on 10 September — Kunai's only other anime catalog. If
Miruro's search comes back empty, Kunai still asks AniList.

Miruro could hand out a link to a server that was itself down — one of its
servers kept pointing at AniDB's video host through the maintenance — and that
link won. Kunai now checks the link before accepting it and moves to the next
server when the host answers that it is gone.

Existing installs are moved too. Kunai writes your whole config whenever you
change any setting, so the old AniDB default was saved to disk looking exactly
like a choice you made. On the first launch after this update, a config whose
anime settings are still exactly that old default is moved to the new order,
once. Anime settings you had changed are left alone, and if you pick AniDB again
afterwards, it stays picked.
