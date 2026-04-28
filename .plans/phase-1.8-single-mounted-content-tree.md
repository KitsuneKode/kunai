# Kunai — Phase 1.8 Single Mounted Content Tree

Status: Planned

Last updated: 2026-04-29

## Why This Phase Exists

Phase 1.5 finished the root-shell foundation:

- one fullscreen root frame
- one command router
- one root-owned overlay host
- root-owned provider, history, diagnostics, settings, season, episode, and subtitle pickers

The biggest remaining architectural seam is that browse and playback still transition through
phase/session loops instead of reading as one always-mounted content tree.

That seam now matters more than any remaining picker ownership issue because it keeps:

- content state split across orchestration loops and UI shells
- `apps/cli/src/app-shell/ink-shell.tsx` too large
- shell behavior harder to reason about during back/forward transitions
- future UX and mascot/image work coupled to shell remount behavior

This phase completes the main CLI migration checkpoint by collapsing that seam.

## Objective

Turn browse, loading, playback, and post-playback into one mounted root-owned content tree inside
`apps/cli`, while keeping provider resolution, playback policy, history, diagnostics, and config
behavior stable.

## Non-Goals

- do not extract shared packages yet
- do not rewrite providers
- do not redesign every component visually
- do not build web or desktop
- do not replace the command system again
- do not move orchestration outside `apps/cli`

## Exit Criteria

Phase 1.8 is complete when:

- browse, loading, playback, and post-playback render as content states inside one mounted shell
- helper-shell adapters are no longer the normal path for those flows
- `PlaybackPhase` and `SearchPhase` stop being UI launchers and become orchestration/controllers
- root overlays and root pickers continue working without shell remount assumptions
- `Esc`, back, and command routing remain deterministic across browse and playback
- `apps/cli/src/app-shell/ink-shell.tsx` is materially reduced and split by responsibility
- remaining legacy helper-shell fallbacks are explicitly documented if any remain

## Codebase Assessment Before Starting

The codebase is no longer messy at the repo-topology level, but it is still concentrated in a few
runtime UI files.

### What is clean now

- runtime ownership is clear: `apps/cli/src/main.ts` is canonical
- `apps/cli/index.ts` is only a compatibility wrapper
- provider registration is centralized
- session state and command registry exist as real seams
- overlay ownership is now meaningfully centralized
- tests are in `apps/cli/test/` instead of drifting through `src/`

### What is not clean enough yet

- `apps/cli/src/app-shell/ink-shell.tsx` is still too large at roughly 4.1k lines
- `apps/cli/src/app-shell/workflows.ts` is still too broad at roughly 1k lines
- `apps/cli/src/app/PlaybackPhase.ts` is doing a little too much orchestration plus shell coupling
- shell-specific picker logic and runtime-specific flow logic are still near each other more than
  they should be

### Conclusion

The codebase has good coarse separation, but not good enough fine-grained separation inside the CLI
shell layer.

This is no longer a “bad architecture” repo. It is a “good direction, still too much code in a few
files” repo.

Phase 1.8 should fix that before more product features pile on top.

## Primary Extraction Targets

### 1. Root content state mapping

Extract root content-state resolution out of `ink-shell.tsx`.

Create modules around:

- root content state mapping
- root shell surface selection
- state-to-view adapters for browse/loading/playback/post-playback

Likely files:

- `apps/cli/src/app-shell/root-content-state.ts`
- `apps/cli/src/app-shell/root-content-renderers.tsx`

### 2. Root overlay and picker rendering

The root overlay host now owns many flows. It should become its own unit instead of living inside
the main shell file.

Likely files:

- `apps/cli/src/app-shell/root-overlay-shell.tsx`
- `apps/cli/src/app-shell/root-picker-shell.tsx`
- `apps/cli/src/app-shell/settings-overlay.tsx`

### 3. Browse shell decomposition

Browse is currently visually better, but still mixes:

- query input behavior
- results windowing
- details companion behavior
- local overlay behavior
- command handling glue

