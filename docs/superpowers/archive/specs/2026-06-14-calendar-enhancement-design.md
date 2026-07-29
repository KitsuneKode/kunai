# Calendar enhancement — Spec B

Date: 2026-06-14
Status: Draft (spec)
Topic: Make the release calendar trustworthy and actionable on the corrected availability spine. Second of the three-spec availability program (A = notifications, done).

## Why

The calendar is already feature-rich (day strip, type tabs, countdowns, poster plumbing,
"For you · releasing today" band, past-week archive). Two things hold it back:

1. It rode the pre-fix release-progress spine that had a calendar/reconciliation
   **writer race** — counts and states could be optimistic/wrong. Spec A introduced
   `ReleaseProgressWriter` (authoritative wins; optimistic never clobbers fresh). The
   calendar should now be audited + locked to that corrected data.
2. It is **read-only and undifferentiated** — every release looks the same whether it
   aired a minute ago or last week, and you cannot act on a release without leaving
   the calendar.

Spec B closes those: a correctness pass, "new since last visit" differentiation,
inline actions, and poster-led rows. (The week-at-a-glance grid is Spec B.2.)

## Goals

1. **Correctness** — accurate `+N new` counts, no duplicate/stale rows, correct
   `airing now / in Nh / released / countdown / missed` state transitions, all
   covered by pure-model tests.
2. **New since last visit** — persist `lastCalendarVisitAt`; mark releases newer than
   it; update on close. Same freshness idea as the notifications bell.
3. **Actionable rows** — play / queue / follow(bookmark) / download the selected
   release, reusing the existing media-action router (the one notifications use).
4. **Poster-led rows** — mini-poster per release + the focused release as the single
   Kitty hero, using the calendar model's existing `posterUrl`/`posterState`.

## Non-goals

- Week-at-a-glance grid view (Spec B.2).
- History enhancement (Spec C).
- New schedule data sources or reconciliation cadence changes.

## Locked decisions

| Decision          | Choice                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Scope             | correctness + new-since + actionability + posters; grid deferred to B.2                                    |
| New-since storage | `lastCalendarVisitAt: number` on `KitsuneConfig`; updated when the calendar closes                         |
| "New" rule        | a release is new when its `releaseAt` (or first-seen new-episode detection) is after `lastCalendarVisitAt` |
| Actions source    | the existing `createContainerMediaActionRouter` — one code path shared with notifications                  |
| Poster tier       | mini-poster (inkEmbedded text) per row; one Kitty hero for the focused release                             |

## Architecture

### 1. Correctness pass (pure model)

Audit `calendar-ui.model.ts` + `calendar-results.ts` against the corrected spine:

- `+N new` badge derives from the authoritative `release_progress_cache.newEpisodeCount`
  (via the projection the calendar already reads), never an optimistic guess that a
  fresh authoritative row should override.
- Row state machine (`airing now` / `in Nh` (countdown) / `released` / `missed` /
  `resolving`) transitions are exhaustively unit-tested around `nowMs` boundaries.
- De-dup: a title with multiple schedule entries in the window collapses to one row
  per (titleId, releaseAt); no duplicate "Previous … available"-style pileups.

No data-flow change — this is hardening + tests on the now-correct source.

### 2. New since last visit

- Add `lastCalendarVisitAt: number` to `KitsuneConfig` (default 0). 4-file config
  pattern (interface/store/impl/metadata), like `showWatchTimeStats`.
- Pure helper `isReleaseNew(option, lastVisitAt, nowMs)` → true when the release
  became available after `lastVisitAt` and on/before now (aired-since-last-look).
- The view-model tags each row `isNew`; the row renders a `●` accent dot + brighter
  title (mirrors the unread treatment in notifications).
- On calendar close, persist `lastCalendarVisitAt = Date.now()` via ConfigService.
  Done at the close **event** (where the calendar surface unmounts/leaves), not a
  render effect — consistent with the notifications open-event learning.
- A header crumb: `N new since last visit` when any are new.

### 3. Actionable rows

- A pure `calendarRowActions(option)` → the action set valid for that release
  (always: play; series/anime: queue, follow, download; movie: queue, download).
- Wire keys in the calendar input path: `⏎` play (existing select path), `+` queue,
  `w` follow/bookmark, `d` download — each dispatched through
  `createContainerMediaActionRouter(container, …)` with a `MediaItemIdentity` built
  from the calendar option (the same builder notifications use).
- A transient status line confirms the action ("Queued Frieren", "Following").
- The footer advertises the active keys.

### 4. Poster-led rows

- `CalendarScheduleRow` gains a leading mini-poster cell (reuse the queue/post-play
  text mini-poster: `usePosterPreview({ inkEmbedded: true, preserveTerminalImages: true })`),
  fed by `option.calendar.posterUrl` (falls back to initials/type glyph).
- The focused (selected) release renders one real Kitty hero in a side rail on wide
  terminals (single-image budget); narrow degrades to no hero.
- Reserved poster height so image load never shifts rows.

### Data flow

1. `calendar-results.ts` loads schedule + reads authoritative projections (unchanged
   source; correctness pass hardens derivation).
2. View-model tags each row `isNew` (from `lastCalendarVisitAt`) and exposes
   `posterUrl` + the valid action set.
3. Calendar input → media-action router for `+`/`w`/`d`; `⏎` keeps the existing
   select-to-play path.
4. Calendar close → `ConfigService.update({ lastCalendarVisitAt: Date.now() })`.

## Testing

- Row state machine: pure unit tests across `nowMs` boundaries (airing/countdown/
  released/missed/resolving) and `+N new` from authoritative counts.
- De-dup: two entries same (titleId, releaseAt) → one row.
- `isReleaseNew`: before/after `lastVisitAt`, future releases excluded.
- `calendarRowActions`: correct set per content kind.
- View-model: `isNew` tagging + poster URL surfaced + action set per row.
- `CalendarScheduleRow` / calendar frame: `captureFrame` snapshots — new dot, poster
  cell, status text, no layout jump; wide vs narrow.
- Config: `lastCalendarVisitAt` default + persistence (mirror existing config tests).
- Actions: dispatch maps the selected option to the right media action (seam test,
  reusing the notifications media-action pattern).

## Out of scope / follow-ups

- Spec B.2: week-at-a-glance grid view.
- Spec C: history enhancement (will reuse new-since + poster + action patterns).
- Per-release "snooze"/mute from the calendar (extends follow/mute; defer).
