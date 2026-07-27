# Resolve Telemetry Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make resolve behaviour observable and make provider health honest — wire the existing `ResolveTraceRepository` into the runtime, give `recentFailureRate` a known denominator, let it drive effective status, and make endpoint quarantine fire under real single-title viewing.

**Architecture:** Five independent changes across `packages/types`, `packages/schemas`, and `apps/cli`. No new tables, no migration: `resolve_traces` and `provider_endpoint_health` already exist with pruning. One optional field (`observations`) is added to `ProviderHealth`; absent values normalize to `0`, so old cache rows load unchanged. The trace sink is local-only and never leaves the machine.

**Tech Stack:** Bun, TypeScript, `bun:test`, SQLite via `@kunai/storage`, Zod via `@kunai/schemas`.

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm`, `npx`, `node`, `yarn`, or `pnpm`.
- Run the full suite with `bun run test` from the repo root, never bare `bun test`. Per-file runs during TDD use `bun test <path>` from inside the owning app directory only.
- The repo forbids non-null assertions (`no-non-null-assertion`). Restructure rather than reaching for `!`.
- Traces are **local-only**. Nothing in this plan may send a trace, a title id, or a URL off the machine. The opt-in analytics path (`apps/telemetry-ingest`) is untouched.
- `resolve_traces` retention stays owned by `packages/storage/src/maintenance.ts`. Do not add a second retention mechanism.
- Trace persistence is best-effort and must never fail a resolve. Every write is wrapped, matching the existing `// Cache persistence is best-effort` convention in `PlaybackResolveService`.
- Do not make `persistProviderHealthDelta` async. It is safe under concurrency **only** because there is no `await` between its `.get()` and `.set()`. Hedging makes concurrent resolves normal, so an `await` there becomes a real lost-update race.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run fmt`.
- Spec of record: `docs/superpowers/specs/2026-07-28-resolve-loop-design.md` §3, §4.1, §4.2.

## Executor Protocol

### Working directory

`cd` persists between tool calls. Every bash command must begin by returning to a known location:

```bash
cd "$(git rev-parse --show-toplevel)" && <your command>
```

### The red phase is mandatory

Every task is Write test → **Run it and watch it fail** → Implement → Run it and watch it pass → Commit. A test that passes before the implementation exists is a broken test; fix the test before continuing. When a step says `Expected: FAIL with <reason>`, the failure you observe must match that reason.

### Do not repair collateral damage

If a **pre-existing** test fails after your change, stop and report it — file, line, assertion. Do not edit the test to make it pass. The one exception is Task 1, where adding a required field to a `ProviderHealth` object literal may surface typecheck errors in files that build one without spreading a default; add `observations: 0` there and continue.

### Commit discipline

One commit per task with the exact message given. Stage only the files in that task's **Files** block. **Never `git add -A`** — other sessions may have unrelated uncommitted work in this tree.

## File Structure

| File                                                              | Responsibility                              | Change                        |
| ----------------------------------------------------------------- | ------------------------------------------- | ----------------------------- |
| `packages/types/src/index.ts`                                     | Declare `ProviderHealth.observations`.      | Modify (~line 388)            |
| `packages/schemas/src/index.ts`                                   | Validate `observations`.                    | Modify (~line 364)            |
| `apps/cli/src/services/playback/provider-health-observation.ts`   | Pure EWMA + observation math. No I/O.       | **Create**                    |
| `apps/cli/src/services/playback/provider-health-policy.ts`        | Read failure rate in effective status.      | Modify (~line 45)             |
| `apps/cli/src/services/playback/PlaybackResolveService.ts`        | Use the pure helper; persist traces.        | Modify (~line 764, ~line 276) |
| `apps/cli/src/services/playback/ProviderEndpointHealthService.ts` | Quarantine on consecutive-failure evidence. | Modify (~line 142)            |
| `apps/cli/src/services/diagnostics/ResolveTraceSink.ts`           | Own trace persistence + best-effort guard.  | **Create**                    |
| `apps/cli/src/container/bootstrap-persistence.ts`                 | Construct and expose the sink.              | Modify (~line 276)            |

`provider-health-observation.ts` is a separate module rather than inlined into `PlaybackResolveService` because the EWMA rule is the thing under test and the service is a large orchestration class that is awkward to unit-test. `ResolveTraceSink` is separate from the repository because the repository is pure storage in `@kunai/storage`, while the swallow-all-errors policy is an app-layer decision.

---

### Task 1: Give the failure rate a known denominator

`recentFailureRate` is an EWMA seeded at `1` on a first-ever failure, so a provider that failed exactly once is indistinguishable from one that fails constantly. Live evidence: vidlink sits at `1.0` with `consecutiveFailures: 1`. Fixing the seed alone is not enough — a consumer still cannot tell how much evidence backs the number, so an explicit observation count is added.

**Files:**

- Modify: `packages/types/src/index.ts` (after `recentFailureRate`, ~line 387)
- Modify: `packages/schemas/src/index.ts` (after `recentFailureRate`, ~line 363)
- Create: `apps/cli/src/services/playback/provider-health-observation.ts`
- Test: `apps/cli/test/unit/services/playback/provider-health-observation.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `ProviderHealth.observations?: number`
  - `FAILURE_RATE_DECAY: number` (`0.7`)
  - `FAILURE_RATE_STEP: number` (`0.3`)
  - `nextFailureRate(previous: number | undefined, failed: boolean): number`
  - `nextObservations(previous: number | undefined): number`

  Tasks 2 and 3 import `nextFailureRate` and `nextObservations`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/playback/provider-health-observation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { nextFailureRate, nextObservations } from "@/services/playback/provider-health-observation";

