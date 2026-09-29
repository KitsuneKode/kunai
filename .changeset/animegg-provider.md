---
"@kitsunekode/kunai": minor
---

Add AnimeGG as the anime backup, second after Miruro.

Miruro reaches a dozen streaming servers, but all of them through one site. When
that site is unreachable, so is every one of them. AnimeGG is the source that
shares nothing with it: its own catalogue, its own site, its own video servers,
and no dependency on AniList or AniDB — both of which were unavailable on the
day this was added.

Search, episode lists, sub and dub all come from AnimeGG itself. Subtitles on
subbed episodes are burned into the picture, so there is no separate track to
switch, and Kunai says so in the playback trace when a show has no dub and it
falls back to the subbed version.

Kunai tries it automatically when Miruro cannot play something; you can also
pick it directly in settings.
