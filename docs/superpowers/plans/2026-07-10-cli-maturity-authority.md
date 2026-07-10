# CLI Maturity Authority Implementation Plan

> For agentic workers: use superpowers:executing-plans task-by-task.

Goal: Enforce provider lanes, converge continuation/history decisions, make root surface ownership explicit, and add recovery/performance proof.

Architecture: Guards are pure and shared at every external boundary. Continuation returns one decision contract. SessionController remains the only transition owner; root-content and overlays are projections, not competing routers.

## Task 1: Enforce Provider-Lane Contracts

Files:

- Create: apps/cli/src/domain/provider-lane-contract.ts
- Modify: apps/cli/src/services/providers/stream-request-adapter.ts
- Modify: apps/cli/src/app/bootstrap/launch-entry.ts
- Test: apps/cli/test/unit/domain/provider-lane-contract.test.ts
- Test: apps/cli/test/integration/provider-lane-engine.test.ts

- [ ] Write failing tests for series/anime/youtube title-to-provider mismatch, YouTube history restoring the YouTube lane, and wrong-lane resolve refusing before engine work.
- [ ] Run: bun run --cwd apps/cli test:file test/unit/domain/provider-lane-contract.test.ts. Expect failure.
- [ ] Implement assertProviderLane({ mode, title, providerMetadata }) returning a typed mismatch result; use it before stream request creation and history/share restoration.
- [ ] Add a real-engine fixture test asserting wrong-lane requests never call container.engine.resolve.
- [ ] Run focused tests, typecheck, lint, then commit: fix(lanes): enforce provider isolation.

## Task 2: Make Continuation One Decision Contract

Files:

- Modify: apps/cli/src/domain/continuation/ContinuationEngine.ts
- Modify: apps/cli/src/services/continuation/ContinuationProjectionService.ts
- Modify: apps/cli/src/app/bootstrap/launch-entry.ts
- Modify: apps/cli/src/app-shell/root-history-bridge.ts
- Test: apps/cli/test/unit/domain/continuation/continuation-engine.test.ts
- Test: apps/cli/test/integration/continuation-launch-contract.test.ts

- [ ] Add failing tests for resume, offline-ready, new episode, completed, and YouTube history decisions.
- [ ] Return target, required lane, primary action, badge, detail, freshness, and reason from one continuation decision.
- [ ] Replace local history/startup lane and target guesses with that decision.
- [ ] Verify CLI unit/integration tests and commit: refactor(continuation): centralize launch decisions.

## Task 3: Converge Root Surface Ownership

Files:

- Modify: apps/cli/src/app-shell/root-content-state.ts
- Modify: apps/cli/src/app-shell/root-shell-state.ts
- Modify: apps/cli/src/app/session/SessionController.ts
- Test: apps/cli/test/unit/app-shell/root-content-state.test.ts
- Test: apps/cli/test/unit/app-shell/root-shell-state.test.tsx

- [ ] Add failing tests for full-screen replacement, lightweight overlay stacking, picker cancellation, and return to previous root content.
- [ ] Define typed surface intents and results; SessionController maps intents to mounted content or overlay transitions.
- [ ] Remove helper-local surface-priority decisions.
- [ ] Verify render-capture resize and input paths, then commit: refactor(shell): centralize root surface transitions.

## Task 4: Prove Recovery And Diagnostics

Files:

- Create: apps/cli/src/services/diagnostics/recovery-contract.ts
- Modify: apps/cli/src/app-shell/loading-shell-model.ts
- Modify: apps/cli/src/app-shell/root-content-shell.tsx
- Test: apps/cli/test/unit/services/diagnostics/recovery-contract.test.ts
- Test: apps/cli/test/unit/app-shell/recovery-action-contract.test.ts

- [ ] Write a failure-class to diagnostic action to visible action to state-transition table as executable tests.
- [ ] Implement one recovery contract consumed by loading/error surfaces.
- [ ] Confirm every action has a redacted diagnostic and an enabled command.
- [ ] Commit: fix(diagnostics): align recovery actions with shell state.

## Task 5: Measure And Improve Startup And Interaction Performance

Files:

- Create: apps/cli/src/services/diagnostics/startup-timeline.ts
- Modify: apps/cli/src/main.ts
- Modify: apps/cli/src/app-shell/ink-shell.tsx
- Modify: apps/cli/src/services/catalog/TitleDetailService.ts
- Test: apps/cli/test/unit/services/diagnostics/startup-timeline.test.ts
- Test: apps/cli/test/unit/app-shell/ink-shell-polling.test.tsx

- [ ] Add deterministic startup marks for bootstrap, first Ink frame, ready, and first result.
- [ ] Add AbortSignal to detail/search boundaries and abort obsolete work on newer intent.
- [ ] Replace polling with subscriptions where a service already exposes one; retain low-frequency fallback only.
- [ ] Add rapid-navigation frame tests and commit: perf(cli): measure and reduce shell work.

## Task 6: Provider Verification And Release Gate

- [ ] Run deterministic real-engine lane tests first.
- [ ] Run opt-in live smokes through container.engine.resolve for one series, anime, and YouTube target; assert only safe result metadata.
- [ ] Run bun run --cwd apps/cli test, bun run typecheck, bun run lint, bun run fmt:check, and bun run build.
- [ ] Update .plans truth records and commit: docs: reconcile cli maturity authority.
