# Series catalog end-state, upcoming episodes, and autoplay clarity

Status: **active** — runtime policy and navigation copy; complements TMDB-backed series metadata and anime provider catalogs.  
Owner: playback / session UX  
Scope: Honest **catalog end-state**, **“coming soon”** (unreleased TMDB episodes), **autoplay** that never targets unknown or unreleased episodes, and **prefetch** that only warms the next **released** episode.

---

## Goals

1. **Released-only autoplay:** Auto-advance and near-EOF prefetch only use `nextEpisode` entries that represent the next **released** catalog episode (TMDB `air_date` when parseable and in the past).
2. **Upcoming visibility:** When the user is caught up to the latest **released** episode but TMDB lists a **future** next episode, surface that as `upcomingNext` with clear copy — not as a playable next.
3. **Anime honesty:** Provider catalogs rarely expose release dates. Do **not** invent `currentEpisode + 1` when the list does not contain that index. Prefer **uncertain** copy over false confidence; keep autoplay off unless the next index is explicitly listed (or other agreed safe signal).
4. **Diagnostics:** Autoplay block reasons distinguish **true end**, **upcoming not released**, and **anime catalog uncertainty** for logs and future UI.

---

## Data model (`EpisodeAvailability`)

| Field | Meaning |
| ----- | ------- |
| `previousEpisode` | Prior **released** episode (TMDB) or provider-derived previous (anime), within existing rules. |
| `nextEpisode` | Next **released** episode for playback / N-key / autoplay; `null` if none. |
| `nextSeasonEpisode` | First **released** episode of the next season (season jump); unchanged semantics. |
| `upcomingNext` | Next catalog episode after the current one that exists but is **not** released yet (TMDB only); `null` if not applicable. Mutually exclusive with having a released `nextEpisode` for the same slot. |
| `animeNextReleaseUnknown` | `true` when anime mode cannot confirm a catalog-backed next episode but the title is not provably at the last known episode (count / list). |

Navigation copy and `explainAutoplayBlockReason` consume these fields.

---

## TMDB stance

- **Source of truth for “released”:** TMDB episode `air_date` parsed with `Date`; invalid or missing dates are treated as released (existing `isReleased` behavior) to avoid blocking on bad metadata.
- **Upcoming:** Scan full season episode lists (not only released rows) in order; if there is no **released** successor in the current or next season but an **unreleased** successor exists, set `upcomingNext`.
- **Prefetch:** Unchanged guard: only prefetch when `nextEpisode` is non-null (released).

---

## Anime limits

- **Autoplay / next resolution:** Set `nextEpisode` only when the sorted provider list contains an option with `index > currentEpisode.episode`.
- **No synthetic next:** Remove optimistic `currentEpisode + 1` when the list omits that index, even if `episodeCount` suggests a longer run.
- **End vs uncertain:** If `episodeCount` (or max list index) proves the current episode is the last, `animeNextReleaseUnknown` is `false` and copy reflects catalog end. If more episodes are implied but not listed, `animeNextReleaseUnknown` is `true`.

---

## UX criteria

- **Next command / `hasNext`:** True only when `nextEpisode` is non-null (playable next).
- **When next is disabled:** `nextUnavailableReason` must reflect **upcoming** (TMDB), **anime uncertain**, or **at latest released** — not a generic single string for all cases.
- **Autoplay:** User sees a distinct block reason in diagnostics when the barrier is “not released yet” vs “no next” vs “anime catalog gap”.

---

## Tests

- **Integration (`playback-policy`):** TMDB fixture with a future-dated following episode → `nextEpisode === null`, `upcomingNext` set, `getAutoAdvanceEpisode` null, `toEpisodeNavigationState` / reasons correct.
- **Integration:** Anime with `episodeCount` and a sparse list that previously triggered `+1` fallback → `nextEpisode` null and `animeNextReleaseUnknown` where specified.
- **Unit (`playback-session-controller`):** `explainAutoplayBlockReason` returns `next-episode-not-released-yet`, `anime-next-uncertain`, and `no-next-episode` in the right conditions.

---

## Implementation notes

- **Call sites:** `resolveEpisodeAvailability` in `PlaybackPhase` and `session-flow` must carry the extended shape; any manual `EpisodeAvailability` literals in tests need `upcomingNext` and `animeNextReleaseUnknown`.
- **Shell:** `EpisodeNavigationState` may gain optional `upcomingNextLabel` when we want badges; initial pass can encode everything in `nextUnavailableReason` to limit surface churn.
- **Related:** Autoplay chain and prefetch live in `PlaybackPhase`; they already key off `nextEpisode` — keep that invariant.
