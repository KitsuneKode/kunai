# Plan 007: Bound provider fan-out with a global resolve deadline and mode-aware retry count

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- packages/core/src/provider-engine.ts apps/cli/src/container/bootstrap-providers.ts apps/cli/src/services/playback/provider-resolve-budget-policy.ts apps/cli/src/services/playback/PlaybackResolveService.ts`
> Mismatch vs excerpts → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Stream resolution can stall for a very long time before either playing or giving up. Each provider is retried up to 3 times sequentially, each attempt bounded only by a per-attempt timeout (6s fast / 12s balanced / 30s quality-first), with a 250ms sleep between retries, and candidates are tried strictly in sequence — with a possible _second_ fallback pass on a dead stream. Worst case ≈ Σ over providers of `(3 × attemptTimeout + 2×250ms)`: a single flaky-but-retryable provider stalls ~36s on balanced; several candidates run into minutes. There is **no overall wall-clock budget** bounding the fan-out. Adding a total resolve deadline and reducing retries on the "fast" profile makes failure fast and predictable, which is core to the tool feeling like it "actually works."

## Current state

- `packages/core/src/provider-engine.ts:93`: `const DEFAULT_MAX_ATTEMPTS = 3;` `:95`: `DEFAULT_RETRY_DELAY_MS = 250;` retry loop `:178` `for (let attempt = 1; attempt <= this.maxAttempts; attempt++)`; give-up condition `:236`.
- `apps/cli/src/container/bootstrap-providers.ts:81-90`: constructs the engine with `attemptTimeoutMs: resolveProviderAttemptTimeoutMs(config.startupPriority)` and **no `maxAttempts` override** → all providers get 3 attempts.
- `apps/cli/src/services/playback/provider-resolve-budget-policy.ts`:

```ts
export function resolveProviderAttemptTimeoutMs(startupPriority: StartupPriority): number {
  switch (startupPriority) {
    case "fast":
      return 6_000;
    case "balanced":
      return 12_000;
    case "quality-first":
      return 30_000;
  }
}
```

- `apps/cli/src/services/playback/PlaybackResolveService.ts:478` drives `resolveWithFallback` over `compatibleIds`; a dead stream can trigger a second `resolveWithFallback` (~`:626`).
- The engine already accepts `maxAttempts?` (`provider-engine.ts:30`, `:111`).

Repo conventions: `StartupPriority` is a `@kunai/types` union (`fast` | `balanced` | `quality-first`); budget policy is the seam for timing knobs; conventional commits.

## Commands you will need

| Purpose    | Command                            | Expected |
| ---------- | ---------------------------------- | -------- |
| Typecheck  | `bun run typecheck`                | exit 0   |
| Lint       | `bun run lint`                     | exit 0   |
| Core tests | `bun run --cwd packages/core test` | pass     |
| CLI tests  | `bun run --cwd apps/cli test`      | pass     |

## Scope

**In scope**:

- `apps/cli/src/services/playback/provider-resolve-budget-policy.ts` (add max-attempts + total-deadline policy)
- `apps/cli/src/container/bootstrap-providers.ts` (pass `maxAttempts`)
- `packages/core/src/provider-engine.ts` (honor a total-resolve deadline if not already present)
- `apps/cli/src/services/playback/PlaybackResolveService.ts` (enforce the wall-clock deadline across the fan-out)
- Tests in `packages/core/test/` and `apps/cli/test/unit/services/playback/`

**Out of scope**:

- Racing candidates in parallel — that's a larger redesign; this plan only bounds the _sequential_ worst case. Note it as deferred.
- Per-provider timeout config UI.
- Changing what counts as a retryable failure (`provider-failure-classifier`).

## Git workflow

- Branch: `advisor/007-provider-resolve-deadline`
- Commit: `perf(providers): bound fan-out with a total resolve deadline and mode-aware retries`

## Steps

### Step 1: Add max-attempts + total-deadline to the budget policy

Extend `provider-resolve-budget-policy.ts` with functions returning, per `StartupPriority`:

- `resolveProviderMaxAttempts(p)`: `fast` → 1, `balanced` → 2, `quality-first` → 3.
- `resolveTotalDeadlineMs(p)`: a wall-clock cap for the whole fan-out, e.g. `fast` → 15_000, `balanced` → 45_000, `quality-first` → 120_000. (These are starting values — keep them named constants with a comment explaining they bound the sequential worst case.)

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Wire max-attempts into the engine

In `bootstrap-providers.ts`, pass `maxAttempts: resolveProviderMaxAttempts(config.startupPriority)` to `createProviderEngine`.

**Verify**: `bun run --cwd packages/core test` → pass (engine still honors `maxAttempts`).

### Step 3: Enforce the total deadline in the coordinator

In `PlaybackResolveService`, thread a deadline (an `AbortSignal` with a timeout, or a `deadlineAt` timestamp checked before each candidate) so the fan-out — including the second dead-stream fallback pass — stops once `resolveTotalDeadlineMs` elapses and returns a clean "no playable stream in time" result. Reuse any existing signal plumbing (`input.signal` is already passed around — check whether an `AbortSignal.timeout` can be composed with it via `AbortSignal.any`).

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Tests

- Budget policy: assert the max-attempts and deadline values per priority.
- Engine: with `maxAttempts: 1`, a retryable failure is NOT retried (assert one attempt).
- Coordinator: with a short injected deadline and providers that all stall, the resolve returns a not-found result within ~the deadline rather than running every attempt. Model after `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts` and `packages/core/test/provider-cycle-engine.test.ts`.

**Verify**: run the new/changed test files → pass.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test && bun run --cwd packages/core test` → all exit 0.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0; core + CLI tests pass
- [ ] `fast` profile uses 1 attempt/provider; `balanced` 2; `quality-first` 3 (test proves it)
- [ ] A stalling fan-out returns within the total deadline (test proves it)
- [ ] `bootstrap-providers.ts` passes `maxAttempts` to the engine
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- The engine cannot be given a total deadline without a structural change larger than "check a timestamp / compose a signal" — report and land only the max-attempts reduction.
- Reducing `fast` to 1 attempt causes existing live-smoke expectations to fail in a way that indicates real providers need ≥2 tries — report; consider `fast` → 2.
- `input.signal` semantics conflict with adding a timeout signal (double-abort handling) — report the conflict.

## Maintenance notes

- Deferred (intentional): racing the top-N candidates in parallel for the `fast` profile — the biggest further latency win, but a separate redesign. Note it in the roadmap.
- Reviewer: confirm the deadline result path is treated as "not found / try later," not as a hard error that suppresses the retry-next-time behavior.
- These timeout constants are the main tuning knob for perceived resolve speed — keep them centralized in the budget policy, never inlined at call sites.
