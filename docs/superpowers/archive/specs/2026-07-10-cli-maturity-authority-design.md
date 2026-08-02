# CLI Maturity Authority Design

## Goal

Make Kunai's CLI a mature, lane-safe, recoverable media system: one visible
surface authority, one continuation decision authority, explicit provider-lane
contracts, and measurable startup and interaction performance.

## Surface Authority

Kunai keeps one Ink application root. Root content and root overlays remain
separate state channels only while they follow one owner rule:

- a full-screen intent replaces the active root-content session;
- a lightweight overlay stacks over its underlying surface;
- a root overlay never silently loses to a mounted content session;
- helpers return typed intents/results and do not independently decide surface
  priority.

The SessionController owns transitions. `root-content-state.ts` owns only the
mounted content promise lifecycle. `root-shell-state.ts` owns only projection of
the current session and overlay state into one visible surface.

## Lane Contract

Every title, history entry, share target, offline entry, provider, and resolve
request has one `ProviderLane`: series, anime, or youtube. Cross-lane behavior
is rejected before provider work unless a dedicated adapter performs an explicit
conversion.

The contract is enforced at mode/provider transitions, history and share
restoration, provider selection, and stream request creation. UI provider lists
reuse the same predicate. The real engine must be tested against correct-lane
and wrong-lane inputs.

## Continuation Authority

ContinuationEngine is the sole decision source for continue/history semantics.
Its public decision includes target, required lane/provider, primary action,
badge/detail copy, offline readiness, release freshness, and reason. Startup
continue, history rows, root history selection, and return-loop surfaces render
or execute that decision rather than reconstructing local policy.

## Recoverability And Diagnostics

Every recoverable error produces a redacted diagnostic event, a clear state,
and one executable next action. A contract test maps failure class through
diagnostic recommended action, rendered copy, enabled command, and resulting
state transition. Non-blocking background failures remain visible in diagnostics
without breaking the active surface.

## Performance

Record startup timestamps for bootstrap, first Ink frame, shell-ready, and first
search result. Search/detail APIs accept abort signals; newer user intent aborts
obsolete transport work. Replace high-frequency shell polling with service
subscriptions where available and retain slow fallback refreshes only.

## Verification

Use deterministic model and render-capture tests for state ownership, lane
isolation, continuation, and recovery. Use real-engine fixture tests for provider
lane contracts. Run opt-in live smoke checks only after deterministic tests pass;
they call `container.engine.resolve(...)` and never log sensitive stream data.

## Delivery Order

1. Lane-contract types, guards, and real-engine tests.
2. Continuation decision contract and history/startup migration.
3. Root surface intent/result convergence.
4. Diagnostics-to-recovery matrix and shell action tests.
5. Startup instrumentation, cancellation, and polling reduction.

## Boundaries

- Do not change provider scraping/parsing while introducing lane guards.
- Do not remove root-content sessions before typed surface intent/result tests
  exist.
- Do not route provider video through relay by default.
- Do not add dependencies for testing or state management.
- Keep provider URLs, headers, tokens, and local paths out of diagnostics.