describe("nextFailureRate", () => {
  test("a first-ever failure is not reported as total failure", () => {
    // The old seed was 1.0, which made one bad night look identical to a
    // permanently dead provider.
    expect(nextFailureRate(undefined, true)).toBeCloseTo(0.3, 5);
  });

  test("a first-ever success is zero", () => {
    expect(nextFailureRate(undefined, false)).toBe(0);
  });

  test("sustained failure climbs toward one without reaching it early", () => {
    let rate = nextFailureRate(undefined, true);
    const seen = [rate];
    for (let i = 0; i < 4; i++) {
      rate = nextFailureRate(rate, true);
      seen.push(rate);
    }
    // Strictly increasing, and still below the degrade threshold after two
    // failures — evidence has to accumulate.
    expect(seen[1]).toBeGreaterThan(seen[0] ?? 0);
    expect(seen[1]).toBeLessThan(0.75);
    expect(rate).toBeGreaterThan(0.75);
    expect(rate).toBeLessThanOrEqual(1);
  });

  test("recovery pulls the rate back down", () => {
    let rate = 0.9;
    for (let i = 0; i < 5; i++) rate = nextFailureRate(rate, false);
    expect(rate).toBeLessThan(0.25);
  });

  test("stays inside [0, 1] even with corrupt stored input", () => {
    expect(nextFailureRate(42, true)).toBeLessThanOrEqual(1);
    expect(nextFailureRate(-13, false)).toBeGreaterThanOrEqual(0);
    expect(nextFailureRate(Number.NaN, true)).toBeCloseTo(0.3, 5);
  });
});

