# Candidate Racing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut worst-case resolve latency by racing a provider's own source candidates instead of walking them one at a time, without letting the losers of a race poison endpoint health.

**Architecture:** `runProviderCycle` in `@kunai/core` gains an optional `hedgeDelayMs`, mirroring the provider-level `resolveHedged` that already exists one layer up in `provider-engine.ts`. When set, the next candidate launches alongside the current one after the delay and the first success wins; losers are aborted. Endpoint-health writes from aborted losers are suppressed by a cancellation-aware wrapper, because a candidate that was cancelled did not fail.

**Tech Stack:** Bun, TypeScript, `bun:test`, `AbortController`.

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm`, `npx`, `node`, `yarn`, or `pnpm`.
- Run the full suite with `bun run test` from the repo root, never bare `bun test`.
- The repo forbids non-null assertions (`no-non-null-assertion`).
- **Cancellation is not failure.** A raced candidate that loses must record no endpoint-health failure. Getting this wrong quarantines healthy endpoints silently and degrades over time rather than failing loudly — it is the single highest-risk part of this work.
- **A cancel and a timeout are different.** An attempt's signal aborts for both reasons. A bare `signal.aborted` check cannot distinguish them and would discard genuine timeout evidence that feeds the transient cooldown. Use the typed `ProviderAttemptTimeoutError` / `isCancellationAbort` pair from `packages/core/src/provider-attempt-cancellation.ts`.
- Do not add local `if (signal.aborted)` guards inside provider modules. The rule is a property of cancellation and belongs in the engine.
- Racing must stay **off by default in this plan**. It ships behind an explicit option so it can be enabled per startup priority once measured. Changing the default is a separate decision backed by trace data.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run fmt`.
- Spec of record: `docs/superpowers/specs/2026-07-28-resolve-loop-design.md` §5.1.

**Prerequisite:** `docs/superpowers/plans/2026-07-28-resolve-telemetry-spine.md` must be complete. Task 5 of this plan compares against a traced latency baseline; without traces there is no way to show the change helped.

## Executor Protocol

### Working directory

```bash
cd "$(git rev-parse --show-toplevel)" && <your command>
```

### The red phase is mandatory

Write test → **run it and watch it fail** → implement → run it and watch it pass → commit. A test that passes before the implementation exists is broken; fix the test first.

### Do not repair collateral damage

If a **pre-existing** test fails, stop and report file, line, and assertion. Do not edit it to pass.

### Commit discipline

One commit per task, staging only that task's **Files**. **Never `git add -A`.**

## File Structure

| File                                                  | Responsibility                                                | Change                |
| ----------------------------------------------------- | ------------------------------------------------------------- | --------------------- |
| `packages/core/src/provider-cycle-endpoint-health.ts` | Cancellation-aware `EndpointHealthPort` wrapper. Pure policy. | **Create**            |
| `packages/core/src/provider-cycle-engine.ts`          | Racing loop beside the existing sequential loop.              | Modify (~line 81-200) |
| `packages/core/src/index.ts`                          | Export the wrapper.                                           | Modify                |
| `packages/providers/src/videasy/direct.ts`            | Pass a hedge delay for the worst-tail cycle.                  | Modify (~line 557)    |

The health wrapper is its own file rather than living inside `provider-cycle-engine.ts` because the same policy already exists one layer up (`provider-attempt-cancellation.ts`) and the two must stay recognisably parallel. Reviewers comparing them should not have to read a 540-line engine to find it.

---

### Task 1: Suppress endpoint-health writes from cancelled candidates

Today `runProviderCycle` records a failure for every candidate that throws. Under racing, every loser throws an abort — so racing without this task first would quarantine the healthy-but-slower half of every race.

**Files:**

- Create: `packages/core/src/provider-cycle-endpoint-health.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/provider-cycle-endpoint-health.test.ts`

**Interfaces:**

