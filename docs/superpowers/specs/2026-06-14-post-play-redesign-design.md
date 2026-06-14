# Post-play redesign — Next-Up hero, poster picks, finale celebration

Date: 2026-06-14
Status: Draft (spec)
Topic: Redesign the post-playback surface into a premium, state-aware "what next?" screen.

## Why

The post-play screen is the highest-leverage "what next?" moment in the app — the
equivalent of Netflix post-play, Crunchyroll's next-up card, or a YouTube end
screen. Today it under-delivers:

- The **next episode** — the single most important thing — is rendered as plain
  action row #1, while a real poster sits idle in the side rail.
- The **autoplay countdown** already emits a per-second `onTick(remaining)`
  (`autoplay-advance-countdown.ts`), but that value is dumped into a transient
  status note (`Next E08 in 5s · n now · a pause`) rather than designed into the
  screen.
- **Recommendations** are bare text cards (index + title + reason) — no posters,
  no streaming-grid feel.
- **Finishing a series** is visually indistinguishable from finishing an episode
  beyond a color token — no sense of reward.

This is a holistic redesign of the unit, not a poster bolt-on.

## Goals

1. Promote a **Next-Up hero card** with the next-episode thumbnail and a **live
   autoplay countdown**.
2. Turn recommendations into a **poster rail** (hybrid-C: one real Kitty hero +
   text mini-posters for picks).
3. Give each of the **7 post-play states** a distinct, coherent identity.
4. A **series-complete celebration** with catalog stats and an optional,
   configurable personal watch-time stat.
5. Hold the **responsive discipline** established by the schedule fix: graceful
   wide/medium/narrow, reserved heights, no layout jump on image load.
6. A **unified keyboard model** across actions and picks with a legible live-keys
   footer.

## Non-goals

- No change to playback resolution, provider flow, or the autoplay decision logic
  itself — only how the countdown is _surfaced_.
- No new recommendation source or ranking work; we render what
  `PlaybackRecommendationRailItem[]` already provides.
- No Kitty multi-image rendering — the one-image constraint stands.

## Locked decisions

| Decision                     | Choice                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Pick tile composition (wide) | **Poster on top** (Netflix tile): mini-poster, then `1/2/3` badge, bold title, dim reason.                     |
| Next-Up hero                 | **Full hero + live countdown** — route `onTick(remaining)` into the shell.                                     |
| Finale celebration           | Catalog stats **always**; personal watch-time stat **behind a config flag**.                                   |
| Image budget                 | The single Kitty image goes to the **Next-Up thumbnail**; all picks use **text mini-posters** (`inkEmbedded`). |

## Architecture

Keep the existing **pure view-model + render-only component** split:

- `post-play-view.ts` (`buildPostPlayView`) — all derivation. Extended, not
  rewritten.
- `post-play-shell.tsx` — render only. No inline derivation.

### Data flow

1. **Pick posters.** In `buildDiscovery`, resolve each pick's poster:
   `resolveCatalogPosterUrl(rec.posterPath, { tmdbSize: "w185" })`
   (`@/domain/catalog/resolve-catalog-poster-url`). Add `posterUrl?: string` to
   `PostPlayDiscoveryCard`. Render via the queue's `MiniPoster` mechanism
   (`usePosterPreview({ inkEmbedded: true, preserveTerminalImages: true })`) so
   many picks coexist with the rail's single Kitty hero.

2. **Live countdown.** `PlaybackPhase.runAutoNextCountdown`'s `onTick(remaining)`
   currently writes a feedback note. Add a shell-visible countdown channel: route
   `remaining` to the post-play shell as a prop (`autoNextCountdownSeconds?: number`)
   via the same state the shell already reads (mirror how other live playback
   feedback reaches the surface). Keep the note as a fallback when the post-play
   shell is not mounted. When `autoNextCountdownSeconds` is present, the Next-Up
   hero shows `Playing {label} in {n}s` and the `n now · x cancel` affordances;
   when absent, it shows the static `↵ play · e episodes`.

3. **Watch-time aggregation.** A small pure helper sums a title's history:
   `listByTitle(titleId)` → `{ watchedSeconds, episodeCount, dayCount }`
   (`watchedSeconds` = Σ `positionSeconds`; `dayCount` = distinct calendar days
   with activity). Surfaced only on `series-complete`, and only when the config
   flag is enabled. Formatted as `You watched ~11h over 9 days`.

