# Codebase Architecture Sweep

Status: Planning
Created: 2026-06-12

This is the current coordination plan for the next Kunai CLI architecture pass.
It supersedes ad hoc cleanup notes for this pass, but does not delete historical
research. Older plans remain evidence unless this file or
`plan-implementation-truth.md` marks them current.

## Goal

Improve reliability, performance, and debugging by reducing duplicated policy,
clarifying app/shell/service/package boundaries, and splitting the largest
runtime files into reviewable ownership slices.

This is one coordinated sweep with scoped commits, not one giant rewrite.

## Current Provisional WIP

There is no active provisional WIP for this sweep.

The earlier candidate extraction in `apps/cli/src/app/PlaybackPhase.ts` and
`apps/cli/src/app/playback-control-track-action.ts` was intentionally discarded
after explorer review. Do not recreate that helper shape unchanged. Slice 3
should start from the policy/effects boundary described below.

## Primary Findings So Far

### App/Shell Boundary Blur

App phases and helpers still import shell/UI modules directly:

- `apps/cli/src/app/PlaybackPhase.ts`
- `apps/cli/src/app/SearchPhase.ts`
- `apps/cli/src/app/DownloadOnlyPhase.ts`
- `apps/cli/src/app/OfflineLibraryPhase.ts`
- `apps/cli/src/app/playback-recommendation-actions.ts`
- `apps/cli/src/app/download-episode-checklist.ts`

Target: app phases own orchestration and call shell through small adapter
interfaces. Shell modules render, collect intent, and return typed actions.

### Largest Runtime Hotspots

- `apps/cli/src/app/PlaybackPhase.ts` mixes playback orchestration, provider
  resolve, source switching, mpv lifecycle, prefetch, navigation, autoplay,
  post-play, recommendations, recovery, late subtitles, and diagnostics.
- `apps/cli/src/app-shell/workflows.ts` mixes setup, history, offline library,
  downloads, provider/track pickers, settings, diagnostics, and shell actions.
- `apps/cli/src/app-shell/ink-shell.tsx` mixes app lifecycle, render surfaces,
  shell hooks, loading shell, playback shell, list shell, and stats shell.

### Duplicate Or Overlapping Logic Clusters

- Provider/source/stream selection:
  `PlaybackPhase`, `source-quality`, `tracks-panel-pick`,
  `playback-selection-coordinator`, `PlaybackResolveService`,
  `DownloadService`, provider startup selection, and Videasy resolver logic.
- Provider ordering and priority:
  core priority helper, container startup ordering, settings UI provider order,
  runtime settings application, per-title provider preference.
- Episode navigation:
  next, previous, manual picker, post-play next, and autoplay all repeat pieces
  of selected-episode dispatch, prefetch handling, mpv transition overlays, and
  autoplay pause reset.
- History and continuation:
  CLI `--continue`, root history selection, search continue rows,
  `session-flow`, continuation services, release reconciliation, and episode
  picker progress.
- Queue and media actions:
  `QueueService`, `MediaActionRouter`, notification actions, post-play
  recommendation actions, playlist auto-advance, and root overlays.
- Offline/download playback:
  offline playback, offline runway, download enqueue/re-resolve, cleanup, and
  offline library workflow still need one intent model.
- UI/picker behavior:
  picker action context, tracks panel selection, root overlays, loading shell,
  post-play shell, and playback UI state all need clearer presentation models.

### Test Reliability

Remaining real-time waits exist in tests around provider cycle, provider retry,
download service, background scheduler, persistent mpv IPC, player control, and
AllManga. Classify each as:

- replace with deferred promise/fake scheduler,
- legitimate process or IPC settling wait,
- needs a harness seam before cleanup.

## Explorer Assignments

Explorer A: Playback/provider/source selection duplication and provider priority.

Explorer B: History, continuation, release reconciliation, queue, playlists,
notification/media actions, and post-play recommendation actions.

Explorer C: Shell/UI boundaries, `workflows.ts`, `ink-shell.tsx`,
`root-overlay-shell.tsx`, loading/playback/picker ownership.

Explorer D: Test reliability, architecture tests, package/type duplication, and
docs/plan drift.

