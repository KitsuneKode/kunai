# Kunai — Daily-Use UX, Discovery, And Runtime Hardening

Status: active

Last updated: 2026-05-14

This is the current active plan produced from the product grill session around daily-use experience,
release calendars, recommendations, language handling, offline visibility, fullscreen TUI behavior,
loading/playback polish, and long-session runtime reliability.

Use this as the coordinating plan before editing:

- `/discover`, recommendations, random picks, or calendar surfaces
- search/result enrichment
- details panels
- language, dub/sub, subtitle, source, or quality switching
- loading, active playback, or post-playback shell UI
- image/poster/episode-still rendering
- mpv IPC, persistent playback, downloads, or long-session cleanup
- docs drift related to the current beta UX

## Product Decision Summary

The agreed direction:

- prioritize daily-use discovery reliability first, runtime soak second
- make `/discover` the daily hub, `/calendar` the schedule lens, and `/random` the fun picker
- keep refresh lazy and relevance-based, not global daily sync
- separate catalog release state from provider-playable state
- enrich search rows lazily with progress, download, release, and language hints
- never block typing/search on network enrichment
- make random recommendations rerollable and explained, never instant-play
- keep global language defaults, with per-title/session overrides
- choose the preferred subtitle as active/default while attaching all available subtitle tracks
- make the TUI feel like one fullscreen app, not stacked cards or leaked image artifacts
- prune docs drift before broad implementation so agents work from one coherent spec

## Milestone 0: Docs Drift And Plan Hygiene

Goal: reduce planning noise before implementation expands.

Tasks:

- mark completed plans as completed instead of leaving them `planned` or `in progress`
- keep this file as the active cross-cutting UX hardening plan
- leave narrower plans as references:
  - `catalog-release-schedule-service.md`
  - `kitsune-design-system-and-recommendations.md`
  - `fullscreen-root-shell-redesign.md`
  - `download-offline-onboarding.md`
  - `phase-2-playback-media-runtime.md`
- shrink stale README roadmap language around download/offline now that queue/library entry routes exist
- update `.docs/recommendations-and-discover.md` once calendar/random/language work lands
- update `.docs/ux-architecture.md` when fullscreen shell rules change

Exit criteria:

- `roadmap.md` points here as the active coordinating track
- stale completed work is not presented as future work
- implementation docs describe current behavior, not aspirational behavior from old passes

## Milestone 1: Recommendation Reliability And Discover Baseline

Goal: `/discover` should be trustworthy and should not fail on first try because of stale empty cache.

Tasks:

- fix recommendation cache policy so failed network responses do not overwrite useful stale data
- avoid caching first-try empty results unless the upstream returned a real empty response
- show graceful empty states for no history, upstream failure, and no similar titles
- add diagnostics for recommendation cache hit, stale hit, refresh failure, and upstream empty
- keep `/discover` lazy: no recommendation calls on startup

Exit criteria:

- first recommendation open either shows stale/fresh data or an honest retryable empty state
- a transient TMDB failure does not poison the cache
- unit tests cover stale-on-error and do-not-cache-failed-empty behavior

## Milestone 2: Release Calendar And Schedule Cache

Goal: anime and TV release timing becomes a first-class catalog service, separate from provider
playability.

Tasks:

- persist schedule results in SQLite cache instead of only in-memory service caches
- cache by catalog source, title id, season, episode, mode, and local day window
- use release-time-aware TTLs:
  - releasing today: short TTL
  - future next-airing: expires around the known release time plus safety window
  - historical released dates: long TTL
- add `/calendar` as a schedule-first surface
- add `/discover` sections for airing today and caught-up/up-next titles
- make playback caught-up copy use schedule data when provider catalogs stop at the latest playable episode
- keep autoplay/download/prefetch blocked on provider-playable state, not catalog release state

Exit criteria:

- UI can say `airs today`, `next Fri`, `released`, `caught up`, or `release unknown`
- provider absence after release is shown as `aired, not playable yet`
- no global daily sync is required
- tests cover release status, TTL boundaries, and autoplay safety

## Milestone 3: Rich Search And Result Enrichment

