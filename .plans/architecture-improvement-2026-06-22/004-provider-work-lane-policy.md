# Plan 004: Provider Work-Lane Policy

Status: ready
Priority: P1
Effort: M
Risk: Medium
Created: 2026-06-22

## Problem

Kunai's provider engine and resolve work service are strong, but work classification is still partly informal. Foreground playback, near-need prefetch, background source probes, and manual diagnostics have different product expectations, yet some concurrency and timeout behavior is embedded as local constants or call-site convention.

Current evidence:

- `packages/core/src/provider-cycle-engine.ts` has structured provider-local candidate retries, fallback signals, cancellation, and trace events.
- `apps/cli/src/services/playback/PlaybackResolveWorkService.ts` already tracks `intentKind` and `budgetLane` in a resolve work ledger.
- `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts` exposes `prefetch`.
- `apps/cli/src/services/playback/VideasyLazySourceProbeService.ts` uses a hardcoded `PROBE_CONCURRENCY = 2`.
- `apps/cli/src/app/PlaybackPhase.ts` calls prefetch and provider resolve paths from several places.

Under harsh network conditions, product behavior should differ by lane:

- foreground playback should be fast, truthful, and cancellable
- near-need next episode work should warm without stealing foreground budget
- background source inventory probes should enrich UI but never block playback
- manual diagnostics should prefer evidence completeness over speed

## Goal

Formalize provider work lanes and make resolve, prefetch, background probes, and diagnostics use one shared policy table for concurrency, timeout, cache freshness, cancellation, and diagnostics verbosity.

## Non-Goals

- Do not rewrite provider adapters.
- Do not change provider priority order in this plan.
- Do not add browser/Playwright runtime.
- Do not change public provider contracts unless a new optional policy field is needed.

## Design

Add a shared policy module near playback resolve services:

```ts
export type ProviderWorkLane =
  | "foreground-playback"
  | "near-need-prefetch"
  | "background-inventory"
  | "manual-diagnostic";

export type ProviderWorkLanePolicy = {
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly freshness: ResolveFreshnessPolicy;
  readonly mayUseCachedInventory: boolean;
  readonly diagnosticsLevel: "summary" | "trace" | "full";
  readonly cancelWhenUnobserved: boolean;
};

export function providerWorkLanePolicy(lane: ProviderWorkLane): ProviderWorkLanePolicy;
```

Map existing concepts instead of inventing new ones:

- `ResolveIntentKind` maps into `ProviderWorkLane`.
- `ResolveBudgetLane` remains the budget label, but lane policy decides concrete timeouts/concurrency.
- `VideasyLazySourceProbeService` receives concurrency through policy/options instead of a constant.
- Diagnostic export uses lane and trace id to explain why a provider was skipped, retried, timed out, or used from cache.

## Implementation Steps

1. Add `apps/cli/src/services/playback/provider-work-lane-policy.ts`.
2. Map existing `ResolveIntentKind` and `ResolveBudgetLane` to `ProviderWorkLane` in one pure function.
3. Thread policy into `PlaybackResolveWorkService` ledger creation so each ledger records the chosen lane and policy summary.
4. Make `VideasyLazySourceProbeService` accept `probeConcurrency` in options and default it from policy.
5. Add `KUNAI_PROVIDER_PROBE_CONCURRENCY` only after policy exists, not as a one-off direct env read.
6. Ensure foreground resolve cancellation still aborts provider work when all consumers detach.
7. Add diagnostics projection for lane/policy:
   - lane
   - timeout budget
   - cache freshness policy
   - concurrency
   - whether work was joined, cancelled, prefetched, or foreground

## Tests

Add or extend:

- `apps/cli/test/unit/services/playback/provider-work-lane-policy.test.ts`
  - each intent maps to expected lane
  - foreground lane is stricter than manual diagnostics
  - background inventory uses bounded concurrency
- `apps/cli/test/unit/services/playback/VideasyLazySourceProbeService.test.ts`
  - injected concurrency controls worker count
  - background probe failures remain best-effort
- Existing provider cycle tests:
  - ensure cancellation and provider fallback semantics are unchanged

## Verification

Run after implementation:

```sh
bun run --cwd apps/cli test:file test/unit/services/playback/provider-work-lane-policy.test.ts
bun run --cwd apps/cli test:file test/unit/services/playback/VideasyLazySourceProbeService.test.ts
bun run --cwd packages/core test:file test/provider-cycle-engine.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

## Acceptance Criteria

- Provider work lanes are named in code, ledger, and diagnostics.
- Videasy phase-B probe concurrency is no longer a hardcoded module constant.
- Foreground playback and background inventory lanes have visibly different policy.
- Diagnostics can explain whether a resolve was foreground, prefetched, joined, or background.
- Existing provider fallback/cycling tests still pass.

## Rollback

Keep the policy module purely additive at first. If policy threading causes regressions, restore hardcoded call-site values while retaining tests for the policy mapping until the wiring can be retried.