Explorer results have been merged below. Implementation workers should use the
merged lanes, not the raw explorer notes alone.

## Merged Explorer Findings

### Playback, Provider, Source Selection

Current selection flow:

- `PlaybackPhase` gathers effective per-title/per-episode source selection and
  passes source, stream, quality, startup priority, and favorite source names to
  the resolve path.
- `PlaybackSelectionCoordinator` merges episode selection over title-level
  source preference, backed by JSON selection stores.
- `PlaybackResolveService` checks stream cache and source-inventory cache
  against requested selection, then passes selection to providers.
- Providers select actual streams. Videasy, AllManga, and Miruro call
  `selectReadyStream`.

Risks:

- Selection policy is duplicated across `source-quality.ts`,
  `PlaybackSourceInventoryProjection`, `PlaybackResolveService`, provider
  startup selection, and playback control handling.
- `selectReadyStream` lives under `packages/providers`, but its precedence
  order is product policy: explicit stream, explicit source, favorite source,
  quality, startup priority.
- Source-name normalization exists in both provider shared code and CLI domain
  code.
- Direct stream providers using `resolveDirectStreamSource` can select the first
  stream instead of honoring explicit source/stream/quality preferences.
- Stream/cache identity can over-separate inventory from selected stream. Source
  inventory should usually be reusable across source/quality changes when a
  provider returns full inventory.
- Download re-resolve persists source/stream/quality intent but only logs drift
  when selection changes.

Decisions:

- Replace the provisional `playback-control-track-action.ts` shape with a
  narrower `PlaybackTrackSelectionPolicy` / `PlaybackSelectionPolicy` that
  returns explicit effects:
  - selection persistence intent,
  - restart intent,
  - cache invalidation intent,
  - diagnostic payload.
- Move cross-provider stream selection precedence to `packages/core` or another
  shared policy module once tests cover provider behavior.
- Keep provider-local source cycling and provider-specific flavor discovery in
  providers.

### History, Continuation, Release, Queue

Current continuation has overlapping authorities:

- newer pure continuation engine,
- older continuation projection policy,
- history reconciliation helper used by history UI/enrichment.

Risks:

- Startup `--continue` bypasses `ContinueWatchingService`, then uses projection
  mainly for diagnostics. It cannot first-class surface offline-ready,
  new-season, or new-episode states.
- History tab classification and row action selection are split, so a row badge
  and Enter target can drift.
- Notification media actions advertise more than the root overlay wires. Missing
  optional deps can silently no-op after showing success copy.
- Post-play recommendation actions hand-code queue/download/details instead of
  using the generic media action router.
- Queue and playlist language is muddy: runtime up-next queue and durable saved
  playlists use overlapping copy and commands.
- Queue recovery is startup/crash-biased, but clean shutdown does not clearly
  close the current queue session.
- Playback "what plays next" policy is spread across catalog next episode,
  runtime queue advance, and recommendation auto-advance.

Decisions:

- `ContinueWatchingService` should own continuation decisions and expose adapters
  for history rows, startup continue, result badges, root history selection, and
  offline-ready actions.
- Release reconciliation refreshes/cache facts only. Convert release progress
  into continuation signals at one boundary.
- `QueueService` owns runtime up-next and recovery only.
- `DurablePlaylistService` owns saved/shareable playlists only.
- `MediaActionRouter` should be the executor for cross-surface media actions. If
  a displayed action lacks an executor, it should return an explicit unsupported
  result instead of silently succeeding.
- Add an `UpNextDecision` planner: catalog next episode, then runtime queue,
  then recommendation.

### Shell And UI Architecture

`workflows.ts` exported families:

- setup/handoff,
- offline/library/downloads,
- global command handling,
- provider/subtitle/tracks/season/episode pickers,
- settings,
- playlist/sync/import-export.

`ink-shell.tsx` mixed responsibilities:

- global stdin/root host lifecycle,
- `AppRoot` render and polling,
- service polling/mutation,
- playback command policy,
- loading shell prop assembly,
- playback shell/list shell/stats shell exports.

`root-overlay-shell.tsx` mixed responsibilities:

