# Codebase Coherence And Redundancy Report

Status: Implemented 2026-05-17

This report records the docs, plan, and verification coherence pass that followed
the reliability core sweep. It intentionally avoided risky runtime refactors.

## Audited Surfaces

- `README.md`
- `AGENTS.md`
- `.github/pull_request_template.md`
- `.docs/testing-strategy.md`
- `.docs/release-reliability-gate.md`
- `.docs/diagnostics-guide.md`
- `.docs/presence-integrations.md`
- `.docs/playback-source-inventory-contract.md`
- `.docs/provider-dossiers/*`
- `.plans/roadmap.md`
- `.plans/plan-implementation-truth.md`
- `.plans/reliability-core-autonomous-sweep.md`
- `.plans/codebase-coherence-and-redundancy-sweep.md`
- `.plans/autonomous-reliability-and-coherence-path.md`
- root and CLI package scripts
- GitHub workflows and Husky pre-commit hook

## Changes Made

- Updated `README.md` so local verification lists the current deterministic
  order: `fmt`, `lint`, `test`, `typecheck`, then `build` and `pkg:check` for
  build/release confidence.
- Updated `.github/pull_request_template.md` so PRs ask for the same
  deterministic gate and explicitly distinguish manual live provider or Discord
  smokes.
- Added [.docs/debugging-map.md](../.docs/debugging-map.md) as the first-stop
  triage map for playback, mpv IPC, provider resolution, presence, storage,
  diagnostics, and shell command routing.
- Linked the debugging map from `AGENTS.md` and
  [.docs/diagnostics-guide.md](../.docs/diagnostics-guide.md).
- Marked the coherence plan and autonomous path as implemented.
- Updated [.plans/roadmap.md](./roadmap.md) and
  [.plans/plan-implementation-truth.md](./plan-implementation-truth.md) so
  future agents see the reliability/coherence path as complete and use this
  report for follow-ups.

## Contradictions Fixed

- README and PR checklist previously under-described the expected local gate by
  emphasizing `typecheck`, `lint`, and `fmt` without making `test` and
  build-sensitive `build` explicit.
- The docs now consistently say deterministic automation does not hit live
  providers or Discord. Live provider and Rich Presence checks remain opt-in
  release confidence checks.
- Cross-subsystem debugging now has one short routing map instead of relying on
  broad searches through diagnostics, runtime boundary, and provider docs.

## Historical Or Superseded Docs

- No historical provider dossiers, brainstorm docs, or legacy archives were
  deleted in this pass.
- Existing provider dossiers that say broken, deprecated, superseded, or
  scratchpad were kept as research evidence rather than treated as runtime truth.
- `archive/legacy` and `apps/experiments` remain reference/research paths and
  are not active runtime behavior.
- `.plans/plan-implementation-truth.md` remains the canonical place to resolve
  old plan status drift.

## Code Removed Or Renamed

- None.

No code deletion or rename met the low-risk threshold for this sweep. The largest
coherence issues are architectural and should be handled with focused tests and
small extraction plans, not bundled with docs reconciliation.

## Deferred Findings

- **Persistent mpv decomposition:** `PersistentMpvSession` still owns lifecycle,
  IPC event routing, ready work, subtitle cleanup, reconnect, telemetry, and
  playback position state. Extract ready-work execution and subtitle management
  only after the fake IPC harness covers the target behavior.
- **Unified trace/event correlation:** implemented in the follow-up sweep.
  Diagnostics events, debug JSONL traces, support bundles, background task
  failures, provider timelines, and playback runtime events now share optional
  `sessionId`, `playbackCycleId`, `providerAttemptId`, and `traceId` fields.
- **Provider capability dispatch:** registry-level provider special cases should
  continue moving toward manifest-declared capabilities.
- **Single mounted content tree:** browse/playback shell transitions still have
  phase-loop seams; continue the Phase 1.8 plan instead of adding more helper
  screens.
- **Split `ink-shell.tsx`:** the shell remains large and should be split around
  root host, command routing, panels, and playback chrome.
- **Provider dossier taxonomy:** provider research docs are useful but should
  eventually be grouped into active, deprecated, broken, and scratchpad indexes.
- **Real-player smoke evidence:** the fake mpv harness is strong, but release
  candidates still need one real mpv smoke for player/window/terminal behavior.

## Next Recommended Sweep

The next reliability sweep should focus on **Persistent mpv decomposition**:
extract ready-work execution and subtitle management behind the existing fake
IPC harness so playback state remains easier to reason about as more recovery
paths are added.

## Verification

Completed on 2026-05-17:

- `bun run fmt` passed
- `bun run lint` passed with 0 warnings and 0 errors
- `bun run test` passed: CLI suite reported 676 pass, 0 fail, 1579 expects
- `bun run typecheck` passed
- `bun run build` passed and produced `apps/cli/dist/kunai.js`
- `bun run pkg:check` passed and completed `npm pack --dry-run`

Live provider and Discord smokes are intentionally not part of this default
deterministic pass.
