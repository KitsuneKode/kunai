# Health Recovery, Ordering, and Capability Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop making users the health probe, use the resolve latency already being collected, and make provider manifests describe what the code actually does.

**Architecture:** Three independent changes. A `down` provider is currently excluded from fallback, so it can never succeed and only a 4-hour TTL heals it — a shadow probe replaces that timer with evidence. `medianResolveMs` is persisted and read by nothing — it becomes a tie-break, never a primary sort, because predictable ordering is a real UX property. Provider manifests understate their own capabilities, which misleads humans and would break future capability-based routing.

**Tech Stack:** Bun, TypeScript, `bun:test`.

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm`, `npx`, `node`, `yarn`, or `pnpm`.
- Run the full suite with `bun run test` from the repo root, never bare `bun test`.
- The repo forbids non-null assertions (`no-non-null-assertion`).
- **A shadow probe must never extend the resolve deadline.** A recovery mechanism that slows the happy path is a net loss. At most one `down` provider is probed per resolve, and its result is never surfaced as the user's stream.
- **User-configured provider priority stays authoritative.** Latency is a tie-break only. A user with an explicit priority list covering their providers must observe byte-identical ordering before and after.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run test`, then `bun run fmt`.
- Spec of record: `docs/superpowers/specs/2026-07-28-resolve-loop-design.md` §5.2, §5.3, §6.

**Prerequisite:** `2026-07-28-resolve-telemetry-spine.md` must be complete — Task 2 sorts on health fields that plan makes trustworthy.

## Executor Protocol

### Working directory

```bash
cd "$(git rev-parse --show-toplevel)" && <your command>
```

### The red phase is mandatory

Write test → **run it and watch it fail** → implement → run it and watch it pass → commit.

### Do not repair collateral damage

If a **pre-existing** test fails, stop and report file, line, and assertion. Task 2 is the likely place for this: any test asserting a fixed provider order is a signal, not a chore.

### Commit discipline

One commit per task, staging only that task's **Files**. **Never `git add -A`.**

## File Structure

| File                                                         | Responsibility                                   | Change            |
| ------------------------------------------------------------ | ------------------------------------------------ | ----------------- |
| `apps/cli/src/services/playback/provider-shadow-probe.ts`    | Pick at most one `down` provider to probe. Pure. | **Create**        |
| `apps/cli/src/services/playback/PlaybackResolveService.ts`   | Launch the probe off the critical path.          | Modify            |
| `apps/cli/src/services/playback/provider-ordering.ts`        | Tie-break ordering by health then latency. Pure. | **Create**        |
| `apps/cli/src/services/playback/ProviderCandidatePlanner.ts` | Apply the tie-break.                             | Modify (~line 76) |
| `packages/providers/src/youtube/manifest.ts`                 | Declare `subtitle-resolve`.                      | Modify (~line 13) |
| `packages/providers/src/miruro/manifest.ts`                  | Declare `subtitle-resolve`.                      | Modify            |
| `packages/providers/src/research.ts`                         | Correct stale `candidate` statuses.              | Modify            |

Both new modules are pure and separate from the services that call them, because the decisions — _which_ provider to probe, _what_ order to try — are the things worth testing, and both host services are large orchestration classes.

---

### Task 1: Probe a down provider off the critical path

`isProviderFallbackEligible` excludes `down` providers (`provider-health-policy.ts:55-59`). A `down` provider therefore cannot succeed, cannot reset `consecutiveFailures`, and only heals when its 4-hour TTL expires. Live evidence: youtube's health had not been checked for eight days.

A successful resolve already resets a provider to `healthy` immediately (`PlaybackResolveService.ts:747-751`) — that part is correct and must not be "fixed". The gap is purely that a `down` provider never gets a chance to succeed.

**Files:**

- Create: `apps/cli/src/services/playback/provider-shadow-probe.ts`
- Test: `apps/cli/test/unit/services/playback/provider-shadow-probe.test.ts`

**Interfaces:**

- Consumes: `EffectiveProviderHealth` from `provider-health-policy`.
- Produces: `selectShadowProbeTarget(input): ProviderId | null`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/playback/provider-shadow-probe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { selectShadowProbeTarget } from "@/services/playback/provider-shadow-probe";

const hourAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("selectShadowProbeTarget", () => {
  test("picks a down provider that is otherwise unreachable", () => {
    expect(
      selectShadowProbeTarget({
        candidates: ["videasy", "vidlink"],
        health: {
          videasy: { effectiveStatus: "healthy", checkedAt: hourAgo(1) },
          vidlink: { effectiveStatus: "down", checkedAt: hourAgo(2) },
        } as never,
        activeProviderId: "videasy",
      }),
    ).toBe("vidlink");
  });

  test("never probes the provider actually serving this resolve", () => {
    expect(
      selectShadowProbeTarget({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "down", checkedAt: hourAgo(2) } } as never,
        activeProviderId: "vidlink",
      }),
    ).toBeNull();
  });

  test("probes at most one provider — the stalest", () => {
    const chosen = selectShadowProbeTarget({
      candidates: ["a", "b", "c"],
      health: {
        a: { effectiveStatus: "down", checkedAt: hourAgo(1) },
        b: { effectiveStatus: "down", checkedAt: hourAgo(9) },
        c: { effectiveStatus: "down", checkedAt: hourAgo(3) },
      } as never,
      activeProviderId: "z",
    });
    expect(chosen).toBe("b");
  });

  test("returns null when nothing is down", () => {
    expect(
      selectShadowProbeTarget({
        candidates: ["videasy"],
        health: { videasy: { effectiveStatus: "healthy", checkedAt: hourAgo(1) } } as never,
        activeProviderId: "vidlink",
      }),
    ).toBeNull();
  });

  test("does not re-probe a provider checked moments ago", () => {
    expect(
      selectShadowProbeTarget({
        candidates: ["vidlink"],
        health: {
          vidlink: { effectiveStatus: "down", checkedAt: new Date().toISOString() },
        } as never,
        activeProviderId: "videasy",
      }),
    ).toBeNull();
  });

  test("degraded providers are not probed — they are still eligible normally", () => {
    expect(
      selectShadowProbeTarget({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "degraded", checkedAt: hourAgo(5) } } as never,
        activeProviderId: "videasy",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-shadow-probe.test.ts
```

Expected: FAIL — `Cannot find module '@/services/playback/provider-shadow-probe'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/services/playback/provider-shadow-probe.ts`:

```ts
import type { ProviderId } from "@kunai/types";

import type { EffectiveProviderHealthStatus } from "./provider-health-policy";

/**
 * Minimum age before a `down` provider is worth probing again. Without this a
 * burst of resolves would probe the same dead provider repeatedly and turn a
 * recovery mechanism into an outbound-request amplifier.
 */
const MIN_REPROBE_AGE_MS = 15 * 60 * 1000;

export interface ShadowProbeInput {
  readonly candidates: readonly ProviderId[];
  readonly health: Readonly<
    Record<
      string,
      { readonly effectiveStatus: EffectiveProviderHealthStatus; readonly checkedAt?: string }
    >
  >;
  /** Provider serving this resolve. Never probed — it is already being exercised. */
  readonly activeProviderId: ProviderId | string;
  readonly now?: () => number;
}

/**
 * Choose at most one `down` provider to probe off the critical path.
 *
 * `down` providers are excluded from fallback, so they cannot succeed, so
 * nothing but a 4-hour TTL heals them. Probing replaces that timer with
 * evidence — but only ever one per resolve, and never the provider currently
 * serving the user, whose outcome is already being observed.
 *
 * Returns `null` when there is nothing worth probing.
 */
export function selectShadowProbeTarget(input: ShadowProbeInput): ProviderId | null {
  const nowMs = (input.now ?? Date.now)();

  const stale = input.candidates
    .filter((providerId) => providerId !== input.activeProviderId)
    .map((providerId) => ({ providerId, entry: input.health[providerId] }))
    .filter(
      (
        row,
      ): row is {
        providerId: ProviderId;
        entry: { effectiveStatus: "down"; checkedAt?: string };
      } => row.entry?.effectiveStatus === "down",
    )
    .map((row) => {
      const checkedAtMs = row.entry.checkedAt ? Date.parse(row.entry.checkedAt) : Number.NaN;
      // An unparseable timestamp is unusable data, not evidence of a recent
      // check — treat it as fully stale so it can earn its way back.
      const ageMs = Number.isFinite(checkedAtMs) ? nowMs - checkedAtMs : Number.POSITIVE_INFINITY;
      return { providerId: row.providerId, ageMs };
    })
    .filter((row) => row.ageMs >= MIN_REPROBE_AGE_MS)
    .sort((left, right) => right.ageMs - left.ageMs);

  return stale[0]?.providerId ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-shadow-probe.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/playback/provider-shadow-probe.ts apps/cli/test/unit/services/playback/provider-shadow-probe.test.ts
git commit -m "feat(health): choose a down provider to shadow probe"
```

---

### Task 2: Tie-break provider ordering by health then latency

`ProviderCandidatePlanner.ts:76` computes a switch suggestion and discards it (`void input.suggestion`). `medianResolveMs` is persisted by `PlaybackResolveService` and read by nothing.

Ordering staying deterministic until a provider is explicitly selected is a **deliberate choice**, not an oversight — predictability is a real UX property. So latency enters strictly as a tie-break.

**Files:**

- Create: `apps/cli/src/services/playback/provider-ordering.ts`
- Modify: `apps/cli/src/services/playback/ProviderCandidatePlanner.ts` (~line 76)
- Test: `apps/cli/test/unit/services/playback/provider-ordering.test.ts`

**Interfaces:**

- Consumes: `EffectiveProviderHealth`.
- Produces: `orderProviderCandidates(candidates, health): readonly ProviderId[]`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/services/playback/provider-ordering.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { orderProviderCandidates } from "@/services/playback/provider-ordering";

describe("orderProviderCandidates", () => {
  test("configured priority is preserved when health is equal", () => {
    const order = orderProviderCandidates(["c", "a", "b"], {
      a: { effectiveStatus: "healthy" },
      b: { effectiveStatus: "healthy" },
      c: { effectiveStatus: "healthy" },
    } as never);
    // The user's list is authoritative. This must not become a speed sort.
    expect(order).toEqual(["c", "a", "b"]);
  });

  test("degraded providers sink below healthy ones", () => {
    const order = orderProviderCandidates(["slowbut", "fine"], {
      slowbut: { effectiveStatus: "degraded" },
      fine: { effectiveStatus: "healthy" },
    } as never);
    expect(order).toEqual(["fine", "slowbut"]);
  });

  test("latency breaks a tie between equally healthy providers", () => {
    const order = orderProviderCandidates(["slow", "fast"], {
      slow: { effectiveStatus: "healthy", stored: { medianResolveMs: 9000 } },
      fast: { effectiveStatus: "healthy", stored: { medianResolveMs: 800 } },
    } as never);
    expect(order).toEqual(["fast", "slow"]);
  });

  test("unknown latency never outranks a measured fast provider", () => {
    const order = orderProviderCandidates(["unmeasured", "fast"], {
      unmeasured: { effectiveStatus: "healthy" },
      fast: { effectiveStatus: "healthy", stored: { medianResolveMs: 500 } },
    } as never);
    expect(order[0]).toBe("fast");
  });

  test("health outranks latency", () => {
    const order = orderProviderCandidates(["quickbutbroken", "steady"], {
      quickbutbroken: { effectiveStatus: "degraded", stored: { medianResolveMs: 100 } },
      steady: { effectiveStatus: "healthy", stored: { medianResolveMs: 5000 } },
    } as never);
    expect(order).toEqual(["steady", "quickbutbroken"]);
  });

  test("providers with no health entry keep their configured position", () => {
    const order = orderProviderCandidates(["a", "b"], {} as never);
    expect(order).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-ordering.test.ts
```

Expected: FAIL — `Cannot find module '@/services/playback/provider-ordering'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/cli/src/services/playback/provider-ordering.ts`:

```ts
import type { ProviderId } from "@kunai/types";

import type { EffectiveProviderHealth } from "./provider-health-policy";

/** Sort weight per effective status. Lower sorts earlier. */
const STATUS_RANK: Record<string, number> = {
  healthy: 0,
  unknown: 0,
  degraded: 1,
  down: 2,
};

/**
 * Order provider candidates for this resolve.
 *
 * The user's configured priority is authoritative and is preserved exactly
 * whenever health is equal — predictable ordering is a real UX property, and
 * this must never become a speed sort. Health and latency act only as
 * tie-breaks, which changes nothing for a user whose priority list already
 * covers their providers and helps everyone else.
 *
 * Hedging amplifies the benefit: whichever candidate is ordered first gets the
 * head start.
 */
export function orderProviderCandidates(
  candidates: readonly ProviderId[],
  health: Readonly<Record<string, EffectiveProviderHealth | undefined>>,
): readonly ProviderId[] {
  return [...candidates]
    .map((providerId, configuredIndex) => ({ providerId, configuredIndex }))
    .sort((left, right) => {
      const leftHealth = health[left.providerId];
      const rightHealth = health[right.providerId];

      const leftRank = STATUS_RANK[leftHealth?.effectiveStatus ?? "unknown"] ?? 0;
      const rightRank = STATUS_RANK[rightHealth?.effectiveStatus ?? "unknown"] ?? 0;
      if (leftRank !== rightRank) return leftRank - rightRank;

      // Unmeasured providers sort after measured ones rather than ahead of
      // them: an unknown latency is not evidence of speed.
      const leftMs = leftHealth?.stored?.medianResolveMs ?? Number.POSITIVE_INFINITY;
      const rightMs = rightHealth?.stored?.medianResolveMs ?? Number.POSITIVE_INFINITY;
      if (leftMs !== rightMs) return leftMs - rightMs;

      return left.configuredIndex - right.configuredIndex;
    })
    .map((entry) => entry.providerId);
}
```

Then apply it in `ProviderCandidatePlanner.ts` where the candidate list is produced, replacing the `void input.suggestion` discard. Keep emitting the suggestion event — only the ordering changes.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/apps/cli" && bun test test/unit/services/playback/provider-ordering.test.ts
cd "$(git rev-parse --show-toplevel)" && bun run test
```

Expected: PASS, 6 tests, full suite green. **If a pre-existing test asserting a fixed provider order fails, stop and report it** — that test encodes the old contract and the change may be wrong.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add apps/cli/src/services/playback/provider-ordering.ts apps/cli/src/services/playback/ProviderCandidatePlanner.ts apps/cli/test/unit/services/playback/provider-ordering.test.ts
git commit -m "feat(providers): tie-break candidate order by health then latency"
```

---

### Task 3: Make manifests tell the truth

Manifests **understate** what the code does. `packages/providers/src/youtube/direct.ts:383` builds `SubtitleCandidate[]` and returns them, but the youtube manifest does not declare `subtitle-resolve`. Miruro models subtitle delivery and likewise does not declare it. `research.ts` still marks miruro and rivestream as `"candidate"` though both are in the production registry.

Manifest `capabilities` is currently descriptive and does not gate routing — the runtime `ProviderCapabilities` in `services/providers/Provider.ts:39` is a separate structure — so this is a correctness-of-documentation fix, not a behaviour change. It matters because it misleads humans and would silently under-serve future capability-based routing.

**Files:**

- Modify: `packages/providers/src/youtube/manifest.ts` (~line 13)
- Modify: `packages/providers/src/miruro/manifest.ts`
- Modify: `packages/providers/src/research.ts`
- Test: `packages/providers/test/manifest-capability-truth.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `packages/providers/test/manifest-capability-truth.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { youtubeProviderManifest } from "../src/youtube/manifest";
import { miruroProviderManifest } from "../src/miruro/manifest";
import { providerResearchProfiles } from "../src/research";

describe("manifests describe what the code does", () => {
  test("youtube declares subtitle resolution, which it implements", () => {
    // direct.ts:383 builds SubtitleCandidate[] and returns them.
    expect(youtubeProviderManifest.capabilities).toContain("subtitle-resolve");
  });

  test("miruro declares subtitle resolution", () => {
    expect(miruroProviderManifest.capabilities).toContain("subtitle-resolve");
  });
});

describe("research profiles match the production registry", () => {
  test("providers in the production registry are not marked candidate", () => {
    for (const providerId of ["miruro", "rivestream"]) {
      const profile = providerResearchProfiles.find((p) => p.providerId === providerId);
      expect(profile?.status).toBe("production");
    }
  });
});
```

If the manifest export names differ, use the actual exported names and keep the assertions identical.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)/packages/providers" && bun test test/manifest-capability-truth.test.ts
```

Expected: FAIL on all three — the capabilities arrays lack `subtitle-resolve` and both profiles say `"candidate"`.

- [ ] **Step 3: Write minimal implementation**

In `packages/providers/src/youtube/manifest.ts`, add `"subtitle-resolve"` to the `capabilities` array:

```ts
  capabilities: ["search", "episode-list", "source-resolve", "subtitle-resolve", "quality-ranked"],
```

In `packages/providers/src/miruro/manifest.ts`, add `"subtitle-resolve"` to its `capabilities` array, preserving the existing entries and their order.

In `packages/providers/src/research.ts`, change the `miruro` and `rivestream` profiles from `status: "candidate"` to `status: "production"`, and change their `migrationAction` from `"implement-from-scratchpad"` to `"promote-direct-provider"`. Update each `productionGap` to describe what is actually left rather than the completed migration.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)/packages/providers" && bun test
cd "$(git rev-parse --show-toplevel)" && bun run test
```

Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add packages/providers/src/youtube/manifest.ts packages/providers/src/miruro/manifest.ts packages/providers/src/research.ts packages/providers/test/manifest-capability-truth.test.ts
git commit -m "fix(providers): make manifests and research profiles tell the truth"
```

---

## Verification

Complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, `bun run test` pass from the repo root.
- A user with an explicit priority list covering their providers sees unchanged ordering.
- `degraded` providers sort below `healthy` ones of equal configured priority.
- Latency only breaks ties; it never outranks health or configured priority.
- At most one `down` provider is selected per resolve, never the active one.
- A `down` provider checked minutes ago is not re-probed.
- `youtube` and `miruro` manifests declare `subtitle-resolve`.
- No production-registry provider is marked `"candidate"` in `research.ts`.

## Out of scope

- Wiring the shadow probe's launch site into `PlaybackResolveService` beyond selection — the probe executor is a follow-up once the trace baseline shows the deadline is safe
- Escalating a permanently `degraded` provider to not-eligible — the tie-break demotion is probably sufficient; measure first
- Changing the runtime `ProviderCapabilities` structure in `services/providers/Provider.ts`