- React component,
- service coordinator,
- settings persistence,
- notification router,
- history projector,
- picker reducer.

Risks:

- Two settings implementations are live: list-shell settings and root-overlay
  settings. They differ in save model, copy, option coverage, and validation.
- Playback command availability is assembled in command registry, loading shell
  fallback hints, `AppRoot` callbacks, and playback shell footer actions.
- Root overlays sometimes close/cancel before calling async global workflows,
  which can break picker preservation and return-flow expectations.
- `workflows.ts` has a huge blast radius: offline, diagnostics, settings,
  playlist, sync, cache, history, and picker behavior can be changed in one
  edit.

Decisions:

- Split workflows by family before adding a general `ShellPort`.
- Move settings option/provider-priority model out of render files and reconcile
  list-shell vs root-overlay settings copy.
- Loading/playback UI should read command hints from command availability models,
  not from fallback strings.

### Tests, Packages, Docs

Quick test wins:

- Replace simple settle sleeps in player control, background scheduler, and
  download service tests with deferred/state hooks.
- Keep timeout/process waits where they intentionally test timeouts, Ak delay, or
  render flicker. Document why.
- mpv harness waits need explicit harness events before cleanup.

Boundary and package findings:

- Existing architecture test only blocks legacy/experiments imports and
  app-shell direct provider/player imports.
- Package manifests mostly follow intended direction.
- Semantic type duplication remains between CLI domain types and
  `packages/types`. Adapter seams are manual and need contract tests before
  movement.
- Some CLI `domain` services import storage repositories; this is a boundary
  cleanup, not an urgent correctness break.

Docs findings:

- Public docs scope is correctly limited.
- Docs metadata generation still hard-codes provider manifest paths and regex
  parses command/options metadata.
- `roadmap.md` contains stale Playwright/browser scraping language compared with
  the current direct-provider architecture.

Decisions:

- Add package/layer architecture guardrails before broad movement.
- Add generated metadata tests against the container provider registry.
- Add adapter contract tests before moving shared types.
- Reconcile stale roadmap claims during the docs cleanup slice.

## Target Architecture

```text
app-shell
  Ink render surfaces, picker shells, local interaction state
  returns typed user intents

app
  phase orchestration, playback/session policy, shell adapter calls
  no provider implementation details, no persistent storage SQL

domain
  pure rules and projections
  no Ink, mpv, SQLite, network, or file system

services
  IO orchestration, persistence adapters, diagnostics, catalog/download/playback
  no Ink rendering

infra
  mpv, process, IPC, filesystem, clipboard, terminal mechanics

packages/core
  cross-surface provider orchestration and shared policy primitives

packages/providers
  provider facts, request flows, stream/source inventory

packages/storage
  SQLite schema and repositories only
```

## Implementation Commit Order

1. `docs: add architecture sweep plan`
   - Status: Done (`476266e4`, `0f4888d7`)
   - This file.
   - Merge explorer findings.

2. `test(architecture): add boundary guardrails`
   - Status: Done (`cf038899`)
   - Start allowlisted.
   - Prevent new app-shell imports from app/service code unless routed through
     approved adapters.
   - Keep existing runtime legacy/experiments guard.

3. `refactor(playback): extract track action handling`
   - Status: Done
   - Added `playback-track-selection-policy.ts` as the policy/effects boundary.
   - Return explicit persistence, restart, invalidation, and diagnostic effects.
   - Cover confirmed source, stream, quality selections, and tracks panel picks.
   - Verification:
     `bun run --cwd apps/cli test:file test/unit/app/playback-track-selection-policy.test.ts test/unit/app/playback-control-source-selection.test.ts test/unit/app/track-pick-restart.test.ts`,
     `bun run typecheck`, `bun run lint`.

4. `refactor(playback): extract episode navigation actions`
   - Status: Done
   - Added `playback-episode-navigation.ts` for next, previous, manual picker,
     autoplay, and post-play restart preparation.
   - Preserve prefetch cancellation/handoff semantics.
   - Verification:
     `bun run --cwd apps/cli test:file test/unit/app/playback-episode-navigation.test.ts`,
     `bun run typecheck`, `bun run lint`, `bun run --cwd apps/cli fmt:check`.

