# History / Calendar / Classification — Investigation & Roadmap

Date: 2026-06-06
Status: Investigated (root causes confirmed in code); fixes scoped, not yet implemented (except #3).
Source: live-terminal review by the user (stats, calendar, search, history, picker screenshots).

This captures the reported issues across stats, calendar, search, history, playback, and pickers so
the work survives across sessions. Each has a confirmed root cause + a fix design + effort.

## SHIPPED (correctness fixes, all gates green)

- **#3 filter-box redundancy** — local "Filter results" hidden under 12 results.
- **Autoplay** — a failed-to-start stream no longer pauses autoplay (load failure ≠ user
  interruption); `playback-session-controller.ts` `interruptedStop` now excludes
  `didPlaybackFailToStart`. No auto-skip happens without a completion.
- **Episode-picker escape-stuck (single-season)** — `session-flow.ts` `pickEpisodeSelection` looped
  forever (single season auto-re-selected → re-opened episode picker). Escape now exits when
  `seasons.length <= 1`.
- **List-row spill/overlap (calendar + history)** — `ListRow.tsx` `listRowStatusColumn` expanded the
  column to the status's own width (`Math.max(measureColumns(status), width)`), overflowing the row
  and wrapping a long status ("aired · not available") into the next row. Now capped at the budget.
- **Tracks footer** — no longer says misleading "facts only, Esc closes" when the panel is still
  navigable; shows nav hints regardless of switchability.

## STILL OPEN (larger / data-dependent / need live verify)

- **History broken lines (Image #8)** — likely kitty poster-ghost class (not the list-row spill).
  Needs the user's terminal; same family as A6 ghost poster.
- **#1 classification, #2 calendar dates, #4 type filter, #5 series-%, #6 history posters,
  #7 picker context** — see below.
- **Post-play polish** — recommendations only sometimes appear (warm-race), want small poster
  thumbnails on rec cards, general visual cleanup. Poster rendering is the ghost-risk area.

---

## #1 Titles misclassified as anime (e.g. Perfect Crown, Absolute Value of Romance, Wonderland)

**Root cause (confirmed):** Watch-history `mediaKind` is **mode-derived, not content-derived**.

- `apps/cli/src/app/PlaybackPhase.ts:1771` writes `kind: mode === "anime" ? "anime" : title.type`.
- The anime search pipeline maps _everything_ to `type: "series"`:
  `apps/cli/src/services/search/definitions/anilist.ts:151` and
  `packages/providers/src/allmanga/api-client.ts:654` both set `type: "series"`.
- So `title.type` never carries "anime"; only the shell **mode** does. AllAnime/AllManga also host
  **live-action C-dramas/K-dramas** — watched in anime mode they become `kind: "anime"` permanently.

**Why it's not a one-liner:** there is no clean signal distinguishing a real anime from an AllAnime
live-action drama at write time — both are `type: "series"`, `mode: "anime"`.

**Fix design (needs live validation against the user's library):**

- Introduce a content classifier `classifyTitleKind(title)` returning `anime | series | movie`:
  - `movie` when `title.type === "movie"`.
  - `anime` when the title has genuine anime provenance: `metadataSource` includes "AniList", OR
    `externalIds.anilistId`/`externalIds.malId` present, OR TMDB genres include Animation with JP
    origin. (AniList/MAL only list anime; C-dramas carry only TMDB tv ids.)
  - else `series`.
- Replace the mode ternary at `PlaybackPhase.ts:1771` (and the other mode-derived `mediaKind`
  sites: `workflows.ts:3304` playlist, `DownloadOnlyPhase.ts:136`, `stream-request-adapter.ts:29`
  for the history-facing path) with `classifyTitleKind`.
- **Backfill:** existing history rows are already mislabeled. Add a one-shot migration that
  re-classifies rows whose title has no AniList/MAL id and non-animation TMDB genres → `series`.
- **Risk:** a real anime lacking AniList/MAL ids would demote to `series`. Validate the heuristic
  against the user's real history before backfilling. Unit-test `classifyTitleKind` with fixtures.

**Effort:** Medium. Blocks #4 being meaningful.

---

## #2 Calendar day strip shows broken dates (`SAT 6 · MON 8 · SAT 5 · SAT 7`; anime "Nothing on schedule")

**Root cause (confirmed):** `apps/cli/src/app-shell/calendar-view.ts:134` builds `dayStripLabels`
from `windowCalendarDayStrip(buildCalendarDaysFromOptionsView(options))` — the chips come from
whatever release dates the schedule options carry, **without sorting/dedupe/validation**. SAT cannot
be the 5th, 6th, and 7th in one week, so the strip is mixing days from different weeks/months and/or
malformed/TBD dates (e.g. "Wonderland · TBD · aired · not available", a 2021 series with no real
upcoming date). The anime strip is empty because that schedule data is missing/malformed.

**Fix design:** In `buildCalendarDaysFromOptionsView` (and the schedule source feeding it):

- Drop options with unparseable/`TBD` release dates from the day strip (still allow them in "For you").
- Sort day chips chronologically and dedupe by day-key before windowing.
- Validate weekday-label vs day-number agreement (compute weekday from the actual date, don't trust a
  stored label).
- Investigate why anime schedule yields nothing (CatalogScheduleService anime path —
  `apps/cli/src/services/catalog/CatalogScheduleService.ts:295`).

**Effort:** Medium. Needs the user's live schedule data + TTY to confirm.

---

## #3 Redundant "Filter results" box on small result sets ✅ SHIPPED (`38a88bcc`)

**Root cause:** `browse-shell.tsx` rendered the local "Filter results" narrow input on every results
view (even a 6-item search), stacked above the "Search title" box — two overlapping inputs.

**Fix shipped:** Gate the local filter on `options.length >= MIN_RESULTS_FOR_LOCAL_FILTER` (12), via
a single `showResultFilterBar` used by both the render and the focus-zone context. Small searches no
longer show it. Typecheck green.

---

## #4 History type filter (Anime / Series / Movie)

**Design:** Add a second tab axis to the history overlay alongside the bucket tabs
(Continue/Completed/New/All), mirroring the calendar's type tabs. Filter `flatRows` by
`historyContentType`/`mediaKind`. Files: `history-view.ts` (filter + tab model),
`history-shell.tsx` (render type tabs), `root-overlay-shell.tsx` (Shift+Tab cycles type + state).

**Blocked by #1:** filtering on the current (wrong) `mediaKind` would still show misclassified dramas
under Anime. Do #1 first.

**Effort:** Medium.

---

## #5 "% of series completed" gauge

**Root cause / gap:** `HistoryProgress` (`packages/storage/src/repositories/history.ts`) stores the
current `season`/`episode`/`absoluteEpisode` and within-episode `percentage` only — **no total
episode count**. The release projection knows the _next_ episode number, not the series total. The
"Progress 2%" shown today is only within the current episode.

**Fix design:** Plumb a total/latest-released episode count (TMDB season episode counts / AniList
episodes) into the history row, then render series-% = `(currentEpisode-1 + episodeProgress) / total`.
Source via the catalog/release services already used for the "new episodes" bucket.

**Effort:** Medium (catalog-data wiring). Independent of #1/#4.

---

## #6 History entries lack poster / metadata (feels broken)

**Gap:** history rows render no poster art; `HistoryProgress` has no artwork/poster URL. The preview
rail in the history overlay has nothing to show.

**Fix design:** Persist a poster URL (+ minimal metadata) onto history rows at write time (the title
already carries `posterPath`/artwork during playback), and render it in the history preview rail
(`history-shell.tsx` already imports a PreviewRail). Backfill posters lazily from catalog on read for
old rows. Schema add to the history table.

**Effort:** Medium (storage schema + write + render + backfill).

---

## #7 "Where to start?" picker lacks poster / details

**Gap:** the start-episode picker (`session-flow.ts` / the picker overlay) shows action rows only —
no poster, synopsis, or title context, so the user lacks context for what they're opening.

**Fix design:** Reuse the two-pane preview-rail pattern (as the episode picker C11 and the new tracks
panel do): add a right-hand rail with poster + title + year + synopsis to the start picker overlay.

**Effort:** Small–Medium (reuse existing PreviewRail; thread title metadata into the picker overlay).

---

## Suggested order

1. **#1 classification** (foundational; unblocks #4 and fixes stats) — validate heuristic on live data.
2. **#4 history type filter** (clean once #1 lands).
3. **#6 history posters** + **#7 picker context** (shared preview-rail/metadata work).
4. **#5 series-%** (catalog episode counts).
5. **#2 calendar dates** (own focused pass with live schedule data).

All except #3 need the user's live terminal/data to verify, so each should land with a live check.
