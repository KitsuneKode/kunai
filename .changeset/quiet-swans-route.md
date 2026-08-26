---
"@kitsunekode/kunai": patch
---

Route an AniDB season request to a show's final season instead of failing.

### Fixes

- AniDB models each season as its own title, and names a show's last run "Final
  Season" rather than "Season N". The router filtered candidates on an exact
  `seasonNumber` match, so every candidate was discarded and Attack on Titan
  season 4 could not be routed at all, while seasons 2 and 3 resolved normally.

### Behavior

- The ordinal is derived from the sibling set rather than the words: a final
  season is the run after the highest numbered season the show actually has.
  Attack on Titan carries Season 2 and Season 3, so its Final Season is season
  4 — and a request for season 6 still resolves to nothing.
- Sub-parts of a final run are not the run itself. AniDB splits Attack on Titan
  across "Final Season", "Final Season Part 2" and "Final Season - The Final
  Chapters"; only the season itself is a routing target.
- Shows whose sequels are named after story arcs keep failing closed. Demon
  Slayer carries no numbered sibling, and AniDB, AniList and TMDB disagree about
  which arc is season 2, so there is no evidence to route on and playing the
  wrong arc is worse than not resolving.