5. `refactor(playback): extract post-play routing`
   - Status: Done
   - Kept `PlaybackPhase` as orchestration.
   - Added `post-playback-routing.ts` for exit outcomes, episode-navigation
     route resolution, and track-panel section routing.
   - Verification:
     `bun run --cwd apps/cli test:file test/unit/app/post-playback-routing.test.ts`,
     `bun run typecheck`, `bun run lint`, `bun run --cwd apps/cli fmt:check`.

6. `refactor(shell): split workflow families`
   - Status: In progress
   - Done: setup/handoff workflows extracted to `app-shell/setup-workflows.ts`
     with compatibility re-exports from `workflows.ts`.
   - Done: provider/subtitle/tracks/season/episode picker workflows extracted
     to `app-shell/picker-workflows.ts` with compatibility re-exports.
   - Verification: `bun run typecheck`, `bun run lint`,
     `bun run --cwd apps/cli fmt:check`.
   - Settings/setup workflows.
   - History workflows.
   - Offline library workflows.
   - Download workflows.
   - Provider/track picker workflows.
   - Generic shell action routing.

7. `refactor(shell): split ink shell surfaces`
   - Status: Not started
   - Lifecycle host.
   - Loading shell.
   - Playback shell.
   - List shell.
   - Stats shell.
   - Shared hooks.

8. `refactor(app): unify history and continuation entrypoints`
   - Status: Not started
   - One continuation read model for `--continue`, history picker, search
     continue rows, result enrichment, and post-play.
   - Keep release reconciliation as the freshness source, not a UI concern.

9. `refactor(app): unify queue and media actions`
   - Status: Not started
   - Route queue/download/follow/list actions through a single media action
     boundary where possible.
   - Add explicit unsupported-action results when displayed actions lack an
     executor.

10. `refactor(playback): extract up-next planner`
    - Status: Done
    - Existing canonical planner is `domain/playback/resolve-next-up.ts`.
    - Removed the unused older `domain/playback/up-next.ts` planner and its
      self-only test so there is one policy name for catalog next episode,
      runtime queue, and recommendation order.
    - Catalog next episode wins.
    - Runtime queue is second.
    - Recommendation auto-advance is third.
    - Countdown/cancel policy stays in playback app orchestration.

11. `test: remove replaceable timing sleeps`
    - Status: In progress
    - Done: replaced simple settle waits in `PlayerControlServiceImpl`,
      `BackgroundWorkScheduler`, and `DownloadService` tests with explicit
      gates or state polling.
    - Remaining: provider retry delay, persistent mpv IPC harness waits, and
      the bounded `waitUntil` polling helper still need case-by-case harness
      seams or documentation.
    - Verification:
      `bun run --cwd apps/cli test:file test/unit/infra/player/PlayerControlServiceImpl.test.ts`,
      `bun run --cwd apps/cli test:file test/unit/services/background/BackgroundWorkScheduler.test.ts`,
      `bun run --cwd apps/cli test:file test/unit/services/download/download-service.test.ts`.

12. `docs: mark historical plans and update routing`
    - Status: In progress
    - Done: updated current roadmap and architecture docs to distinguish active
      direct-provider runtime from archived/future Playwright/runtime-browser
      work.
    - Remaining: broader historical-plan classification pass.
    - Keep research.
    - Mark current vs historical plan surfaces.
    - Update `plan-implementation-truth.md` if statuses change.

## Worker Ownership Model

Only start workers after explorer findings are merged.

- Playback worker owns `apps/cli/src/app/PlaybackPhase.ts` and new
  `apps/cli/src/app/playback-*` helpers for playback action/navigation/post-play.
- Shell workflow worker owns `apps/cli/src/app-shell/workflows.ts` and new
  workflow-family files.
- Shell render worker owns `apps/cli/src/app-shell/ink-shell.tsx` splits and
  render-only files.
- History/queue worker owns continuation, queue, notification/media-action
  services and related tests.
- Test reliability worker owns test harness changes and deterministic sleep
  removal only.

Workers must not revert each other's changes. Each worker gets a disjoint write
scope and reports changed files.

