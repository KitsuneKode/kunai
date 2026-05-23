# Binge Playback Handoff And Provider Health Plan

Status: implemented core contract 2026-05-24

## Goal

Make next/previous, auto-next, provider fallback, timing metadata, and source selection feel native and fast without taking control away from the user or wasting provider/catalog/API work.

## Non-Goals

- Do not prefetch many future playable streams.
- Do not let auto-next change what manual `N` means.
- Do not globally change the user's provider because one fallback worked.
- Do not call providers from render paths, typing paths, or picker movement.
- Do not show `degraded` for slow-but-successful work.
- Do not mix ephemeral prefetch with durable download/offline jobs.
- Do not add telemetry-server dependency for local provider health.

## Current State To Build On

- `BackgroundWorkScheduler` already has playback-critical, next-episode-prefetch, recommendation-warm, attention-refresh, and cleanup lanes.
- `EpisodePrefetchHandle` and `adoptEpisodePrefetchBundle` already support near-EOF next-episode prefetch.
- `PlaybackResolveCoordinator` and `PlaybackResolveService` already centralize provider resolve, cache, fallback, and global provider health deltas.
- `SourceInventoryService` and `PlaybackSourceInventoryProjection` already model cached source/quality/subtitle facts, but the hot path should use them more deliberately.
- `PersistentMpvSession` already has near-EOF callbacks and reconnect paths.
- IntroDB/AniSkip timing aggregation exists and can attach or update playback timing metadata.

## Recommended Architecture

Use a cache-first playback readiness pipeline:

```text
next episode intent
  -> intent hash
  -> readiness classifier
  -> memory / stream cache / source inventory
  -> provider resolve only if needed
  -> timing and subtitle prep in parallel
  -> exact-match handoff for manual next or auto-next
```

Provider health should be scoped before it is global:

```text
resolve/playback evidence
  -> title/provider health event
  -> session-soft fallback preference
  -> optional title-scoped user preference after prompt
  -> global health only for repeated broad failures
```

## Locked Behavior Decisions

### Prefetch Scope

- Prefetch only the immediate next playable stream.
- It is okay to warm next+1 catalog or inventory metadata only when that is cheap and cache-safe.
- Do not prefetch multiple future playable streams.

### Prefetch Timing

- Credits-aware timing wins when IntroDB/AniSkip gives credible credits data: start around `creditsStart - 60s`.
- Without credible credits timing, use an adaptive freshness window:
  - normal episodes: start around 90% watched
  - never earlier than about 3 minutes before the end
  - never later than about 60 seconds before the end
  - long episodes/movies: cap at the final 3 minutes
  - very short episodes: skip or use final 45-60 seconds
- The point is to be early enough for fallback but late enough to avoid stale URLs.

### Cache-Aware Readiness

Before provider network work, classify readiness in this order:

1. in-memory recent episode stream
2. fresh exact stream cache
3. source inventory cache
4. provider resolve

Do not validate too early just because prefetch exists. Validate or refresh closer to handoff when freshness matters.

### Handoff Wait

- Default next-episode handoff wait: `3s`.
- Extend toward `8s` only when there is real progress evidence.
- Real progress means:
  - exact stream cache hit found
  - source inventory hit found
  - provider returned candidate streams
  - fallback provider attempt started after primary failed
  - stream validation is actively running or just succeeded
  - subtitle/timing preparation completed after the video stream is already ready
- Do not extend for:
  - scheduled job exists but has not started
  - provider request merely pending with no response
  - retry sleep or backoff
  - timing/subtitle work alone while no video stream exists
  - generic loading state

### Manual `N` Exact-Match Rule

Manual next uses a prefetch bundle only when the intent hash still matches:

- same title
- same episode
- same provider
- same source/server or stream identity when known
- same audio mode
- same quality or selection policy when the user explicitly changed quality
- same subtitle mode/language when subtitles were preselected non-interactively

If a strong preference changed, resolve fresh. Safe lower-level cache data can still be reused, but the old prefetch bundle must not be blindly adopted.

Soft subtitle changes should keep the video stream when valid and mark subtitle prep stale.

### Auto-Next Versus Manual Next

- Auto-next may use a ready exact-match prefetch when the user has not changed intent.
- Manual `N` means next episode, not autoplay taking control.
- Recover/refresh means fresh resolve and should bypass stale prefetch.
- Previous/backward navigation can use recent in-memory streams when exact and fresh.

### IntroDB And AniSkip Timing

- Timing readiness is part of "prepared", but it never blocks video playback.
- Start timing fetch in parallel when safe.
- If timing is ready at handoff, attach it.
- If timing arrives late, inject/update it after playback starts.
- If timing fails, surface only in diagnostics/details; do not degrade playback copy.

### Fallback Policy

- Fallback is allowed during prefetch under normal recovery policy.
- Fallback success can be used for the active playback cycle.
- Fallback success must not mutate global provider preference.
- During the current binge session, Kunai may use a session-soft preference for the fallback that just worked for this title.
- Persistent title-scoped provider preference happens only after the user accepts a boundary prompt.

### Provider Switch Prompt

Prompt only after sustained local evidence:

- `2` consecutive title/provider failures in a binge when another provider succeeds, or
- `3` failures for the same title/provider within `24h` with at least one successful fallback.

Show the suggestion only at an episode boundary, post-playback, or inside provider/source picker.

Suggested copy:

```text
VidKing struggled with this show. RiveStream worked last time. Use RiveStream for this show?
```

Never show this mid-episode.

### Provider Health Evidence

Count as title/provider health failures:

- provider resolve timeout
- no stream candidates
- selected stream definitively dead before playback
- repeated premature EOF or dead network read
- fallback provider succeeds for the same title/episode after the primary failed
- provider parse/schema failure

Do not count:

- user cancel
- local offline/network-down state
- title not released yet
- user manually changed source/quality/provider
- subtitle missing while video works
- one slow-but-successful resolve
- cache hit skipped provider

Weighting:

- parse/schema failure: high
- no candidates or dead stream: medium
- timeout: medium/lower when local network uncertainty exists
- slow success: latency signal only

### Health Retention And Healing

- Store title/provider health in cache DB, not history.
- Remember normal failures for about `24h`.
- Remember severe parse/schema failures for about `7d`.
- One clean success reduces severity.
- Two clean successes clear the title/provider warning.
- Health never hard-blocks a provider forever; the user can still choose it.

### Failure Copy

Use calm status text:

- `Preparing next episode`
- `Still preparing`
- `Trying fallback`
- `Using cached source`
- `Could not prepare next episode`

Reserve `degraded` for repeated evidence-backed provider/cache/player health issues.

### Diagnostics

Every prefetch and fallback pass should record:

- trigger
- intent hash
- cache hit/miss stage
- source inventory hit/miss
- provider attempts
- fallback attempts
- wait extension reason
- validation result
- subtitle/timing readiness
- provider health event, if any
- next recommended action

Diagnostics should explain why Kunai fetched, skipped, reused cache, waited, or gave up.

### Download And Offline Boundary

- Prefetch is ephemeral playback acceleration.
- Downloads are durable user intent.
- Future `download next N` and auto-download are separate explicit jobs that start from current watch state.
- Release badges must not auto-resolve provider streams for download.
- Offline UI should show queue/progress/non-blocking state when that future work lands.

## Implementation Slices After Approval

1. Add an intent-hash type and tests for exact-match/bypass behavior.
2. Expand the prefetch target identity to include provider, source/stream, audio, quality policy, and subtitle mode.
3. Add readiness classification that checks memory, stream cache, and source inventory before provider resolve.
4. Replace fixed wait behavior with progress-evidence adaptive wait.
5. Adjust near-EOF prefetch timing to the credits-aware/adaptive freshness policy.
6. Add timing/subtitle readiness metadata to prefetch diagnostics without blocking playback.
7. Add title/provider health cache and event classifier.
8. Add fallback session-soft preference and boundary-only switch prompt.
9. Wire diagnostics and calm status copy into playback and provider/source picker surfaces.
10. Add deterministic tests for no provider calls on cache hits, no stale prefetch adoption after intent change, and no global provider mutation after fallback.

## Verification

Run deterministic gates after implementation:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `bun run test`

Targeted scenarios:

- Manual `N` adopts ready prefetch only when intent hash matches.
- Manual `N` resolves fresh after provider/source/audio/quality changes.
- Subtitle-only change keeps valid video but refreshes subtitle prep.
- Slow prefetch shows preparing copy, not degraded copy.
- Fallback during prefetch does not change global provider.
- Repeated title/provider failures create a boundary-only suggestion.
- Clean successes heal title/provider health.
- Cache/source inventory hits avoid provider resolve calls.
- Timing metadata can attach late without blocking playback.

## Things Not To Do

- Do not turn fallback into a global preference mutation.
- Do not hide provider/source controls because Kunai made a smart guess.
- Do not show switch prompts after one isolated failure.
- Do not run provider probes for a whole watchlist.
- Do not wait the full `8s` without progress evidence.
- Do not let timing or subtitle preparation block video handoff.
- Do not use scary copy for ordinary slow network/provider latency.

## Implemented 2026-05-24

- Prefetch identity now includes provider, source/stream selection, audio, quality, and subtitle policy; manual next only consumes a compatible bundle.
- Subtitle-only intent changes retain a valid video stream while invalidating prepared subtitle state.
- Handoff budget policy is `3s` by default and permits `8s` only for concrete video-readiness progress.
- MPV near-EOF work uses credits timing where available and an adaptive 90 percent/final-three-minute window otherwise.
- Playback resolve now checks source inventory before provider work and stores fresh provider inventories for reuse.
- Source inventory reuse must satisfy an explicit source/stream selection and pass one health validation before promotion into the exact stream cache; invalid inventory resolves fresh.
- Title/provider health is persisted in cache storage with bounded retention, repeated-failure suggestions, and two-success healing.
- Title/provider health records classified timeout, no-stream, parse, and dead-stream evidence rather than flattening fallback failures into one reason.
- Fallback suggestions are surfaced only after playback at an episode boundary; they do not mutate a global provider preference.
- Status copy uses calm preparation language, and diagnostics identify title-health suggestions.