Goal: search stays instant while rows become more informative after local and relevant lazy
enrichment.

Progress:

- 2026-05-14: local progress/offline enrichment now feeds normal browse/search/trending/recommendation
  option mapping. Partial history is shown as a continue badge with episode, timestamp, and percent;
  completed offline artifacts and broken local artifacts are surfaced as local/offline facts.

Tasks:

- local enrichment for all rows:
  - watched/completed state
  - progress percentage or next episode hint
  - downloaded/offline availability
  - queued/downloading state
- network enrichment only for selected, visible, or relevant rows:
  - schedule badge
  - provider availability hint
  - language inventory when already cached
- keep input non-blocking while enrichment updates arrive
- add filters for genre, type, release state, downloaded/offline, language, and watched state
- make filter UI progressive: direct typing/search remains primary

Exit criteria:

- search typing remains responsive
- rows can show useful progress/download/release/language hints without requiring provider resolve
- enrichment failures are quiet and diagnosable

## Milestone 4: Random Picker

Goal: “recommend me something” feels playful but still controlled.

Tasks:

- add `/random`
- show a rerollable tray with 3 to 5 explained picks
- support `r` to reroll
- `Enter` opens the normal title/details flow
- never auto-play from random selection
- source picks from weighted local history, trending, recommendations, release schedule, and optional filters

Exit criteria:

- random explains why each pick appeared
- reroll does not mutate playback state
- tests cover no-history, filtered, and reroll behavior

## Milestone 5: Details Panel Repair

Goal: the details panel should feel like a real title hub, not a broken shallow projection.

Progress:

- 2026-05-14: details panels now promote local progress and offline state near the top of the
  title overview instead of burying them among provider facts.

Tasks:

- refresh full details when a title is selected, with stale-while-revalidate behavior
- show overview, rating, year, type, genres, poster availability, release state, and provider facts
- show language inventory if cached:
  - audio modes
  - soft subtitles
  - hard-sub languages
  - unknown vs inferred states
- show offline/download status for the selected title
- make missing data honest and calm, not broken-looking

Exit criteria:

- details panel is useful before playback
- details panel does not force provider resolve
- failed detail refresh keeps stale/local data visible

## Milestone 6: Language, Dub/Sub, And Subtitle Switching

Goal: language preference becomes a coherent playback axis with minimal network calls.

Current invariant:

- preferred subtitle is selected as active/default
- all available subtitle tracks are attached to mpv when possible
- providers expose evidence; playback owns user preference policy

Tasks:

- introduce a `LanguageSelectionIntent` next to source/quality selection
- model global defaults and per-title/session overrides:
  - anime default audio mode
  - series default audio language
  - subtitle language
  - subtitle off
- add a language picker that distinguishes:
  - instant soft-sub switch
  - stream/source reload
  - provider lookup required
- switch soft subtitles through mpv when attached
- switch dub/hard-sub/source variants through cached stream candidates when available
- only resolve providers when cached inventory cannot satisfy the requested language
- expose diagnostics for language switch path and inventory misses
- update docs so “subtitles attached” means inventory-ready, not only one selected URL

Exit criteria:

- users can switch language without guessing whether it reloads
- per-title language choice survives resume/autoplay
- cached inventory avoids unnecessary provider calls
- tests cover soft-sub, hardsub, dub/source, provider-miss, and subtitle-off flows

## Milestone 7: True Fullscreen TUI And Responsive Shell

Goal: the terminal UI owns the viewport and does not leak nested frames, scrollback artifacts, or
image protocol leftovers.

Problems observed:

- post-playback can render as a narrow boxed region inside a much larger terminal
- footer actions can wrap into noisy horizontal fragments
- image/placeholder output can leave black bars and partial frame artifacts
- child shells still sometimes behave like separate cards instead of content surfaces

Tasks:

- make the root shell the only dominant outer frame
- ensure browse, loading, active playback, post-playback, pickers, and overlays render inside one
  viewport-contained content region
- remove redundant child full-frame borders where they create nested-card output
- enforce width/height budgets from a single viewport policy
- add resize blockers for too-small terminals instead of partial rendering
- make footer actions responsive:
  - primary 3 to 4 actions visible
  - overflow behind `/ commands`
  - no long wrapped command sentence