Likely files:

- `apps/cli/src/app-shell/browse-shell.tsx`
- `apps/cli/src/app-shell/browse-results-pane.tsx`
- `apps/cli/src/app-shell/browse-companion-pane.tsx`

### 4. Playback shell decomposition

Playback and post-playback should stop being “special shell sessions” and become a root content
renderer plus a playback content controller.

Likely files:

- `apps/cli/src/app-shell/playback-shell.tsx`
- `apps/cli/src/app-shell/playback-companion-pane.tsx`
- `apps/cli/src/app-shell/post-playback-panel.tsx`

### 5. Workflow/controller slimming

`SearchPhase` and `PlaybackPhase` should keep orchestration, not mounted Ink ownership.

Likely work:

- replace shell-launch calls with state-driven root transitions where safe
- keep provider resolution and playback policy inside controller code
- move shell-only preparation glue into adapters

## Implementation Slices

### Slice A: Root Content Tree Contract

Goal:

- define one explicit root content union for the major surfaces

Tasks:

- add a root content type for:
  - home
  - browse
  - loading
  - playback
  - post-playback
  - idle/fallback
- build a root content adapter from session/runtime state
- keep this adapter pure and testable

Tests:

- root content selection tests
- loading vs playback vs overlay priority tests

### Slice B: Extract Root Overlay Host

Goal:

- move root overlay rendering out of `ink-shell.tsx`

Tasks:

- extract root overlay component
- extract root picker overlay behavior
- keep settings/provider/history/diagnostics/help/about behavior identical

Tests:

- overlay rendering path tests
- root picker cancel/confirm tests

### Slice C: Browse As Root Content

Goal:

- render browse directly as root content, not as a mounted helper session

Tasks:

- convert browse shell launch path into root content state updates
- preserve:
  - current query
  - current result list
  - selected index
  - details-first enter flow
  - command palette behavior
- remove any remaining assumptions that browse owns its own root lifecycle

Tests:

- browse state survives content swaps
- Esc clears/back behavior from browse remains stable

### Slice D: Playback And Post-Playback As Root Content

Goal:

- playback and post-playback become content states, not separate shell sessions

Tasks:

- map playback-loading to root loading content
- map active playback result state to root playback content
- map post-playback action state to root playback/post-playback content
- keep episode navigation, replay, search, and next/previous behavior unchanged

Tests:

- playback -> post-playback -> search path
- autoplay path still works
- back-to-results path still works

### Slice E: Retire Normal Helper-Shell Path

Goal:

- helper-shell launches stop being the default path for browse/playback lifecycle

Tasks:

- remove or quarantine redundant launch helpers
- keep only narrowly justified fallback helpers
- document any remaining non-root fallback path in `.plans/persistent-shell-implementation.md`

Tests:

- no command regressions in root runtime
- no shell blank-gap regressions

## Test Plan

Add or update:

- session-state tests for content state transitions
- command availability tests for root-owned browse/playback content
- one back-stack test across browse -> details -> playback/post-playback
- one autoplay chain test that verifies content remains root-owned
- one resize/collapse test covering content-state swap without remount assumptions

Run before checkpoint:

```sh
bun run typecheck
bun run lint
bun run test
```

## Risk List

### Highest risk

- accidentally mixing controller logic and shell rendering again while extracting
- subtle `Esc` or back behavior regressions between browse and playback
- stale content state after provider/mode switches
- autoplay or history persistence regressions during content-state swaps

### Mitigations

- keep the root content adapter pure and test it directly
- migrate one major surface at a time
- preserve old fallback helpers until the new path is fully verified
- keep commits small and phase-labeled

## Definition Of Done

This phase is done when the CLI no longer feels like multiple fullscreen shells sharing one frame,
but one mounted app whose content changes in place.

At that point, the next long-run improvements become safer:

- package extraction
- image-pane service extraction
- deeper metadata/store work
- mascot and richer motion
- future desktop/web reuse