4. **Config flag.** Add `showWatchTimeStats: boolean` (default `true`) to
   `KitsuneConfig` via `ConfigService`. The series-complete builder omits the
   personal stat when disabled. (Exposed in the settings panel later in the
   roadmap — out of scope here beyond the config field + read path.)

### The Next-Up hero

A bordered card at the top of the body column (above the action list) for states
that have a next thing to play (`mid-series`, `stopped-early`, and queue-backed
`movie-complete`/`series-complete`/`caught-up` when a queue head exists):

```
┳━ ▶ UP NEXT ━━━━━━━━━━━━━━┓
┃ ▓▓▒▒▓▓  S04 · E08         ┃
┃ ▓▓▒▒▓▓  Challengers       ┃
┃           Playing in 4s    ┃
┃  ↵ now   x cancel   e eps  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

- Thumbnail = next-episode still (`nextEpisodeThumbUrl`) → series poster
  (`posterUrl`) → title initials. The **one** Kitty image.
- Countdown line is present only while `autoNextCountdownSeconds` is set.
- The hero replaces the rail's standalone `RailArtwork` as the primary image slot;
  the rail keeps facts + (on wide) a secondary poster only if budget allows —
  default: rail no longer renders a competing Kitty image (avoids clobber).

### State identities (7)

| State             | Identity                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `mid-series`      | Next-Up hero dominant (countdown), picks secondary.                                                                                        |
| `stopped-early`   | Next-Up hero = Resume (same stream/position), picks secondary.                                                                             |
| `season-finale`   | "Season N complete" banner; Continue-to-next-season hero (or picks-led if no next season); season progress bar.                            |
| `series-complete` | **Celebration**: plum milestone banner + catalog stats + optional watch-time; picks become the forward path ("because you finished this"). |
| `caught-up`       | Next-broadcast / calendar framing + Bookmark; picks below.                                                                                 |
| `movie-complete`  | Completion line; picks lead; queue head as Up-Next if present.                                                                             |
| `did-not-start`   | Calm recovery (retry / fallback / sources); picks still offered.                                                                           |

### Responsive rhythm

- **wide (≥120):** Next-Up hero + poster rail of picks (poster-on-top tiles, row)
  - facts rail.
- **medium:** Next-Up hero + horizontal poster picks; facts fold into body.
- **narrow / ultraCompact:** compact Next-Up line (no card border) + named picks
  as text (`+3 picks · Frieren · Dandadan`); no posters. Never a punitive wall.
- Reserved poster heights everywhere so image load never shifts layout.

### Keyboard model

- `↑↓` / `j k` move focus across **actions and picks** (unified ring).
- `↵` runs the focused item.
- `1 / 2 / 3` jump-select picks (existing); `! @ #` open pick actions (existing).
- During countdown: `n` play now, `x` cancel, `a` pause autoplay.
- A legible live-keys footer line summarizing the active chords.
- No new global chords; reuse existing `resolvePostPlayUnhandledInput` routing,
  extended for focus-across-picks.

## Testing

- `post-play-view.test.ts`: `buildDiscovery` resolves `posterUrl` from
  `posterPath` (and leaves it undefined when absent); each of the 7 states
  produces its expected hero/celebration shape; watch-time stat present only on
  `series-complete` + flag on.
- Watch-time aggregator: pure unit test (sum, episode count, day count, empty).
- `post-play-shell.test.tsx`: frame snapshots via `captureFrame` at wide / medium
  / narrow — assert Next-Up hero presence, countdown line when seconds set,
  poster cells, graceful narrow degradation, no layout jump (reserved height).
- Countdown wiring: `runAutoNextCountdown` routes `remaining` to the shell channel
  (unit on the seam, not a live timer).
- Keybinding collision guard already covers the scope; extend if new chords added
  (none expected).

## Out of scope / follow-ups

- Surfacing `showWatchTimeStats` as a toggle in the settings panel (roadmap item 4).
- Total cross-app watch-time / streak stats (only per-title here).
- Any Kitty multi-image rendering.
