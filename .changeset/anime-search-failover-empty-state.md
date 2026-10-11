---
"@kitsunekode/kunai": patch
---

Anime search now fails over across the provider lane and names outages in
empty states.

`searchTitles` used to try exactly one anime provider for a plain query: an
AniDB throw aborted the search even though HiAnime, AllAnime, or Miruro could
have answered, and an empty answer rendered the same "No results" copy as a
typo. The lane now iterates its providers in priority order — a provider that
throws is recorded and the next one is asked — while an honest empty answer
still hands the query to the registry catalog exactly as before. Provider
failures ride the result as `providerSearchFailures`, so the browse empty
state and the diagnostics event can say "Provider search failed (anidb)"
instead of the generic "no results" copy, and `compatible-catalog-unavailable`
advanced searches get their own message. Bootstrap (`-S`) searches pass the
same copy into the shell through a new `initialEmptyMessage` prop.
