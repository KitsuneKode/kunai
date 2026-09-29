---
"@kitsunekode/kunai": patch
---

Stop a provider that answers "nothing" from failing as an internal error.

Some provider APIs reply `200 OK` with a body of `null` when they have no
source for a title — VidLink does it for every title right now. Kunai read a
field off that reply and threw, so instead of moving on to the next provider it
reported an error from inside itself.

Four providers read a response this way — VidLink, Videasy, AllManga's title
lookup and its key bootstrap — and all four now treat an empty reply as "no
source here" and hand over to the next one.
