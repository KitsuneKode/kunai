# Post-Playback Surface

North star:

```text
Post-playback = episode page + remote
```

The screen should answer:

1. What did I just watch?
2. What happened?
3. What can I do next?
4. What metadata helps me decide?
5. What deeper controls are available if I need them?

## Primary Layout

- Header: `Kunai · Post-play · mode · provider · title · episode`.
- Main identity: show title strongly, episode/season/title metadata below.
- State line: complete, stopped early, caught up, season complete, series complete, or playback issue.
- Action list: selectable rows. Keymaps are accelerators, not the only path.
- Preview rail: episode thumbnail or season poster fallback when useful.
- Footer: primary post-play actions.

## Footer

Recommended PPS footer:

```text
[▶ n] next   [◀ p] previous   [↻ r] replay   [☰ e] episodes   [⌕ s] search   [/] commands
```

If too dense, keep:

```text
[▶ n] next   [↻ r] replay   [☰ e] episodes   [/] commands
```

`stop after current` is not a default footer action. It belongs in session commands.

## States

### Episode Complete

Primary action: next episode.

Show:

- watched duration
- next episode title/thumb if available
- recommendations as secondary loop
- replay, episodes, tracks, search

### Stopped Early

Primary action: resume from timestamp.

Show:

- saved position
- replay
- episode picker
- tracks/recover only if useful

### Caught Up

Do not mix with series complete.

Primary actions:

- calendar
- watchlist/tracked state
- recommendations
- replay
- search

Show expected next airing only if schedule data exists. If not, say it quietly.

### Season Complete

If next season exists:

- primary action: start next season
- secondary: season picker, recommendations, replay finale

If next season exists but is unavailable:

- show expected/unknown availability
- primary: calendar/watchlist

### Series Complete

Primary loop becomes recommendations.

Show:

- completion state
- recommended next titles
- more recommendations
- history/stats if useful

### Playback Did Not Start

This is not post-play completion.

Show:

- `Playback did not start`
- brief reason if known
- try again
- choose source/tracks
- diagnostics
- search

Never mark watched or offer next as primary if playback never started.

## Poster And Thumb Rules

- Current episode thumbnail first.
- Season poster fallback.
- Title poster for series/movie-level states.
- Hide images before hiding action rows or state.
