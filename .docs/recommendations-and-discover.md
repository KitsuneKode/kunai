---
status: current
lastReviewed: "2026-11-24T10:55:19Z"
---

# Kunai — Recommendations And Discover

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This is the canonical product and architecture reference for the `/discover`, `/calendar`,
and `/random` / `/surprise` discovery surfaces.

## Goals

- Discovery surfaces are lazy-loaded and never slow startup.
- Recommendations are explicit: the user opens `/recommendation`, chooses a post-playback nudge, or enables an optional startup hint.
- Calendar is a date-scoped schedule lens: it shows catalog release timing, not provider playability.
- Random is controlled: it shows a small explained tray and never auto-plays.
- Recommendation code stays outside provider adapters. Providers resolve streams; catalog/recommendation services provide browseable metadata.

## Current Implementation

| Capability                                    | Canonical location                                                                                                                                  | Status      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Recommendation service contract               | `apps/cli/src/services/recommendations/RecommendationService.ts`                                                                                    | Implemented |
| TMDB-backed implementation and cache helpers  | `apps/cli/src/services/recommendations/RecommendationServiceImpl.ts`                                                                                | Implemented |
| SQLite recommendation cache                   | `packages/storage/src/repositories/recommendation-cache.ts`                                                                                         | Implemented |
| Shared section builder                        | `apps/cli/src/app/discover/discover-sections.ts`                                                                                                    | Implemented |
| Unified discover result loader                | `apps/cli/src/app/discover/discover-results.ts`                                                                                                     | Implemented |
| Browse-shell discover loading + SWR           | `apps/cli/src/app-shell/ink-shell.tsx`, `apps/cli/src/app/search/SearchPhase.ts`                                                                    | Implemented |
| Release schedule service + SQLite cache       | `apps/cli/src/services/catalog/CatalogScheduleService.ts`, `packages/storage/src/repositories/schedule-cache.ts`                                    | Implemented |
| Calendar result loader                        | `apps/cli/src/app/search/calendar-results.ts`                                                                                                       | Implemented |
| Random result loader                          | `apps/cli/src/app/discover/random-results.ts`                                                                                                       | Implemented |
| Surprise catalog pool                         | `apps/cli/src/services/catalog/CatalogDiscoveryService.ts`, `apps/cli/src/app/discover/discovery-lists.ts`                                          | Implemented |
| Trending source chain + last-known-good       | `apps/cli/src/services/catalog/CatalogDiscoveryService.ts`, `apps/cli/src/services/catalog/catalog-durable-cache.ts`                                | Implemented |
| Anime trending fallbacks (Kitsu, Jikan → ARM) | `apps/cli/src/services/catalog/kitsu-trending.ts`, `apps/cli/src/services/catalog/jikan-trending.ts`                                                | Implemented |
| Command routing                               | `apps/cli/src/domain/session/command-registry.ts`, `apps/cli/src/app-shell/command-router.ts`                                                       | Implemented |
| Search-phase entry                            | `apps/cli/src/app/search/SearchPhase.ts`                                                                                                            | Implemented |
| Startup discovery routes                      | `--calendar`, `--random`, `/calendar`, `/random`                                                                                                    | Implemented |
| Post-playback nudge/action                    | `apps/cli/src/app/playback/playback-auto-advance.ts`, `apps/cli/src/app/playback/run-post-playback-menu.ts`, `apps/cli/src/app-shell/ink-shell.tsx` | Implemented |
| Startup hint config                           | `discoverShowOnStartup` in config                                                                                                                   | Implemented |
| Discover mode + item limit config             | `discoverMode`, `discoverItemLimit` in config                                                                                                       | Implemented |
| Minimal mode                                  | `minimalMode` in config and shell layout policy                                                                                                     | Implemented |

## Data Sources

Recommendations use TMDB surfaces on demand:

- title recommendations for recently watched titles
- trending
- recency-weighted genre affinity from local history

**YouTube mode** uses a separate native path (`YoutubeRecommendationService`): Invidious related videos, same-channel uploads, history channel affinity, then Invidious trending. It never falls through to TMDB discover for post-play rails.