describe("nextObservations", () => {
  test("counts up from absent", () => {
    expect(nextObservations(undefined)).toBe(1);
    expect(nextObservations(4)).toBe(5);
  });

  test("treats corrupt stored input as no history", () => {
    expect(nextObservations(Number.NaN)).toBe(1);
    expect(nextObservations(-3)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-observation.test.ts
```

Expected: FAIL — `Cannot find module '@/services/playback/provider-health-observation'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/services/playback/provider-health-observation.ts`:

```ts
/**
 * Provider failure-rate accounting.
 *
 * `recentFailureRate` is an exponentially weighted moving average. It was
 * previously seeded at 1 on a first-ever failure, which made "failed once"
 * numerically identical to "fails every time" — the reason a provider could
 * sit at a reported 100% failure rate after a single bad attempt.
 *
 * Seeding at one step instead means evidence has to accumulate before the
 * rate looks alarming, and `observations` records how much evidence there is
 * so a consumer can refuse to act on a number backed by two samples.
 */

/** Weight retained from prior history on each update. */
export const FAILURE_RATE_DECAY = 0.7;

/** Weight contributed by the newest outcome. */
export const FAILURE_RATE_STEP = 0.3;

function sanitizeRate(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

/**
 * Fold one outcome into the running failure rate.
 * Sustained failure converges on 1; sustained success converges on 0.
 */
export function nextFailureRate(previous: number | undefined, failed: boolean): number {
  const prior = sanitizeRate(previous);
  if (prior === undefined) {
    return failed ? FAILURE_RATE_STEP : 0;
  }
  const raw = prior * FAILURE_RATE_DECAY + (failed ? FAILURE_RATE_STEP : 0);
  return Math.max(0, Math.min(1, raw));
}

/** Count one more recorded outcome. Corrupt history restarts the count. */
export function nextObservations(previous: number | undefined): number {
  if (previous === undefined || !Number.isFinite(previous) || previous < 0) return 1;
  return Math.floor(previous) + 1;
}
```

In `packages/types/src/index.ts`, directly after the `recentFailureRate?: number;` line inside `ProviderHealth`:

```ts
  /**
   * How many outcomes back `recentFailureRate`. A rate derived from one or two
   * attempts is not evidence; consumers gate on this before acting.
   */
  readonly observations?: number;
```

In `packages/schemas/src/index.ts`, directly after the `recentFailureRate` line inside `providerHealthSchema`:

```ts
  observations: z.number().int().nonnegative().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-observation.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run typecheck
```

Expected: PASS, 7 tests, and typecheck clean. `observations` is optional, so no existing object literal breaks.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/types/src/index.ts packages/schemas/src/index.ts apps/cli/src/services/playback/provider-health-observation.ts apps/cli/test/unit/services/playback/provider-health-observation.test.ts
git commit -m "feat(health): give provider failure rate a known denominator"
```

---

### Task 2: Persist the rate through the new helper

`persistProviderHealthDelta` currently inlines the EWMA and never records how many outcomes it has seen.

**Files:**

- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts:764-790` (`persistProviderHealthDelta`)
- Test: `apps/cli/test/unit/services/playback/provider-health-observation.test.ts` (append)

**Interfaces:**

- Consumes: `nextFailureRate`, `nextObservations` from Task 1.
- Produces: no signature change. `persistProviderHealthDelta` stays **synchronous** — see Global Constraints.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/services/playback/provider-health-observation.test.ts`:

```ts
import { PlaybackResolveService } from "@/services/playback/PlaybackResolveService";
import type { ProviderHealth } from "@kunai/types";

describe("persistProviderHealthDelta", () => {
  function makeService() {
    const store = new Map<string, ProviderHealth>();
    const service = new PlaybackResolveService({
      engine: { modules: [] } as never,
      cacheStore: { get: async () => null, set: async () => {}, delete: async () => {} } as never,
      providerHealth: {
        get: (id: string) => store.get(id),
        set: (health: ProviderHealth) => void store.set(health.providerId, health),
      } as never,
    });
    return { service, store };
  }

  test("records how many outcomes back the rate", () => {
    const { service, store } = makeService();
    const persist = (
      service as unknown as {
        persistProviderHealthDelta: (delta: {
          providerId: string;
          outcome: string;
          at: string;
        }) => void;
      }
    ).persistProviderHealthDelta.bind(service);

    persist({ providerId: "vidlink", outcome: "failure", at: new Date().toISOString() });
    expect(store.get("vidlink")?.observations).toBe(1);
    expect(store.get("vidlink")?.recentFailureRate).toBeCloseTo(0.3, 5);

    persist({ providerId: "vidlink", outcome: "failure", at: new Date().toISOString() });
    expect(store.get("vidlink")?.observations).toBe(2);
  });

  test("a single failure no longer reports a total failure rate", () => {
    const { service, store } = makeService();
    const persist = (
      service as unknown as {
        persistProviderHealthDelta: (delta: {
          providerId: string;
          outcome: string;
          at: string;
        }) => void;
      }
    ).persistProviderHealthDelta.bind(service);

    persist({ providerId: "vidlink", outcome: "failure", at: new Date().toISOString() });
    expect(store.get("vidlink")?.recentFailureRate).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-observation.test.ts
```

Expected: FAIL — `observations` is `undefined`, and `recentFailureRate` is `1` from the old inline seed.

- [ ] **Step 3: Write minimal implementation**

In `apps/cli/src/services/playback/PlaybackResolveService.ts`, add to the imports:

```ts
import { nextFailureRate, nextObservations } from "@/services/playback/provider-health-observation";
```

Replace the `recentFailureRate` computation and the `.set()` call inside `persistProviderHealthDelta`:

```ts
const failed = delta.outcome !== "success";
const recentFailureRate = nextFailureRate(existing?.recentFailureRate, failed);
const observations = nextObservations(existing?.observations);
this.deps.providerHealth.set({
  providerId: delta.providerId,
  status,
  checkedAt: delta.at,
  medianResolveMs: delta.resolveMs,
  recentFailureRate,
  observations,
  consecutiveFailures,
  subtitleSuccessRate: undefined,
  streamSurvivalRate: undefined,
});
```

Leave the surrounding `try`/`catch` and the `consecutiveFailures`/`status` lines exactly as they are. Do **not** add an `await` anywhere in this method.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-observation.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/playback/PlaybackResolveService.ts apps/cli/test/unit/services/playback/provider-health-observation.test.ts
git commit -m "feat(health): persist observation count alongside failure rate"
```

---

### Task 3: Let the failure rate affect effective status

`resolveEffectiveStatus` reads only `status` and age, so a provider failing almost every attempt still reports `healthy` as long as its consecutive-failure counter is low. Observed live: vidlink at `recentFailureRate: 1.0`, status `healthy`.

**Files:**

- Modify: `apps/cli/src/services/playback/provider-health-policy.ts:19-57`
- Test: `apps/cli/test/unit/services/playback/provider-health-policy.test.ts` (append; create if absent)

**Interfaces:**

- Consumes: `ProviderHealth.observations` from Task 1.
- Produces:
  - `SUSTAINED_FAILURE_RATE: number` (`0.75`)
  - `MIN_RATE_OBSERVATIONS: number` (`4`)
  - `resolveEffectiveProviderHealth` — unchanged signature, changed result for high-rate providers.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/services/playback/provider-health-policy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { resolveEffectiveProviderHealth } from "@/services/playback/provider-health-policy";
import type { ProviderHealth } from "@kunai/types";

function health(overrides: Partial<ProviderHealth>): ProviderHealth {
  return {
    providerId: "vidlink",
    status: "healthy",
    checkedAt: new Date().toISOString(),
    ...overrides,
  } as ProviderHealth;
}

describe("failure rate feeds effective status", () => {
  test("a provider failing nearly every attempt is not healthy", () => {
    const effective = resolveEffectiveProviderHealth(
      health({ status: "healthy", recentFailureRate: 0.95, observations: 12 }),
    );
    expect(effective?.effectiveStatus).toBe("degraded");
  });

  test("a high rate backed by too little evidence is ignored", () => {
    // One bad attempt must not demote a provider.
    const effective = resolveEffectiveProviderHealth(
      health({ status: "healthy", recentFailureRate: 1, observations: 1 }),
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("legacy rows without an observation count are not demoted", () => {
    // Rows written before observations existed carry the old 1.0 seed.
    const effective = resolveEffectiveProviderHealth(
      health({ status: "healthy", recentFailureRate: 1 }),
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("a healthy rate leaves status alone", () => {
    const effective = resolveEffectiveProviderHealth(
      health({ status: "healthy", recentFailureRate: 0.1, observations: 30 }),
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("rate never promotes a down provider", () => {
    const effective = resolveEffectiveProviderHealth(
      health({ status: "down", recentFailureRate: 0, observations: 30 }),
    );
    expect(effective?.effectiveStatus).toBe("down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-policy.test.ts
```

Expected: FAIL on the first test — `effectiveStatus` is `"healthy"` where `"degraded"` is asserted.

- [ ] **Step 3: Write minimal implementation**

In `apps/cli/src/services/playback/provider-health-policy.ts`, add below `DOWN_TO_HEALTHY_MS`:

```ts
/**
 * Failure rate at or above which a provider is treated as degraded regardless
 * of its consecutive-failure counter. A provider can fail most attempts while
 * never stringing two together, which previously read as fully healthy.
 */
const SUSTAINED_FAILURE_RATE = 0.75;

/**
 * Minimum recorded outcomes before the rate is trusted. Rows written before
 * `observations` existed report `undefined` and are deliberately exempt: they
 * carry a legacy seed of 1 after a single failure and would all demote at once.
 */
const MIN_RATE_OBSERVATIONS = 4;

function hasSustainedFailures(stored: ProviderHealth): boolean {
  const rate = stored.recentFailureRate;
  const observations = stored.observations;
  if (rate === undefined || observations === undefined) return false;
  return observations >= MIN_RATE_OBSERVATIONS && rate >= SUSTAINED_FAILURE_RATE;
}
```

Then, inside `resolveEffectiveProviderHealth`, replace the line computing `effectiveStatus`:

```ts
const agedStatus = resolveEffectiveStatus(stored.status, ageMs);
// A sustained failure rate demotes, but never promotes: a `down` provider
// with a clean rate stays down until its TTL or a real success heals it.
const effectiveStatus =
  agedStatus === "healthy" && hasSustainedFailures(stored) ? "degraded" : agedStatus;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-health-policy.test.ts
```

Expected: PASS, 5 new tests plus any pre-existing ones in the file.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/playback/provider-health-policy.ts apps/cli/test/unit/services/playback/provider-health-policy.test.ts
git commit -m "fix(health): stop reporting healthy at a sustained failure rate"
```

---

### Task 4: Quarantine endpoints under single-title viewing

`resolveQuarantineUntil` quarantines a `server-error` endpoint only after failures across **two distinct titles**. Real viewing hammers one title, so the rule never fires: all eight videasy endpoint rows in the live cache DB carry failures — one at five consecutive — and every one has an empty `quarantinedUntil`.

The two-distinct-titles rule stays: it is the fast path that protects against one title's quirk. A consecutive-failure threshold is added beside it so repeated failure on a single title is also treated as evidence.

**Files:**

- Modify: `apps/cli/src/services/playback/ProviderEndpointHealthService.ts:75-80` and `:142-155`
- Test: `apps/cli/test/unit/services/playback/provider-endpoint-health.test.ts` (append; create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: `SINGLE_TITLE_QUARANTINE_FAILURES: number` (`3`). `recordFailure` keeps its signature.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/services/playback/provider-endpoint-health.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { ProviderEndpointHealthService } from "@/services/playback/ProviderEndpointHealthService";
import type { ProviderEndpointHealthRecord } from "@kunai/types";

function makeService() {
  const rows = new Map<string, ProviderEndpointHealthRecord>();
  const key = (p: string, e: string) => `${p}::${e}`;
  const service = new ProviderEndpointHealthService({
    get: (p: string, e: string) => rows.get(key(p, e)),
    set: (record: ProviderEndpointHealthRecord) =>
      void rows.set(key(record.providerId, record.endpoint), record),
    delete: (p: string, e: string) => void rows.delete(key(p, e)),
    isQuarantined: () => false,
  } as never);
  return { service, rows, key };
}

describe("endpoint quarantine under single-title viewing", () => {
  test("repeated failures on one title eventually quarantine", () => {
    const { service, rows, key } = makeService();
    const at = new Date().toISOString();

    for (let i = 0; i < 3; i++) {
      service.recordFailure("videasy", "wings-meine", {
        class: "server-error",
        titleId: "125988",
        at,
      });
    }

    const record = rows.get(key("videasy", "wings-meine"));
    expect(record?.consecutiveFailures).toBe(3);
    expect(record?.distinctTitleIds).toEqual(["125988"]);
    // This is the case that never fired before.
    expect(record?.quarantinedUntil).toBeTruthy();
  });

  test("one failure on one title does not quarantine", () => {
    const { service, rows, key } = makeService();
    service.recordFailure("videasy", "wings-cdn", {
      class: "server-error",
      titleId: "69740",
      at: new Date().toISOString(),
    });
    expect(rows.get(key("videasy", "wings-cdn"))?.quarantinedUntil).toBeUndefined();
  });

  test("two distinct titles still quarantine immediately", () => {
    const { service, rows, key } = makeService();
    const at = new Date().toISOString();
    service.recordFailure("videasy", "meine", { class: "server-error", titleId: "a", at });
    service.recordFailure("videasy", "meine", { class: "server-error", titleId: "b", at });
    expect(rows.get(key("videasy", "meine"))?.quarantinedUntil).toBeTruthy();
  });

  test("transient failures never persist a quarantine", () => {
    const { service, rows, key } = makeService();
    const at = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      service.recordFailure("videasy", "cdn", { class: "transient", titleId: "x", at });
    }
    expect(rows.get(key("videasy", "cdn"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-endpoint-health.test.ts
```

Expected: FAIL on the first test — `quarantinedUntil` is `undefined` because only one distinct title id was seen.

- [ ] **Step 3: Write minimal implementation**

In `apps/cli/src/services/playback/ProviderEndpointHealthService.ts`, add beside the existing quarantine constants:

```ts
/**
 * Consecutive `server-error` failures on a single endpoint that justify a
 * quarantine on their own. The two-distinct-titles rule exists to avoid
 * blacklisting an endpoint over one title's quirk, but normal viewing stays on
 * one title, so that rule alone never fired in practice.
 */
const SINGLE_TITLE_QUARANTINE_FAILURES = 3;
```

Change the `resolveQuarantineUntil` signature and its `server-error` branch:

```ts
function resolveQuarantineUntil(input: {
  readonly failureClass: EndpointHealthFailureClass;
  readonly distinctTitleIds: readonly string[];
  readonly consecutiveFailures: number;
  readonly now: Date;
}): string | undefined {
  if (input.failureClass === "route-dead") {
    return new Date(input.now.getTime() + ROUTE_DEAD_QUARANTINE_MS).toISOString();
  }

  if (
    input.failureClass === "server-error" &&
    (input.distinctTitleIds.length >= 2 ||
      input.consecutiveFailures >= SINGLE_TITLE_QUARANTINE_FAILURES)
  ) {
    return new Date(input.now.getTime() + SERVER_ERROR_QUARANTINE_MS).toISOString();
  }

  return undefined;
}
```

Then pass the counter at the call site in `recordFailure` (~line 75). `consecutiveFailures` is already computed above it:

```ts
const quarantinedUntil = resolveQuarantineUntil({
  failureClass: info.class,
  distinctTitleIds,
  consecutiveFailures,
  now,
});
```

Leave the `transient` early-return above untouched — transient failures must stay in-memory only.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-endpoint-health.test.ts
```

Expected: PASS, 4 new tests plus any pre-existing ones.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/playback/ProviderEndpointHealthService.ts apps/cli/test/unit/services/playback/provider-endpoint-health.test.ts
git commit -m "fix(providers): quarantine dead endpoints under single-title viewing"
```

---

### Task 5: Wire the resolve trace sink

`ResolveTraceRepository` is exported from `@kunai/storage` and constructed only in tests, so `resolve_traces` is permanently empty and the diagnostics panel reports "no resolve telemetry yet". This task gives it an owner and a construction site. Emission call sites are Task 6.

**Files:**

- Create: `apps/cli/src/services/diagnostics/ResolveTraceSink.ts`
- Modify: `apps/cli/src/container/bootstrap-persistence.ts` (~line 276 construction, ~line 126 exported type)
- Test: `apps/cli/test/unit/services/diagnostics/resolve-trace-sink.test.ts`

**Interfaces:**

- Consumes: `ResolveTraceRepository` from `@kunai/storage`.
- Produces:
  - `class ResolveTraceSink` with `record(trace: ResolveTrace): void` and `listRecent(limit?: number): readonly ResolveTrace[]`
  - `PersistenceBootstrap.resolveTraceSink: ResolveTraceSink`

  Task 6 calls `record`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/diagnostics/resolve-trace-sink.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { ResolveTraceSink } from "@/services/diagnostics/ResolveTraceSink";
import type { ResolveTrace } from "@kunai/types";

function trace(id: string): ResolveTrace {
  return {
    id,
    startedAt: new Date().toISOString(),
    title: { id: "1", kind: "movie", title: "Fight Club" },
    cacheHit: false,
    steps: [],
    failures: [],
  } as ResolveTrace;
}

describe("ResolveTraceSink", () => {
  test("records a trace through the repository", () => {
    const added: ResolveTrace[] = [];
    const sink = new ResolveTraceSink({
      add: (t: ResolveTrace) => void added.push(t),
      listRecent: () => [],
    } as never);

    sink.record(trace("resolve-1"));
    expect(added).toHaveLength(1);
    expect(added[0]?.id).toBe("resolve-1");
  });

  test("a storage fault never escapes — a resolve must not fail on telemetry", () => {
    const sink = new ResolveTraceSink({
      add: () => {
        throw new Error("database is locked");
      },
      listRecent: () => [],
    } as never);

    expect(() => sink.record(trace("resolve-2"))).not.toThrow();
  });

  test("a read fault degrades to an empty list", () => {
    const sink = new ResolveTraceSink({
      add: () => {},
      listRecent: () => {
        throw new Error("disk full");
      },
    } as never);

    expect(sink.listRecent()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/diagnostics/resolve-trace-sink.test.ts
```

Expected: FAIL — `Cannot find module '@/services/diagnostics/ResolveTraceSink'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/services/diagnostics/ResolveTraceSink.ts`:

```ts
import type { ResolveTraceRepository } from "@kunai/storage";
import type { ResolveTrace } from "@kunai/types";

/**
 * Local-only resolve diagnostics.
 *
 * Traces carry title ids, endpoints, and failure detail — everything needed to
 * explain a slow or failed resolve, and everything the opt-in analytics wire
 * format deliberately cannot represent. They are written to the cache database
 * and **never leave the machine**.
 *
 * Retention is owned by `packages/storage/src/maintenance.ts`; this class adds
 * no second policy. Every call is best-effort: telemetry must never be able to
 * fail a playback.
 */
export class ResolveTraceSink {
  constructor(private readonly repository: ResolveTraceRepository) {}

  record(trace: ResolveTrace): void {
    try {
      this.repository.add(trace);
    } catch {
      // Diagnostics are best-effort; playback already succeeded or failed on
      // its own merits and must not inherit a storage fault.
    }
  }

  listRecent(limit = 20): readonly ResolveTrace[] {
    try {
      return this.repository.listRecent(limit);
    } catch {
      return [];
    }
  }
}
```

In `apps/cli/src/container/bootstrap-persistence.ts`, add `ResolveTraceRepository` to the existing `@kunai/storage` import, add the `ResolveTraceSink` import, then construct it next to `sourceInventory` (~line 276):

```ts
const resolveTraceSink = new ResolveTraceSink(new ResolveTraceRepository(cacheDb));
```

Add it to the `PersistenceBootstrap` type beside `sourceInventory` (~line 126):

```ts
  readonly resolveTraceSink: ResolveTraceSink;
```

And add `resolveTraceSink` to the object this function returns, beside `sourceInventory`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/diagnostics/resolve-trace-sink.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run typecheck
```

Expected: PASS, 3 tests, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/diagnostics/ResolveTraceSink.ts apps/cli/src/container/bootstrap-persistence.ts apps/cli/test/unit/services/diagnostics/resolve-trace-sink.test.ts
git commit -m "feat(diagnostics): own local resolve trace persistence"
```

---

### Task 6: Persist the trace the resolve already builds

`PlaybackPhase.ts:1395` builds a `ResolveTrace` via `createResolveTraceStub`, passes it as `context.trace`, and drops it. This task completes it and writes it.

**Files:**

- Modify: `apps/cli/src/app/playback/resolve-trace.ts` (append)
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts:1395-1410`
- Test: `apps/cli/test/unit/app/resolve-trace.test.ts`

**Interfaces:**

- Consumes: `ResolveTraceSink.record` from Task 5; `createResolveTraceStub` (existing).
- Produces: `finalizeResolveTrace(trace: ResolveTrace, outcome: { endedAt: string; selectedProviderId?: string; selectedStreamId?: string; cacheHit: boolean; failures: readonly ProviderFailure[] }): ResolveTrace`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app/resolve-trace.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { createResolveTraceStub, finalizeResolveTrace } from "@/app/playback/resolve-trace";

const title = { id: "550", name: "Fight Club", type: "movie", year: "1999" } as never;

describe("finalizeResolveTrace", () => {
  test("stamps the outcome onto the started trace", () => {
    const started = createResolveTraceStub({
      title,
      providerId: "videasy",
      mode: "movie" as never,
    });
    const endedAt = new Date().toISOString();

    const finished = finalizeResolveTrace(started, {
      endedAt,
      selectedProviderId: "videasy",
      selectedStreamId: "stream-1",
      cacheHit: false,
      failures: [],
    });

    expect(finished.id).toBe(started.id);
    expect(finished.endedAt).toBe(endedAt);
    expect(finished.selectedStreamId).toBe("stream-1");
    expect(finished.cacheHit).toBe(false);
  });

  test("keeps the failures that explain a fallback", () => {
    const started = createResolveTraceStub({
      title,
      providerId: "videasy",
      mode: "movie" as never,
    });
    const failures = [
      {
        providerId: "videasy",
        code: "timeout",
        message: "candidate timed out",
        retryable: false,
        at: new Date().toISOString(),
      },
    ] as never;

    const finished = finalizeResolveTrace(started, {
      endedAt: new Date().toISOString(),
      selectedProviderId: "vidlink",
      cacheHit: false,
      failures,
    });

    expect(finished.failures).toHaveLength(1);
    // The provider that actually won, not the one first attempted.
    expect(finished.selectedProviderId).toBe("vidlink");
  });

  test("does not mutate the trace it was given", () => {
    const started = createResolveTraceStub({
      title,
      providerId: "videasy",
      mode: "movie" as never,
    });
    finalizeResolveTrace(started, {
      endedAt: new Date().toISOString(),
      cacheHit: true,
      failures: [],
    });
    expect(started.endedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app/resolve-trace.test.ts
```

Expected: FAIL — `finalizeResolveTrace` is not exported from `@/app/playback/resolve-trace`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/cli/src/app/playback/resolve-trace.ts`:

```ts
/**
 * Stamp the outcome onto a trace started by `createResolveTraceStub`.
 *
 * Returns a new object; the input is never mutated, so a caller holding the
 * started trace for its id keeps a stable value.
 */
export function finalizeResolveTrace(
  trace: ResolveTrace,
  outcome: {
    readonly endedAt: string;
    readonly selectedProviderId?: string;
    readonly selectedStreamId?: string;
    readonly cacheHit: boolean;
    readonly failures: readonly ProviderFailure[];
  },
): ResolveTrace {
  return {
    ...trace,
    endedAt: outcome.endedAt,
    selectedProviderId: (outcome.selectedProviderId ?? trace.selectedProviderId) as
      ProviderId | undefined,
    selectedStreamId: outcome.selectedStreamId ?? trace.selectedStreamId,
    cacheHit: outcome.cacheHit,
    failures: outcome.failures,
  };
}
```

Add `ProviderFailure` to the existing type import at the top of that file.

In `apps/cli/src/app/playback/PlaybackPhase.ts`, import `finalizeResolveTrace` alongside the existing `createResolveTraceStub` import.

The insertion point is **line 1754**, the statement `if (stream) recordStartupMark("resolve-complete", stream);`. This is the single convergence point every resolve path reaches — prefetch (`:1393`), recent-stream reuse (`:1500`), and fresh/fallback resolve (`:1692`) all flow through it, so recording here captures each one exactly once.

Insert immediately **after** that line:

```ts
// Record the trace at the one point every resolve path converges on.
// `resolveAttempts` is empty for prefetch and cache hits, which is
// itself the useful signal: a trace with no attempts means nothing
// was resolved live.
container.resolveTraceSink.record(
  finalizeResolveTrace(resolveTrace, {
    endedAt: new Date().toISOString(),
    selectedProviderId: resolvedProviderId ?? currentProvider.metadata.id,
    selectedStreamId: stream?.providerResolveResult?.streams?.[0]?.id,
    cacheHit: streamProvenance === "cache",
    failures: resolveAttempts
      .map((attempt) => attempt.failure)
      .filter((failure): failure is ProviderFailure => failure !== undefined),
  }),
);
```

`ResolveAttempt` is `{ providerId, stream, result?, failure? }` (`packages/core/src/resolver.ts:9`), so `attempt.failure` is the correct field and the type guard is required — the repo forbids non-null assertions. Add `ProviderFailure` to the existing `@kunai/types` import in this file if it is not already there.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/app/resolve-trace.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run typecheck
```

Expected: PASS, 3 tests, typecheck clean.

- [ ] **Step 5: Verify traces actually land**

```bash
cd "$(git rev-parse --show-toplevel)"
cp ~/.cache/kunai/kunai-cache.sqlite /tmp/kunai-shadow-verify.sqlite
sqlite3 /tmp/kunai-shadow-verify.sqlite "select count(*) from resolve_traces;"
```

Run one playback via `bun run dev`, then re-copy and re-count. The count must increase. **Copy before querying — never query the live database directly.**

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/app/playback/resolve-trace.ts apps/cli/src/app/playback/PlaybackPhase.ts apps/cli/test/unit/app/resolve-trace.test.ts
git commit -m "feat(diagnostics): persist resolve traces instead of discarding them"
```

---

### Task 7: Document the contract and verify the repo

**Files:**

- Modify: `.docs/diagnostics-guide.md` (resolve diagnostics section)
- Modify: `.docs/providers.md` (endpoint quarantine section, ~line 100)

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: nothing consumed later.

- [ ] **Step 1: Update the docs**

In `.docs/providers.md`, in the "Endpoint quarantine (dead mirrors)" section, replace the `server-error` row description so it states both triggers:

```markdown
- **server-error** (persistent 5xx): quarantine ~1h, triggered by failures across
  ≥2 distinct titles **or** ≥3 consecutive failures on a single title. The
  single-title trigger exists because normal viewing stays on one title, so the
  distinct-title rule alone never fired in practice.
```

In `.docs/diagnostics-guide.md`, add to the resolve diagnostics section:

```markdown
Resolve traces are written to `resolve_traces` in the cache database and
**never leave the machine**. They carry title ids, endpoints, and failure
detail so a slow resolve can be explained after the fact. This is separate
from opt-in product analytics, whose wire format deliberately cannot represent
any of those fields. Retention is handled by the shared storage maintenance
pass; traces are short-lived debugging evidence, not an archive.

`recentFailureRate` is an EWMA over recent outcomes, paired with an
`observations` count. A provider is demoted to `degraded` at a rate of 0.75 or
above once at least 4 outcomes back it, so one bad attempt cannot demote a
working provider.
```

- [ ] **Step 2: Run full verification**

```bash
cd "$(git rev-parse --show-toplevel)"
bun run typecheck && bun run lint && bun run test
```

Expected: all three pass. Note the pre-existing lint warning in `apps/cli/src/app-shell/poster-renderer.ts` (`ImageCapability` imported but never used) — that is unrelated to this plan; leave it.

- [ ] **Step 3: Format**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run fmt
```

- [ ] **Step 4: Verify the diff**

```bash
cd "$(git rev-parse --show-toplevel)" && git status --short && git diff
```

Expected: only formatting changes, if any. Confirm no unrelated file was staged.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add .docs/providers.md .docs/diagnostics-guide.md
git commit -m "docs(providers): document trace persistence and quarantine triggers"
```

---

## Verification

Complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, `bun run test` pass from the repo root.
- `resolve_traces` is non-empty after a real playback, verified on a **copy** of the cache DB.
- A provider with `recentFailureRate >= 0.75` and `observations >= 4` reports `degraded`, not `healthy`.
- A provider with `recentFailureRate: 1` and `observations: 1` still reports `healthy`.
- Legacy rows lacking `observations` are not demoted.
- Three consecutive `server-error` failures on one endpoint for one title set `quarantinedUntil`.
- `transient` failures still persist nothing.
- `persistProviderHealthDelta` contains no `await`.

## Out of scope

Deferred to later plans, listed so no one implements them here:

- Candidate-level racing inside `runProviderCycle` (spec §5.1) — its own plan; needs the traced baseline this plan produces
- Aggregating `winnerWasHedged` to decide whether hedging stays on by default (spec §4.3, §8 gate 2) — the aggregation is only possible once this plan's traces exist, so it is the natural follow-up, not part of this work
- Background shadow probing of `down` providers (spec §5.2)
- Latency-aware ordering from `medianResolveMs` (spec §5.3)
- The `AnalyticsEvent` projection (spec §3, telemetry Phase 5)
- Provider manifest capability corrections (spec §6)
- The diagnostics dashboard redesign