## Do Not Do

- Do not run a broad rewrite or split multiple god files in one commit.
- Do not do broad file renames or naming normalization as part of behavior
  refactors.
- Do not split `PlaybackPhase.ts` and `app-shell/workflows.ts` in the same
  worker lane.
- Do not introduce a general `ShellPort` before workflow-family and shell-host
  seams are stable enough to wrap.
- Do not move CLI domain types into packages until adapter contract tests cover
  provider request/result mapping.
- Do not move provider-local source discovery, flavor probing, or retry/cycling
  into app code.
- Do not change provider behavior without provider tests.
- Do not land the provisional playback-control extraction unchanged; reshape it
  into an explicit policy/effects boundary first.
- Do not delete historical plans, provider dossiers, brainstorms, or research
  artifacts during implementation. Classify current vs historical first.
- Do not add `ink-testing-library` as a default test dependency. Prefer model,
  router, presenter, fake scheduler, and deferred-promise tests unless a real Ink
  render/input lifecycle regression requires it.
- Do not replace legitimate process, timeout, or IPC waits with fake hooks unless
  the harness exposes an equivalent observable event.
- Do not treat queue and durable playlists as the same product surface. Runtime
  up-next belongs to queue; saved/shareable collections belong to playlists.
- Do not add new packages for one-off helpers. Default to `apps/cli` unless
  there are multiple consumers and a stable cross-surface contract.

## Subagent Worker Prompt Seeds

Use these only after this plan is committed and the provisional WIP is either
reshaped or reverted.

### Playback Worker

Owned files:

- `apps/cli/src/app/PlaybackPhase.ts`
- new `apps/cli/src/app/playback-*` policy/helper files
- focused playback tests

Task:

- Replace the provisional playback-control helper with a policy-shaped
  extraction.
- Extract episode navigation actions.
- Extract post-play routing only if the first two slices are stable.

Do not edit shell workflow files except import rewires.

### Selection/Core Worker

Owned files:

- `packages/core/src/*selection*`
- provider shared startup-selection tests
- provider selection tests
- selected app adapter imports

Task:

- Move cross-provider selection precedence and source-name normalization out of
  provider-local shared code.
- Add precedence tests and direct-stream selection tests.

Do not touch provider-local source discovery/cycling.

### Shell Workflow Worker

Owned files:

- `apps/cli/src/app-shell/workflows.ts`
- new workflow-family files
- focused app-shell workflow tests

Task:

- Split settings/setup, history, offline/download, picker, diagnostics/cache,
  playlist/sync workflow families.
- Keep shell files as presentation/intent adapters.

### Shell Host/UI Worker

Owned files:

- `apps/cli/src/app-shell/ink-shell.tsx`
- new shell host/surface/presenter files
- loading/playback shell model tests

Task:

- Split host lifecycle from render surfaces.
- Move loading shell prop assembly to a presenter/model.
- Align command hints with command availability.

### History/Queue Worker

Owned files:

- continuation services/domain files
- queue/media-action services
- root history/action model tests

Task:

- Migrate startup continue, history rows, result badges, and root history
  selection to one continuation decision boundary.
- Route post-play/search/notification media actions through `MediaActionRouter`.
- Add `UpNextDecision` planner if not handled by Playback Worker.

### Test/Docs Worker

Owned files:

- architecture tests
- deterministic test harness files
- docs metadata tests
- roadmap/plan routing docs

Task:

- Add architecture guardrails.
- Remove replaceable sleeps.
- Add docs metadata/provider registry test.
- Reconcile stale roadmap Playwright/browser scraping language.

## Verification Gate

Run before final integration:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Use focused tests for each slice before the full gate.

## Open Decisions

- Whether the provisional playback-control extraction is the right final shape.
- Whether phase-to-shell adapters live under `app/shell-adapters` or
  `app-shell/adapters`.
- Whether any shared policy is mature enough for `packages/core`; default is to
  keep CLI-specific behavior in `apps/cli`.
- Which historical plans should be indexed as current, historical, or research.
- Whether to add `ShellPort` before or after `workflows.ts`/`ink-shell.tsx`
  family splits. Current recommendation: after.