### Degrading instead of blanking

Trending walks a chain of sources per lane and remembers the last good answer:

- **Sources.** Series and movies: TMDB (the Videasy proxy hosts, then direct
  TMDB on two hostnames). Anime: AniList, then Kitsu ("this season, most
  followed", topped up with "currently airing" early in a season; Kitsu's own
  `/trending` is mostly all-time classics), then Jikan (MyAnimeList "top
  airing"). Kitsu carries AniList ids in its included mappings; each Jikan
  entry is mapped through ARM. Entries without an AniList id are dropped rather
  than shipped with an id the anime flow would misread. Jikan is last because
  it needs one ARM lookup per entry and resolves only over IPv6 from some
  networks. A source that rejects or answers empty hands over to the
  next; a caller abort stops the walk.
- **Last-known-good.** Every successful list is written to
  `kunai-cache.sqlite` (`catalog:trending:<mode>`) and kept for 14 days. When
  every live source fails, the rail shows that list, labelled
  "Trending this week · updated 3h ago", and retries the live chain after a
  minute instead of on every render.
- **Recommendations** use the same idea. A row's `expires_at` is the 14-day
  retention window and freshness is judged from the payload's `cachedAt`; the
  repository deletes a row on read once `expires_at` passes, so tying row expiry
  to the freshness TTL had made the stale fallback unreachable. A refresh whose
  every upstream request failed never overwrites the last good answer.
- **Fallbacks are stand-ins, not equivalents.** A saved primary list younger
  than 24 hours is shown (labelled) before any live fallback; Kitsu's list is
  labelled "Kitsu · popular this season". A fallback answer is reused for 60
  seconds, not the 30-minute trending TTL, so the primary is retried soon. A
  fallback that fails is skipped for 10 minutes (Jikan is blackholed on some
  networks and would otherwise cost its timeout on every outage).
- **Shared walks.** Concurrent callers share one walk that owns its own abort
  signal; each caller can cancel its own wait, and the walk stops when its last
  waiter leaves. A refresh bumps a generation so an older walk cannot commit.
  With a saved list on hand, a walk slower than 1.2 seconds hands the caller
  that list and keeps filling the cache.
- **TMDB hosts** use a half-open breaker: when every host is inside its
  5-minute failure window, one request at a time probes the host whose window
  ends first, a failed probe holds further probes for 30 seconds, and any
  answer (including a 4xx) closes the breaker. A **429** is not an answer: the
  host is rested for 30 seconds and the walk moves on (and, with every host
  rate limited, the saved copy below answers). A mirror that replies HTTP 200
  with TMDB's error envelope (`success: false`) counts as that host failing.
- **Cancelled callers** never start a TMDB request, and every shared in-flight
  request has a handler, so a request that fails after all its callers left can
  never surface as an unhandled rejection (which `main.ts` treats as fatal).
- **Calendar loads** (`CatalogScheduleService.loadCached`) run on a request the
  service owns: each caller waits with its own signal, and the request is
  aborted only when the last waiter leaves. **Trending refresh**
  (`clearTrendingCache`) aborts walks it supersedes.

### Series fallback: last-known-good TMDB

Every successful TMDB show (`/tv/:id`) and season (`/tv/:id/season/:n`)
response is also saved to the cache database as a `tmdb:<path>` row
(`apps/cli/src/services/catalog/tmdb-durable-cache.ts`, wired in
`bootstrap-persistence.ts`, kept 30 days). When every TMDB host fails with a
transport error or a 5xx, `fetchTmdbJsonCached` serves the saved copy instead,
so a series opened in the last month still lists its seasons and episodes, and
per-title release info (next episode, release progress) still renders. A 4xx
other than 429 is an answer, not an outage, and is never masked by a saved
copy. Only a well-formed answer (a show with a `seasons` array, a season with
an `episodes` array) may replace the saved copy.

The saved copy is TMDB's own response, so numbering and identity are exactly
what playback, downloads and history expect. A TVmaze fallback was built and
dropped before merge: TVmaze numbers some real shows differently from TMDB
(The Office US S04E05 is "Local Ad" on TMDB and a different episode on TVmaze),
so a fallback episode list could start the wrong episode and write the wrong
history row.

### Search fallback: Wikidata

When every TMDB route fails, a plain-text movie/series search is answered from
Wikidata (`apps/cli/src/services/catalog/wikidata-search.ts`, called from the
registry catch in `SearchRoutingService.ts`). Wikidata is CC0 and keyless and
records TMDB's own ids (P4947 movie, P4983 TV), so a result carries the exact
TMDB id; items without one are never returned. Two requests: a CirrusSearch
query restricted with `haswbstatement:P4947|P4983`, then one SPARQL query for
the ids, English or `mul` label, earliest date, an anime flag (instance or genre
of anime) and the sitelink count. Exact title matches rank first, then the most
linked titles. The result reports `sourceName: "Wikidata (TMDB unreachable)"`
and `diagnosis.code: "catalog-fallback"`; a filtered (discover-style) search, a
caller abort, or a Wikidata failure keeps the original TMDB error.

### Catalog source contract

`apps/cli/src/services/catalog/catalog-source.ts` is the Phase 1 contract: a
capability is answered by an ordered list of `CatalogSource`s (primary first,
then stand-ins that return the SAME ids), and `walkCatalogSources` owns the
shared rules: a caller abort propagates and never reaches a stand-in, a
stand-in that failed is skipped for 10 minutes, an empty answer hands over
only when the capability says so (`handsOver`), and every answer is written
to the ledger below. A source that cannot prove identity (exact external ids,
never a name match) does not belong in a list. The calendar uses it today;
search (`SearchRoutingService`) and trending (`CatalogDiscoveryService`, which
also hedges to a saved list) still walk their own chains and are next.

### Calendar fallback: TVmaze mapped through Wikidata

When TMDB's airing-today list fails, the series calendar is rebuilt from
TVmaze's broadcast and streaming schedules for the day (US)
(`apps/cli/src/services/catalog/tvmaze-schedule.ts`). Each show is mapped to
its TMDB id in one Wikidata SPARQL request by its IMDb id (P345) or TheTVDB id
(P4835) (`mapShowsToTmdbTvIds` in `wikidata-search.ts`); a show that does not
map, maps to two TMDB ids, or whose two ids disagree is dropped. Entries carry
`via: "TVmaze"` and **no season or episode number**: TVmaze numbering can
differ from TMDB's, and the calendar turns an episode number on a released
entry into an optimistic "+N new" badge. Stand-in answers are kept in memory
for 60 seconds and never persisted (`CatalogScheduleService.loadCached`,
`isStandIn`), so the primary is retried soon and a restart never treats them
as TMDB's own. The calendar header says `series via TVmaze (TMDB unreachable)`
and each row's source reads "TVmaze calendar".

The anime calendar has no stand-in: Kitsu's `nextRelease` is empty for most
airing titles and Jikan is unreachable from some networks, so a guess would be
worse than the honest "anime schedule unavailable".

### Catalog source ledger

`apps/cli/src/services/catalog/catalog-source-ledger.ts` keeps the latest
answer per capability (search, trending, recommendations, series episodes) and
lane: which source answered, whether it was a fallback, and why. Writers are
`SearchRoutingService`, `CatalogDiscoveryService.loadTrendingSection`,
`RecommendationServiceImpl` (live write or saved list) and `tmdb-proxy.ts`
(live or saved show/season). The reader is the "Catalog sources" line in the
diagnostics panel (`app-shell/panel-data.ts`, fed by
`diagnostics-panel-source.ts`), shown as a warning while any answer is a
fallback.

### AniList client

Every read-only AniList request in the CLI goes through
`apps/cli/src/services/catalog/anilist-client.ts`: a process-wide rate-limit
cooldown (honours `Retry-After` and starts early when `X-RateLimit-Remaining`
is nearly spent; requests during it fail fast so surfaces reach their fallback),
in-flight dedupe of identical queries, and a bounded timeout even with a caller
signal. Tracker sync (`services/sync/AniListAdapter.ts`) is authenticated and
keeps its own policy; the providers package keeps its own client because it
cannot import the CLI.

Calendar uses catalog schedule services on demand:

- AniList releasing-today for anime mode
- TMDB airing-today for series mode
- SQLite schedule cache keyed by source, mode, title, season, episode, and local day window
- release-aware TTLs so future entries refresh around known release time rather than through a global daily sync

Random mixes the cached discover pipeline with a short-lived surprise catalog pool:

- anime mode samples a randomized AniList page/sort/genre combination
- series mode samples a randomized TMDB discover media type, page, and sort
- the surprise pool is cached briefly so rerolls are fast and do not hammer upstream APIs
- the tray guarantees a surprise-sourced candidate when that pool is available

It only changes browse results; it does not mutate playback state.

The shell should keep these as suggestions, not as autoplay or background network work.

## Post-Playback Rail

The post-playback rail is deliberately lightweight: it carries recommendation
identity (`id`, media type, optional source id, title, and year) into the shell,
but it does not resolve streams or call providers when the user presses a number.

`1`, `2`, and `3` queue the visible picks into the playlist at the end. The
mutation stays in the playback phase (`app/playback/playback-recommendation-actions.ts`); the shell only renders rows and reports the
typed action. This keeps playback context stable and prevents the rail from
turning into a hidden provider-resolution path.

`i` opens a recommendation action panel. Details are rendered from cached
recommendation metadata only. Download is available from that panel, but it
requires an explicit confirmation before Kunai performs provider mapping or
stream resolution. A cancelled download action must leave the post-playback
context untouched and perform no provider calls.

Manual release smoke for this panel lives in
[release-reliability-gate.md](./release-reliability-gate.md). Keep the smoke
focused on side effects: Details is metadata-only, cancelling Download performs
no provider work, and confirming Download enters the normal guarded download
flow.

## Runtime Rules

- Do not fetch recommendations or calendar data on process startup unless the user explicitly starts in that route (`--calendar` or `--random`).
- Keep history-derived personalization local.
- Cache recommendation responses with explicit freshness TTLs in SQLite cache DB, and keep rows for the retention window so the last good answer survives an outage.
- Cache schedule responses with release-aware TTLs in SQLite cache DB.
- Use stale-while-revalidate for discover loading in browse shell.
- If recommendations fail, show the last good answer with its age, else an empty/error state in Discover, rather than failing search or playback.
- Do not couple Discover to provider selection. Opening a recommendation should return to normal browse/title selection flow.
- Do not treat `airs today` as playable. Provider availability is checked only after the user chooses playback.
- Do not auto-play random picks. The user can rerun `/random` or `/surprise` to spin again, or select a title normally.

## Remaining Product Work

- Add stronger visual verification for discover, calendar, and random loading/layout at small and wide terminal sizes.
- Keep refining the discover companion treatment inside browse so recommendations, calendar entries, and random picks feel native.
- The anime calendar has no fallback source (AniList only; see "Calendar fallback" below), and the calendar does not show cache age. A lane that fails is named in the header ("anime schedule unavailable"); with every lane down it reports "Calendar sources unavailable". Per-title release info for followed series falls back to the last-known-good TMDB responses (below).
- Search has no fallback catalog source yet; the `CatalogSource` contract (provider-platform plan, phase 1) is where it lands.
- Personalized recommendation rows are keyed by the top history seeds and kept for the retention window with no per-namespace cap; add one if the table grows noticeably.
- Anime recommendation entry points can treat a numeric AniList history id as a TMDB id (pre-existing); route by media kind and external ids.
- YouTube mode uses a native recommendation path (Invidious related + same-channel + history channel affinity); keep refining mix weights and trending region.

## Related

- [search-service plan](../.plans/search-service.md)
- [metadata and trending contract](../.archive/plans/metadata-and-trending-contract.md)
- [design system](./design-system.md)