- Consumes: `isCancellationAbort` from `./provider-attempt-cancellation`.
- Produces: `withCancellationAwareEndpointHealth(port, signal): EndpointHealthPort`

  Task 2 wraps the caller-supplied port with this before the racing loop uses it.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/provider-cycle-endpoint-health.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { ProviderAttemptTimeoutError } from "../src/provider-attempt-cancellation";
import { withCancellationAwareEndpointHealth } from "../src/provider-cycle-endpoint-health";

function recorder() {
  const failures: string[] = [];
  const successes: string[] = [];
  return {
    failures,
    successes,
    port: {
      shouldTry: () => true,
      recordFailure: (_p: string, endpoint: string) => void failures.push(endpoint),
      recordSuccess: (_p: string, endpoint: string) => void successes.push(endpoint),
    },
  };
}

describe("withCancellationAwareEndpointHealth", () => {
  test("passes failures through when nothing was cancelled", () => {
    const { port, failures } = recorder();
    const controller = new AbortController();
    const guarded = withCancellationAwareEndpointHealth(port as never, controller.signal);

    guarded.recordFailure("videasy", "wings-cdn", { class: "server-error", titleId: "1" });
    expect(failures).toEqual(["wings-cdn"]);
  });

  test("drops failures issued after a cancellation", () => {
    const { port, failures } = recorder();
    const controller = new AbortController();
    const guarded = withCancellationAwareEndpointHealth(port as never, controller.signal);

    controller.abort();
    guarded.recordFailure("videasy", "wings-cdn", { class: "server-error", titleId: "1" });
    // A candidate that lost a race did not fail — it was cancelled.
    expect(failures).toEqual([]);
  });

  test("keeps failures when the abort was this attempt's own timeout", () => {
    const { port, failures } = recorder();
    const controller = new AbortController();
    const guarded = withCancellationAwareEndpointHealth(port as never, controller.signal);

    controller.abort(new ProviderAttemptTimeoutError());
    guarded.recordFailure("videasy", "wings-cdn", { class: "transient", titleId: "1" });
    // A timeout is real evidence and must still feed the cooldown.
    expect(failures).toEqual(["wings-cdn"]);
  });

  test("successes are never suppressed", () => {
    const { port, successes } = recorder();
    const controller = new AbortController();
    const guarded = withCancellationAwareEndpointHealth(port as never, controller.signal);

    controller.abort();
    guarded.recordSuccess("videasy", "wings-cdn");
    expect(successes).toEqual(["wings-cdn"]);
  });

  test("an absent signal behaves as never cancelled", () => {
    const { port, failures } = recorder();
    const guarded = withCancellationAwareEndpointHealth(port as never, undefined);
    guarded.recordFailure("videasy", "cdn", { class: "server-error", titleId: "1" });
    expect(failures).toEqual(["cdn"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/packages/core" && bun test test/provider-cycle-endpoint-health.test.ts
```

Expected: FAIL — `Cannot find module '../src/provider-cycle-endpoint-health'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/provider-cycle-endpoint-health.ts`:

```ts
import { isCancellationAbort } from "./provider-attempt-cancellation";

/**
 * Structural shape of the endpoint-health port used by the cycle engine.
 * Declared locally so this module stays free of app-layer imports.
 */
export interface CycleEndpointHealthPort {
  shouldTry(providerId: string, endpoint: string): boolean;
  recordFailure(
    providerId: string,
    endpoint: string,
    info: { class: string; titleId?: string; at?: string },
  ): void;
  recordSuccess(providerId: string, endpoint: string): void;
}

/**
 * Drop endpoint-health failures issued after a cancellation.
 *
 * Racing aborts every candidate that loses. Those aborts surface in the
 * provider's catch block as ordinary errors, so without this wrapper a race
 * would record a failure against an endpoint that did nothing wrong — and
 * repeated races would quarantine the healthy-but-slower half of the pool,
 * invisibly.
 *
 * The distinction that matters: an attempt's signal aborts both when someone
 * cancels *and* when that attempt hits its own timeout. Only the former is
 * "no evidence". A timeout is real evidence and still feeds the transient
 * cooldown, which is why this checks `isCancellationAbort` rather than the
 * signal's `aborted` flag.
 *
 * Mirrors `wrapEndpointHealthForAttempt` in `provider-attempt-cancellation.ts`,
 * which applies the same rule one layer up at the provider level.
 */
export function withCancellationAwareEndpointHealth(
  port: CycleEndpointHealthPort,
  signal: AbortSignal | undefined,
): CycleEndpointHealthPort {
  return {
    shouldTry: (providerId, endpoint) => port.shouldTry(providerId, endpoint),
    recordFailure: (providerId, endpoint, info) => {
      if (signal && isCancellationAbort(signal)) return;
      port.recordFailure(providerId, endpoint, info);
    },
    recordSuccess: (providerId, endpoint) => port.recordSuccess(providerId, endpoint),
  };
}
```

In `packages/core/src/index.ts`, add beside the existing `provider-attempt-cancellation` export:

```ts
export * from "./provider-cycle-endpoint-health";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/packages/core" && bun test test/provider-cycle-endpoint-health.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run typecheck
```

Expected: PASS, 5 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/core/src/provider-cycle-endpoint-health.ts packages/core/src/index.ts packages/core/test/provider-cycle-endpoint-health.test.ts
git commit -m "feat(core): suppress endpoint health writes from cancelled candidates"
```

---

### Task 2: Race candidates inside the cycle

`runProviderCycle` walks candidates strictly sequentially (`provider-cycle-engine.ts:124`). Videasy walks up to 11 at a 20s timeout each, which is the worst latency tail in the codebase.

**Files:**

- Modify: `packages/core/src/provider-cycle-engine.ts` (add `hedgeDelayMs` to `RunProviderCycleInput`; add a racing branch)
- Test: `packages/core/test/provider-cycle-racing.test.ts`

**Interfaces:**

- Consumes: `withCancellationAwareEndpointHealth` from Task 1.
- Produces: `RunProviderCycleInput.hedgeDelayMs?: number` — when absent or `<= 0`, behaviour is byte-identical to today's sequential loop.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/provider-cycle-racing.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { runProviderCycle } from "../src/provider-cycle-engine";

type Candidate = { id: string; serverId: string };

function candidates(...ids: string[]): Candidate[] {
  return ids.map((id) => ({ id, serverId: id }));
}

describe("runProviderCycle racing", () => {
  test("without a hedge delay, candidates run strictly in order", async () => {
    const started: string[] = [];
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      candidates: candidates("a", "b", "c") as never,
      resolveCandidate: async (ctx) => {
        started.push(ctx.candidate.id);
        if (ctx.candidate.id !== "c") throw new Error("nope");
        return "stream-c";
      },
    } as never);

    expect(started).toEqual(["a", "b", "c"]);
    expect(result.selected).toBe("stream-c");
  });

  test("a slow first candidate does not block a fast second one", async () => {
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("slow", "fast") as never,
      resolveCandidate: async (ctx) => {
        if (ctx.candidate.id === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return "stream-slow";
        }
        return "stream-fast";
      },
    } as never);

    expect(result.selected).toBe("stream-fast");
    expect(result.selectedCandidate?.id).toBe("fast");
  });

  test("the loser of a race records no endpoint-health failure", async () => {
    const failures: string[] = [];
    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("slow", "fast") as never,
      endpointHealth: {
        shouldTry: () => true,
        recordFailure: (_p: string, endpoint: string) => void failures.push(endpoint),
        recordSuccess: () => {},
      } as never,
      resolveCandidate: async (ctx) => {
        if (ctx.candidate.id === "slow") {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          return "stream-slow";
        }
        return "stream-fast";
      },
    } as never);

    // "slow" was cancelled, not broken. Recording it would quarantine a
    // perfectly good endpoint.
    expect(failures).toEqual([]);
  });

  test("a genuinely failing candidate still records a failure", async () => {
    const failures: string[] = [];
    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("broken", "good") as never,
      endpointHealth: {
        shouldTry: () => true,
        recordFailure: (_p: string, endpoint: string) => void failures.push(endpoint),
        recordSuccess: () => {},
      } as never,
      resolveCandidate: async (ctx) => {
        if (ctx.candidate.id === "broken") throw new Error("HTTP 500");
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "stream-good";
      },
    } as never);

    expect(failures).toEqual(["broken"]);
  });

  test("quarantined candidates are still skipped while racing", async () => {
    const tried: string[] = [];
    await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("dead", "good") as never,
      endpointHealth: {
        shouldTry: (_p: string, endpoint: string) => endpoint !== "dead",
        recordFailure: () => {},
        recordSuccess: () => {},
      } as never,
      resolveCandidate: async (ctx) => {
        tried.push(ctx.candidate.id);
        return "stream";
      },
    } as never);

    expect(tried).not.toContain("dead");
  });

  test("cancelling the parent stops the whole race", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      signal: controller.signal,
      candidates: candidates("a", "b") as never,
      resolveCandidate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return "never";
      },
    } as never);

    expect(result.cancelled).toBe(true);
    expect(result.selected).toBeUndefined();
  });

  test("all candidates failing still exhausts cleanly", async () => {
    const result = await runProviderCycle<string>({
      providerId: "videasy",
      hedgeDelayMs: 10,
      candidates: candidates("a", "b") as never,
      resolveCandidate: async () => {
        throw new Error("HTTP 500");
      },
    } as never);

    expect(result.selected).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/packages/core" && bun test test/provider-cycle-racing.test.ts
```

Expected: FAIL. The first test passes (sequential behaviour is unchanged), but "a slow first candidate does not block a fast second one" times out or returns `stream-slow`, because `hedgeDelayMs` is not yet honoured.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/provider-cycle-engine.ts`, add to `RunProviderCycleInput`:

```ts
  /**
   * When > 0, start the next candidate alongside the current one after this
   * delay and take whichever resolves first. Absent or <= 0 keeps the strictly
   * sequential walk. Off by default: racing doubles outbound requests to the
   * sites being scraped, so enabling it is a measured decision, not a default.
   */
  readonly hedgeDelayMs?: number;
```

Immediately after the `transientRetryBudget` line in `runProviderCycle`, branch to the racing implementation:

```ts
const hedgeDelayMs = Math.max(0, input.hedgeDelayMs ?? 0);
if (hedgeDelayMs > 0) {
  return runProviderCycleRaced({
    ...input,
    hedgeDelayMs,
    candidateTimeoutMs,
    now,
    emit,
    events,
    attempts,
  });
}
```

Then add the racing function at the bottom of the file. It mirrors `resolveHedged` in `provider-engine.ts:447`:

```ts
/**
 * Race a provider's own source candidates.
 *
 * Mirrors `ProviderEngine.resolveHedged`, one layer down: the next candidate
 * launches after `hedgeDelayMs` while the current one is still in flight, the
 * first success wins, and losers are aborted immediately.
 *
 * Every in-flight candidate gets its own `AbortController`, and each one's
 * endpoint-health port is wrapped so a loser's abort cannot be recorded as a
 * failure. Without that wrapper this function would steadily quarantine the
 * slower half of a healthy candidate pool.
 */
async function runProviderCycleRaced<TResolved>(input: {
  readonly providerId: ProviderId;
  readonly candidates: readonly ProviderCycleCandidate[];
  readonly resolveCandidate: RunProviderCycleInput<TResolved>["resolveCandidate"];
  readonly endpointHealth?: CycleEndpointHealthPort;
  readonly signal?: AbortSignal;
  readonly hedgeDelayMs: number;
  readonly candidateTimeoutMs: number;
  readonly now: () => string;
  readonly emit: (event: ProviderTraceEvent) => void;
  readonly events: ProviderTraceEvent[];
  readonly attempts: ProviderCycleAttempt[];
}): Promise<ProviderCycleResult<TResolved>> {
  type Settled =
    | { kind: "success"; index: number; candidate: ProviderCycleCandidate; selected: TResolved }
    | { kind: "failure"; index: number; candidate: ProviderCycleCandidate; error: unknown }
    | { kind: "aborted"; index: number; candidate: ProviderCycleCandidate };

  const { emit, now, attempts, events } = input;

  const eligible = orderCycleCandidates(input.candidates).filter((candidate) => {
    const endpoint = candidate.serverId;
    if (!endpoint || !input.endpointHealth) return true;
    if (input.endpointHealth.shouldTry(input.providerId, endpoint)) return true;
    emit(
      createCycleTraceEvent("source:skipped", candidate, now(), {
        reason: "quarantined",
        endpoint,
      }),
    );
    return false;
  });

  const inFlight = new Map<
    number,
    { controller: AbortController; settled: Promise<Settled>; candidate: ProviderCycleCandidate }
  >();
  let nextIndex = 0;

  const abortAll = (reason?: unknown) => {
    for (const entry of inFlight.values()) entry.controller.abort(reason);
    inFlight.clear();
  };

  const launchNext = (): boolean => {
    const candidate = eligible[nextIndex];
    if (!candidate) return false;
    const index = nextIndex++;
    const controller = new AbortController();
    if (input.signal?.aborted) controller.abort(input.signal.reason);

    const startedAt = now();
    emit(createCycleTraceEvent("source:start", candidate, startedAt, { attempt: 1 }));

    const guardedHealth = input.endpointHealth
      ? withCancellationAwareEndpointHealth(input.endpointHealth, controller.signal)
      : undefined;

    const settled: Promise<Settled> = resolveCandidateWithTimeout({
      candidate,
      attempt: 1,
      candidateTimeoutMs: input.candidateTimeoutMs,
      parentSignal: controller.signal,
      now,
      emit,
      resolveCandidate: input.resolveCandidate,
    }).then(
      (selected): Settled => {
        const endpoint = candidate.serverId;
        if (endpoint && guardedHealth) {
          guardedHealth.recordSuccess(input.providerId, endpoint);
        }
        return { kind: "success", index, candidate, selected };
      },
      (error): Settled => {
        if (controller.signal.aborted && isCancellationAbort(controller.signal)) {
          return { kind: "aborted", index, candidate };
        }
        const endpoint = candidate.serverId;
        if (endpoint && guardedHealth) {
          guardedHealth.recordFailure(input.providerId, endpoint, {
            class: "server-error",
            titleId: undefined,
            at: now(),
          });
        }
        return { kind: "failure", index, candidate, error };
      },
    );

    inFlight.set(index, { controller, settled, candidate });
    return true;
  };

  const onParentAbort = () => abortAll(input.signal?.reason);
  input.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    if (input.signal?.aborted) {
      return {
        attempts,
        events,
        stopReason: "cancelled",
        fallbackRequested: false,
        cancelled: true,
      };
    }
    launchNext();

    while (inFlight.size > 0) {
      if (input.signal?.aborted) break;

      let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
      const racers: Array<Promise<Settled | "hedge">> = [...inFlight.values()].map(
        (entry) => entry.settled,
      );
      if (nextIndex < eligible.length) {
        racers.push(
          new Promise<"hedge">((resolve) => {
            hedgeTimer = setTimeout(() => resolve("hedge"), input.hedgeDelayMs);
          }),
        );
      }

      const outcome = await Promise.race(racers);
      if (hedgeTimer) clearTimeout(hedgeTimer);

      if (outcome === "hedge") {
        launchNext();
        continue;
      }

      inFlight.delete(outcome.index);
      const endedAt = now();

      if (outcome.kind === "success") {
        attempts.push({ candidate: outcome.candidate, attempt: 1, startedAt: endedAt, endedAt });
        emit(createCycleTraceEvent("source:success", outcome.candidate, endedAt, { attempt: 1 }));
        abortAll();
        return {
          selected: outcome.selected,
          selectedCandidate: outcome.candidate,
          attempts,
          events,
          stopReason: "resolved",
          fallbackRequested: false,
          cancelled: false,
        };
      }

      if (outcome.kind === "failure") {
        const failure = toCycleFailure(outcome.candidate, outcome.error, now);
        attempts.push({
          candidate: outcome.candidate,
          attempt: 1,
          startedAt: endedAt,
          endedAt,
          failure,
        });
        emit(createCycleTraceEvent("source:failed", outcome.candidate, endedAt, { attempt: 1 }));
      }

      if (inFlight.size === 0) launchNext();
    }

    const cancelled = input.signal?.aborted === true;
    return {
      attempts,
      events,
      stopReason: cancelled ? "cancelled" : "exhausted",
      fallbackRequested: false,
      cancelled,
    };
  } finally {
    input.signal?.removeEventListener("abort", onParentAbort);
    abortAll();
  }
}
```

Add the imports this needs at the top of the file:

```ts
import { isCancellationAbort } from "./provider-attempt-cancellation";
import {
  withCancellationAwareEndpointHealth,
  type CycleEndpointHealthPort,
} from "./provider-cycle-endpoint-health";
```

If a helper referenced above (`orderCycleCandidates`, `resolveCandidateWithTimeout`, `createCycleTraceEvent`, `toCycleFailure`) is declared below its use, TypeScript function declarations hoist — no reordering is required. If any is a `const` arrow function, move the new function below it rather than converting it.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/packages/core" && bun test test/provider-cycle-racing.test.ts
cd "$(git rev-parse --show-toplevel)/packages/core" && bun test
```

Expected: PASS, 7 new tests, and every pre-existing `@kunai/core` test still green. The sequential path is untouched when `hedgeDelayMs` is absent.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/core/src/provider-cycle-engine.ts packages/core/test/provider-cycle-racing.test.ts
git commit -m "feat(core): race provider source candidates behind an opt-in hedge delay"
```

---

### Task 3: Enable racing for the worst tail

Videasy is the motivating case: up to 11 candidates at `VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS` = 20s each.

**Files:**

- Modify: `packages/providers/src/videasy/direct.ts` (~line 557, and the two sibling `runProviderCycle` calls at ~599 and ~648)
- Test: `packages/providers/test/videasy-cycle-hedge.test.ts`

**Interfaces:**

- Consumes: `hedgeDelayMs` from Task 2.
- Produces: `VIDKING_CYCLE_HEDGE_DELAY_MS: number` (`4_000`), exported for the test to assert against rather than duplicating a literal.

- [ ] **Step 1: Write the failing test**

Create `packages/providers/test/videasy-cycle-hedge.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  VIDKING_CYCLE_HEDGE_DELAY_MS,
  VIDKING_VIDEASY_FETCH_TIMEOUT_MS,
} from "../src/videasy/direct";

describe("videasy cycle hedging", () => {
  test("hedges well before a candidate's own timeout", () => {
    // Hedging only helps if it fires while the first candidate is still
    // waiting. A delay at or above the candidate timeout is inert.
    expect(VIDKING_CYCLE_HEDGE_DELAY_MS).toBeGreaterThan(0);
    expect(VIDKING_CYCLE_HEDGE_DELAY_MS).toBeLessThan(VIDKING_VIDEASY_FETCH_TIMEOUT_MS);
  });

  test("leaves room for a normal fast candidate to win outright", () => {
    // Below ~2s we would race almost every resolve, doubling outbound load on
    // a scraped site for no latency gain.
    expect(VIDKING_CYCLE_HEDGE_DELAY_MS).toBeGreaterThanOrEqual(2_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/packages/providers" && bun test test/videasy-cycle-hedge.test.ts
```

Expected: FAIL — `VIDKING_CYCLE_HEDGE_DELAY_MS` is not exported from `../src/videasy/direct`.

- [ ] **Step 3: Write minimal implementation**

In `packages/providers/src/videasy/direct.ts`, beside `VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS`:

```ts
/**
 * Delay before racing the next source candidate.
 *
 * Videasy walks up to 11 candidates at a 20s timeout each, the worst latency
 * tail in the codebase. Racing at 4s means a stalled candidate costs ~4s of
 * added wall time instead of a full 20s, while a candidate that resolves
 * normally (well under 4s) still wins outright and costs one request.
 *
 * Tune from `resolve_traces` once real p50 data exists — this is a reasoned
 * starting value, not a measured one.
 */
export const VIDKING_CYCLE_HEDGE_DELAY_MS = 4_000;
```

Then add `hedgeDelayMs: VIDKING_CYCLE_HEDGE_DELAY_MS,` beside the existing `candidateTimeoutMs: VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS,` at **all three** `runProviderCycle` call sites (~557, ~599, ~648). Do not change `candidateTimeoutMs`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/packages/providers" && bun test
cd "$(git rev-parse --show-toplevel)" && bun run test
```

Expected: PASS, and the whole repo suite green.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/providers/src/videasy/direct.ts packages/providers/test/videasy-cycle-hedge.test.ts
git commit -m "perf(videasy): race source candidates instead of walking 11 sequentially"
```

---

### Task 4: Verify against the traced baseline

Racing is a latency change. It is only done when the numbers say so.

**Files:** none — this task produces evidence, not code.

- [ ] **Step 1: Capture the before-baseline**

This must be done **before** Task 3 is enabled, or from traces recorded prior to it.

```bash
cd "$(git rev-parse --show-toplevel)"
cp ~/.cache/kunai/kunai-cache.sqlite /tmp/kunai-baseline.sqlite
sqlite3 /tmp/kunai-baseline.sqlite \
  "select count(*) from resolve_traces;"
```

Never query the live database directly — always copy first.

- [ ] **Step 2: Exercise several resolves**

Run `bun run dev` and play at least five different titles through videasy, including at least one that previously stalled.

- [ ] **Step 3: Compare**

```bash
cd "$(git rev-parse --show-toplevel)"
cp ~/.cache/kunai/kunai-cache.sqlite /tmp/kunai-after.sqlite
sqlite3 /tmp/kunai-after.sqlite \
  "select json_extract(trace_json,'$.selectedProviderId') as provider,
          count(*) as n
     from resolve_traces group by provider;"
```

Report the observed change in wall time between `startedAt` and `endedAt` for videasy traces, before versus after.

- [ ] **Step 4: Record the finding**

Append the measured numbers to `docs/superpowers/specs/2026-07-28-resolve-loop-design.md` §11 Acceptance, replacing the placeholder expectation with the real figure. If p95 did **not** improve, say so and stop — do not tune the delay to manufacture a win without understanding why.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/superpowers/specs/2026-07-28-resolve-loop-design.md
git commit -m "docs(providers): record measured candidate racing latency change"
```

---

## Verification

Complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, `bun run test` pass from the repo root.
- With `hedgeDelayMs` absent, `runProviderCycle` behaviour is unchanged — the existing sequential tests all still pass untouched.
- A candidate that loses a race records **no** endpoint-health failure.
- A candidate that genuinely fails **does** record one.
- A candidate that times out records a `transient` failure — timeout evidence is not swallowed.
- Quarantined candidates are still skipped while racing.
- Cancelling the parent signal stops every in-flight candidate.
- The measured videasy latency change is written down, whatever it says.

## Out of scope

- Enabling racing for providers other than videasy — do that once videasy's numbers are in
- Changing `hedgeDelayMs` defaults per `startupPriority`
- Provider-level hedge tuning (`resolveHedged`) — already shipped, tuned separately
- Background shadow probing and latency-aware ordering — see the health-recovery plan