- contain image rendering:
  - clear old Kitty/Ghostty images on screen transition and resize
  - never let image placeholders become layout owners
  - text/details collapse after images, not before
- add visual smoke scripts or snapshots for narrow, medium, wide, and image-enabled terminals

Exit criteria:

- no normal workflow requires terminal scrollback
- post-playback fills/uses the available viewport intentionally
- image artifacts do not remain after transitions
- footer is readable at common widths

## Milestone 8: Loading And Active Playback Polish

Goal: loading and active playback feel consistent, rich, and useful without becoming noisy.

Tasks:

- replace inconsistent stage chips with a compact signal rail
- show title, episode, provider, current phase, cache/fallback facts, and subtitle inventory as
  separate evidence, not “issue” text
- treat `subtitle attached` / inventory ready as success/evidence, not a warning
- add optional media companion to loading/active playback:
  - prefer episode still/backdrop when available in future
  - fall back to poster
  - never block playback or input
- make active playback show poster/still in an integrated companion, not an orphaned bottom-left image
- keep diagnostics available but not centered in normal playback

Exit criteria:

- resolving, buffering, playing, and post-playback feel visually connected
- loading screen has strong hierarchy and no duplicated “provider/status/issue” copy
- playback looks alive even when mpv owns the video window

## Milestone 9: Offline And Home Surface Visibility

Goal: downloaded/offline media is visible from home/search/discover without confusing queue and
library concepts.

Tasks:

- home/root should show completed offline availability separately from download queue
- search rows should lazily show downloaded/offline state
- details panel should show local file state and subtitle sidecar state
- `/downloads` remains queue/status
- `/library` and `/offline` remain completed playable media
- broken local artifacts should offer re-download/revalidate, not crash

Exit criteria:

- users can find downloaded media without guessing which command to run
- offline status is visible where title decisions happen
- queue and library copy remain distinct

## Milestone 10: Runtime Soak, IPC, Downloads, And Memory Safety

Goal: long sessions should not leak timers, images, mpv state, download processes, or stale IPC
commands.

Tasks:

- add mpv IPC soak checks:
  - repeated next/previous
  - recover/reload
  - subtitle replacement
  - stream/source/quality switch
  - stalled stream reconnect
- audit timers and cleanup:
  - mpv IPC close timers
  - ready fallback timers
  - poster/image cleanup
  - download polling intervals
  - queue worker heartbeats
- add download queue soak tests for long queues, cancellation, abort, retry, and shutdown
- add memory telemetry snapshots to manual smoke guidance
- keep diagnostics bounded and redacted

Exit criteria:

- repeated playback sessions do not accumulate active timers or orphan mpv/socket state
- download queue can run/cancel/retry without stuck jobs
- memory usage remains explainable during long sessions

## Manual Smoke Matrix

Baseline commands:

```sh
bun run dev
bun run dev -- -S "Dune"
bun run dev -- -S "Attack on Titan" -a
bun run dev -- -S "Dune" --debug
bun run dev -- --continue
bun run dev -- --offline
```

Additional smoke after this plan lands:

```sh
bun run dev -- --calendar
bun run dev -- --random
bun run dev -- -S "Attack on Titan" --debug
KUNAI_POSTER=0 bun run dev
KUNAI_IMAGE_DEBUG=1 bun run dev -- -S "Dune"
```

Check each at narrow, medium, and wide terminal sizes.

## Verification Strategy

- unit tests for cache policy, schedule TTL, recommendation stale-on-error, language switching, and
  subtitle inventory
- integration tests for autoplay release/playable separation
- fixture tests for provider language/source inventory
- visual smoke captures for browse, details, loading, active playback, post-playback, random, and
  calendar
- manual provider smoke only after deterministic seams pass

## Open Implementation Notes

- Do not put release-calendar fetches in providers.
- Do not make search wait on provider or schedule enrichment.
- Do not auto-play random picks.
- Do not treat an aired episode as playable until a provider confirms it.
- Do not add more helper shells when a root overlay can own the flow.
- Do not let image support become required for a good shell.
