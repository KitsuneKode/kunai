# Release schedule

The schedule (calendar) lists anime and series episodes airing this week from
catalog metadata. It mounts its own surface, loads underneath, and offers a
retry when the catalog is unreachable.

## Sub-features

- `schedule-open` open from the palette (`/calendar`) or a filtered entry.
- `schedule-failure` an unreachable catalog shows `Schedule unavailable` with
  `Refresh schedule`.
- `schedule-leave` Esc returns to Browse with an honest header.

## How to get to it (user POV)

- Command palette (`/`) → `calendar` → Enter.

## Driving it with agent:drive

- **Offline failure and return.**
  `bun run agent:drive -- --show frame --keys "/" "<wait:command>" calendar "<enter>" "<wait:Schedule unavailable>" "<esc>" "<wait:Search title>"`.
  Frame shows `× Schedule unavailable` then Browse; the header must read
  `● ready`, never `● Searching…`. The run prints the refused hosts
  (`graphql.anilist.co`, `api.themoviedb.org`, …) under `== network refused ==`.
- **Online schedule.** Add `--network live`. That is a dated observation of
  today's catalog, not a regression proof.

## Gotchas

- The catalog is not a fixture. With the network guard on (the default) the
  schedule always takes the offline path.
- The header repaints late. To prove the header state, read
  `session.sessionState().searchState` in a wiring test (see
  `test/agent/wiring.test.ts`, "agent wiring · calendar") rather than trusting
  one frame.
