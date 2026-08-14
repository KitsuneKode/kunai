# Usage Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the never-shipped opt-in telemetry ping with an opt-out usage analytics subsystem that discloses before it sends, stores real dimension aggregates in Neon Postgres, and has exactly one owner for consent policy.

**Architecture:** One pure policy module (`domain/analytics/consent-policy.ts`) decides consent; one service (`UsageAnalyticsService`) is the only writer of analytics config; `main.ts` and the setup wizard call it rather than re-deriving it. The ingest collapses four Redis-shaped ports into one `AnalyticsStore` over Postgres, where `ON CONFLICT DO NOTHING` on `(day, install_hash)` _is_ the once-per-day idempotency gate. The docs site reads a v2 public metrics JSON with small buckets suppressed.

**Tech Stack:** Bun, TypeScript, Ink (terminal UI), Vercel functions, Neon Postgres (`@neondatabase/serverless`), Next.js (docs site), `bun:test`.

**Spec:** [`.plans/usage-analytics-redesign-design.md`](./usage-analytics-redesign-design.md)

## Global Constraints

Every task's requirements implicitly include these. Values are verbatim from the spec.

- **The first run never sends.** Disclosure happens, the preference is persisted, and the first ping goes out on the _next_ launch.
- **No TTY → stays `unset`.** Write nothing, send nothing. A later interactive run must still disclose.
- **`DO_NOT_TRACK` and `CI` hard-block** sending and enabling. Truthy means `1`, `true`, `yes` (trimmed, case-insensitive). `0`, `false`, `no`, and `""` are **not** blocking.
- **`installId` exists on disk if and only if analytics is enabled.**
- **Wire payload is exactly five keys:** `installId`, `version`, `os`, `arch`, `ts`. Exact key-set equality; a sixth key is rejected.
- **Skip means keep it on, and the hint says so.** The string is `s skip (keeps it on)`. Never a bare `s skip`.
- **k-anonymity floor is 5.** Public dimension buckets under 5 fold into `"other"`. Public JSON only; the admin endpoint reads unsuppressed.
- **Raw rows are retained 35 days.** `daily_rollup` is permanent and holds no identity.
- **The ingest code never touches a client IP.** `clientIpKey()` is deleted, not hashed.
- Motion on the consent slide never sits under text being read. Title, options, and payload block are static.

## Prerequisites (operator actions, not code)

These block Tasks 11-12 only. Everything before them can proceed.

1. Create a Neon project; put the pooled connection string in Vercel as `DATABASE_URL`.
2. Set `ANALYTICS_HASH_SECRET` (any long random string), `CRON_SECRET`, and `ANALYTICS_ADMIN_TOKEN` in Vercel.
3. **Decide the deployed hostname.** This plan assumes the Vercel project is renamed to `kunai-analytics`, making the endpoint `https://kunai-analytics.vercel.app/api/ping`. Nothing has shipped, so no client is pinging the old host. If you would rather keep `kunai-telemetry.vercel.app`, change the single constant in Task 3 (`DEFAULT_ANALYTICS_ENDPOINT`) and the one in Task 13 (`DEFAULT_ANALYTICS_METRICS_URL`); nothing else depends on it.

## Decision recorded during planning

The docs site route stays **`/telemetry`**. It is in `apps/docs/app/sitemap.ts:29`, `apps/docs/app/llms.txt/route.ts:34`, `apps/docs/lib/doc-navigation.ts:236`, and `apps/docs/lib/layout.shared.tsx:62`. A public URL is user-facing vocabulary, not a code identifier, and "telemetry" is the word people search for — the same reasoning that keeps `telemetry` as a CLI command alias. Only components, libs, and copy are renamed. No redirect needed.

## File structure

**Phase A — CLI consent correctness**

| File                                                                                                               | Responsibility                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `apps/cli/src/domain/analytics/consent-policy.ts` (create)                                                         | Pure consent decision. No I/O, no `process.env` default.    |
| `apps/cli/src/services/analytics/UsageAnalyticsService.ts` (create, from `services/telemetry/TelemetryService.ts`) | Only writer of analytics config. Owns cadence, retry, send. |
| `apps/cli/src/services/analytics/install-id.ts` (move)                                                             | Unchanged logic.                                            |
| `apps/cli/src/services/telemetry/consent.ts` (delete)                                                              | Superseded by `domain/analytics/consent-policy.ts`.         |
| `packages/config/src/types.ts`, `defaults.ts` (modify)                                                             | Renamed keys, `AnalyticsPreference`.                        |
| `apps/cli/src/main.ts:875-903` (modify)                                                                            | One call. No policy.                                        |
| `apps/cli/src/app-shell/workflows/setup-workflows.ts:37-49,80-117` (modify)                                        | Uses `consentPatch`. No direct key writes.                  |

**Phase B — CLI consent UI**

| File                                                                     | Responsibility            |
| ------------------------------------------------------------------------ | ------------------------- |
| `apps/cli/src/app-shell/setup-shell.tsx:482-548` (modify)                | Redesigned consent slide. |
| `apps/cli/src/app-shell/analytics-disclosure-banner.tsx` (create)        | One-time upgrader banner. |
| `apps/cli/src/app-shell/workflows/shell-workflows.ts:1333-1400` (modify) | `/analytics` menu copy.   |

**Phase C — Ingest on Postgres**

| File                                                                               | Responsibility                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/analytics-ingest/src/store.ts` (create)                                      | `AnalyticsStore` port + `DailyRollup` type. |
| `apps/analytics-ingest/src/memory-store.ts` (create)                               | Test double.                                |
| `apps/analytics-ingest/src/postgres-store.ts` (create)                             | Neon implementation.                        |
| `apps/analytics-ingest/src/ingest.ts` (rewrite)                                    | Parse + hash + record. No rate limiting.    |
| `apps/analytics-ingest/src/public-metrics.ts` (create, replaces `snapshot.ts`)     | v2 shape, k-anonymity, parse.               |
| `apps/analytics-ingest/sql/001_init.sql` (create)                                  | Schema.                                     |
| `apps/analytics-ingest/scripts/migrate.ts` (create)                                | Applies the schema.                         |
| `apps/analytics-ingest/src/{redis-keys,upstash-client,upstash-stores}.ts` (delete) | Backend replaced.                           |

**Phase D — Docs**

| File                                                                       | Responsibility                       |
| -------------------------------------------------------------------------- | ------------------------------------ |
| `apps/docs/lib/analytics-metrics.ts` (create, from `telemetry-metrics.ts`) | v2 fetch + parse.                    |
| `apps/docs/components/analytics/usage-panel.tsx` (move)                    | Hero numbers + three breakdown bars. |
| `.docs/analytics-privacy-contract.md` (move + rewrite)                     | The contract.                        |

---

## Task 1: Rename the CLI analytics module and config keys

Mechanical. No behavior change. A reviewer should be able to confirm this task by seeing `bun run typecheck` and the existing test suite pass unchanged.

**Files:**

- Move: `apps/cli/src/services/telemetry/` → `apps/cli/src/services/analytics/`
- Rename: `TelemetryService.ts` → `UsageAnalyticsService.ts`
- Modify: `packages/config/src/types.ts:125-141`, `packages/config/src/defaults.ts:95-99`
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts:228-229,511-512`
- Modify: `apps/cli/src/container/types.ts:74,159`, `apps/cli/src/container/bootstrap-services.ts:50,433-436,490`
- Modify: `apps/cli/src/domain/session/command-registry.ts` (lines 21-22, 118-119, 171-172, 237-238, 350-359, 766, 1008-1009)
- Move: `apps/cli/test/unit/services/telemetry/` → `apps/cli/test/unit/services/analytics/`

**Interfaces:**

- Consumes: nothing.
- Produces: `AnalyticsPreference` type; config keys `analytics`, `installId`, `lastAnalyticsPingAt`, `analyticsRetryAfter`, `analyticsEndpoint`; `UsageAnalyticsService` class name; container field `usageAnalytics`.

- [ ] **Step 1: Rename the config type and keys**

In `packages/config/src/types.ts`, rename the `TelemetryPreference` type to `AnalyticsPreference` (find its declaration with `rg -n "TelemetryPreference" packages/config/src`), then replace lines 125-141 with:

```ts
/**
 * Anonymous usage ping. Default `unset` → zero network calls until the
 * disclosure has been shown. See .docs/analytics-privacy-contract.md.
 * Payload is only `{ installId, version, os, arch, ts }`.
 */
analytics: AnalyticsPreference;
/** Random UUID install id. Present if and only if `analytics === "enabled"`. */
installId: string;
/** Last successful cadence mark for the daily analytics ping (epoch ms). */
lastAnalyticsPingAt: number;
/**
 * Earliest epoch ms at which a failed analytics send may be retried.
 * `0` means no retry is pending. Set instead of `lastAnalyticsPingAt` when a
 * send fails, so the next CLI launch retries rather than losing the day.
 */
analyticsRetryAfter: number;
/** Optional override for the analytics ingest URL (else env / built-in default). */
analyticsEndpoint: string;
```

- [ ] **Step 2: Rename the defaults**

In `packages/config/src/defaults.ts`, replace lines 95-99:

```ts
  analytics: "unset",
  installId: "",
  lastAnalyticsPingAt: 0,
  analyticsRetryAfter: 0,
  analyticsEndpoint: "",
```

- [ ] **Step 3: Move the module and rename symbols**

```bash
git mv apps/cli/src/services/telemetry apps/cli/src/services/analytics
git mv apps/cli/src/services/analytics/TelemetryService.ts \
       apps/cli/src/services/analytics/UsageAnalyticsService.ts
git mv apps/cli/test/unit/services/telemetry apps/cli/test/unit/services/analytics
```

Then rename symbols across the repo. Run each and inspect the diff:

```bash
rg -l "TelemetryService" --type ts | xargs sed -i 's/TelemetryService/UsageAnalyticsService/g'
rg -l "DEFAULT_TELEMETRY_ENDPOINT" --type ts | xargs sed -i 's/DEFAULT_TELEMETRY_ENDPOINT/DEFAULT_ANALYTICS_ENDPOINT/g'
rg -l "TELEMETRY_PING_INTERVAL_MS" --type ts | xargs sed -i 's/TELEMETRY_PING_INTERVAL_MS/ANALYTICS_PING_INTERVAL_MS/g'
rg -l "TELEMETRY_RETRY_BACKOFF_MS" --type ts | xargs sed -i 's/TELEMETRY_RETRY_BACKOFF_MS/ANALYTICS_RETRY_BACKOFF_MS/g'
rg -l "TelemetryPayload" --type ts | xargs sed -i 's/TelemetryPayload/AnalyticsPayload/g'
rg -l "resolveTelemetryEndpoint" --type ts | xargs sed -i 's/resolveTelemetryEndpoint/resolveAnalyticsEndpoint/g'
rg -l "services/telemetry" --type ts | xargs sed -i 's#services/telemetry#services/analytics#g'
```

Then fix the config-key references by hand — `sed` is not safe here because `telemetry` appears in unrelated mpv code:

- `apps/cli/src/services/persistence/ConfigServiceImpl.ts:228-229` and `:511-512` — `telemetryEndpoint` → `analyticsEndpoint`
- `apps/cli/src/container/types.ts:159` — `readonly telemetryService: UsageAnalyticsService;` → `readonly usageAnalytics: UsageAnalyticsService;`
- `apps/cli/src/container/bootstrap-services.ts:433-436` — the local `const telemetryService` → `const usageAnalytics`, `config.getRaw().telemetryEndpoint` → `.analyticsEndpoint`, and the return-object key at `:490`
- `apps/cli/src/main.ts` — `container.telemetryService` → `container.usageAnalytics`, `raw.telemetry` → `raw.analytics`
- Every remaining `config.telemetry`, `lastTelemetryPingAt`, `telemetryRetryAfter` — find with:

```bash
rg -n "\btelemetry\b|lastTelemetryPingAt|telemetryRetryAfter|telemetryEndpoint" \
   --type ts apps/cli/src packages/config/src | grep -v "infra/player\|domain/playback"
```

- [ ] **Step 4: Update the command registry**

In `apps/cli/src/domain/session/command-registry.ts`, change the command ids `"telemetry"` → `"analytics"` and `"telemetry-show"` → `"analytics-show"` at lines 21-22, 118-119, 171-172, 237-238, 766, and 1008-1009. At lines 350-359, replace the two command definitions:

```ts
  {
    id: "analytics",
    label: "Analytics",
    aliases: ["analytics", "telemetry"],
    description: "Anonymous usage ping — status, payload, and consent",
  },
  {
    id: "analytics-show",
    label: "Analytics payload",
    aliases: ["analytics show", "analytics-show", "telemetry show", "telemetry-show"],
    description: "Print the exact JSON that would be sent",
  },
```

Keep whatever other fields the surrounding definitions carry — copy the shape of the neighbours rather than dropping keys.

In `apps/cli/src/app-shell/workflows/shell-workflows.ts:829-830`, update the dispatch map keys to `analytics` and `analytics-show`, and rename `handleTelemetry`/`handleTelemetryShow` to `handleAnalytics`/`handleAnalyticsShow`.

- [ ] **Step 5: Verify nothing broke**

```bash
bun run typecheck && bun run test
```

Expected: PASS. This task changes no behavior, so every existing test must still pass. If a test fails, you missed a rename — do not adjust the test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename the telemetry ping subsystem to analytics

No behavior change. Frees the word 'telemetry' to mean local playback
data only. Safe to rename config keys because no released version ever
wrote them: v0.2.5 has no services/telemetry and no telemetry config."
```

---

## Task 2: Pure consent policy

This is where the `CI=0` defect dies.

**Files:**

- Create: `apps/cli/src/domain/analytics/consent-policy.ts`
- Create: `apps/cli/test/unit/domain/analytics/consent-policy.test.ts`
- Delete: `apps/cli/src/services/analytics/consent.ts` (after Task 3 stops importing it)

**Interfaces:**

- Consumes: `AnalyticsPreference` from Task 1.
- Produces: `ConsentEnv`, `ConsentState`, `isTruthyEnv(value)`, `envBlockFlag(env)`, `resolveConsentState(inputs)`, `canSend(state)`, `canPersistEnabled(state)`.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/domain/analytics/consent-policy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  canPersistEnabled,
  canSend,
  envBlockFlag,
  isTruthyEnv,
  resolveConsentState,
} from "@/domain/analytics/consent-policy";

describe("isTruthyEnv", () => {
  test("only 1/true/yes are truthy, trimmed and case-insensitive", () => {
    for (const value of ["1", "true", "TRUE", " yes ", "Yes"]) {
      expect(isTruthyEnv(value)).toBe(true);
    }
    for (const value of [undefined, "", " ", "0", "false", "no", "off"]) {
      expect(isTruthyEnv(value)).toBe(false);
    }
  });
});

describe("envBlockFlag", () => {
  test("DO_NOT_TRACK=0 and CI=0 do not block", () => {
    expect(envBlockFlag({ DO_NOT_TRACK: "0", CI: "0" })).toBeNull();
    expect(envBlockFlag({ DO_NOT_TRACK: "false" })).toBeNull();
    expect(envBlockFlag({})).toBeNull();
  });

  test("truthy flags block, DO_NOT_TRACK named first", () => {
    expect(envBlockFlag({ DO_NOT_TRACK: "1" })).toBe("DO_NOT_TRACK");
    expect(envBlockFlag({ CI: "true" })).toBe("CI");
    expect(envBlockFlag({ DO_NOT_TRACK: "1", CI: "1" })).toBe("DO_NOT_TRACK");
  });
});

describe("resolveConsentState", () => {
  test("env block wins over a stored enabled preference", () => {
    expect(
      resolveConsentState({ env: { CI: "1" }, isInteractive: true, stored: "enabled" }),
    ).toEqual({ kind: "blocked-by-env", flag: "CI" });
  });

  test("unset without a TTY is undisclosed, not disabled", () => {
    expect(resolveConsentState({ env: {}, isInteractive: false, stored: "unset" })).toEqual({
      kind: "undisclosed-non-interactive",
    });
  });

  test("unset with a TTY awaits disclosure", () => {
    expect(resolveConsentState({ env: {}, isInteractive: true, stored: "unset" })).toEqual({
      kind: "awaiting-disclosure",
    });
  });

  test("stored preferences pass through when not env-blocked", () => {
    expect(resolveConsentState({ env: {}, isInteractive: true, stored: "enabled" })).toEqual({
      kind: "enabled",
    });
    expect(resolveConsentState({ env: {}, isInteractive: false, stored: "disabled" })).toEqual({
      kind: "disabled",
    });
  });

  test("CI=0 with stored enabled still sends — the regression this replaces", () => {
    const state = resolveConsentState({
      env: { CI: "0", DO_NOT_TRACK: "0" },
      isInteractive: true,
      stored: "enabled",
    });
    expect(state).toEqual({ kind: "enabled" });
    expect(canSend(state)).toBe(true);
  });
});

describe("canSend / canPersistEnabled", () => {
  test("only enabled may send", () => {
    expect(canSend({ kind: "enabled" })).toBe(true);
    for (const state of [
      { kind: "disabled" },
      { kind: "awaiting-disclosure" },
      { kind: "undisclosed-non-interactive" },
      { kind: "blocked-by-env", flag: "CI" },
    ] as const) {
      expect(canSend(state)).toBe(false);
    }
  });

  test("env block is the only bar to persisting enabled", () => {
    expect(canPersistEnabled({ kind: "awaiting-disclosure" })).toBe(true);
    expect(canPersistEnabled({ kind: "blocked-by-env", flag: "DO_NOT_TRACK" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run test apps/cli/test/unit/domain/analytics/consent-policy.test.ts`
Expected: FAIL — cannot resolve `@/domain/analytics/consent-policy`.

- [ ] **Step 3: Implement the module**

Create `apps/cli/src/domain/analytics/consent-policy.ts`:

```ts
/**
 * The single definition of analytics consent.
 *
 * Pure: no I/O, no `process.env` default parameter. Callers pass the
 * environment in, which is what makes the truth table in the tests
 * exhaustible. Three earlier copies of this logic disagreed about what a
 * "set" env var means, and `CI=0` was read as blocking.
 */

import type { AnalyticsPreference } from "@kunai/config";

export type ConsentEnv = {
  readonly DO_NOT_TRACK?: string | undefined;
  readonly CI?: string | undefined;
};

export type ConsentState =
  | { readonly kind: "blocked-by-env"; readonly flag: "DO_NOT_TRACK" | "CI" }
  | { readonly kind: "undisclosed-non-interactive" }
  | { readonly kind: "awaiting-disclosure" }
  | { readonly kind: "enabled" }
  | { readonly kind: "disabled" };

/** A flag counts as set only when it affirmatively says yes. `0` means no. */
export function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function envBlockFlag(env: ConsentEnv): "DO_NOT_TRACK" | "CI" | null {
  if (isTruthyEnv(env.DO_NOT_TRACK)) return "DO_NOT_TRACK";
  if (isTruthyEnv(env.CI)) return "CI";
  return null;
}

export function resolveConsentState(inputs: {
  readonly env: ConsentEnv;
  readonly isInteractive: boolean;
  readonly stored: AnalyticsPreference;
}): ConsentState {
  const flag = envBlockFlag(inputs.env);
  if (flag) return { kind: "blocked-by-env", flag };
  if (inputs.stored === "enabled") return { kind: "enabled" };
  if (inputs.stored === "disabled") return { kind: "disabled" };
  // `unset` without a TTY stays unset rather than persisting a decline: the
  // notice could not be shown, so a later interactive run must still disclose.
  return inputs.isInteractive
    ? { kind: "awaiting-disclosure" }
    : { kind: "undisclosed-non-interactive" };
}

export function canSend(state: ConsentState): boolean {
  return state.kind === "enabled";
}

export function canPersistEnabled(state: ConsentState): boolean {
  return state.kind !== "blocked-by-env";
}
```

If `AnalyticsPreference` is not exported from the `@kunai/config` package root, add it to `packages/config/src/index.ts`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `bun run test apps/cli/test/unit/domain/analytics/consent-policy.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Confirm the layering test still passes**

Run: `bun run test apps/cli/test/unit/architecture/boundary-imports.test.ts`
Expected: PASS. `domain/` may import `@kunai/config` but not `app`, `app-shell`, or `services`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/domain/analytics/consent-policy.ts \
        apps/cli/test/unit/domain/analytics/consent-policy.test.ts
git commit -m "feat(analytics): one pure consent policy

Fixes CI=0 and DO_NOT_TRACK=0 being read as blocking, which permanently
persisted 'disabled'. Env gating and user choice no longer share a
signature, so nothing needs to fabricate choice: 'timeout'."
```

---

## Task 3: `UsageAnalyticsService` — one writer, no identifier on decline

**Files:**

- Modify: `apps/cli/src/services/analytics/UsageAnalyticsService.ts` (full rewrite)
- Delete: `apps/cli/src/services/analytics/consent.ts`
- Modify: `apps/cli/test/unit/services/analytics/telemetry-service.test.ts` → rename to `usage-analytics-service.test.ts`

**Interfaces:**

- Consumes: `resolveConsentState`, `canSend`, `canPersistEnabled`, `envBlockFlag`, `ConsentEnv` (Task 2); `ensureInstallId` (unchanged).
- Produces:
  - `UNSET_INSTALL_ID_PLACEHOLDER: "<generated when you enable>"`
  - `DEFAULT_ANALYTICS_ENDPOINT: string`
  - `type AnalyticsPayload = { installId; version; os; arch; ts }`
  - `type SessionStartOutcome = { kind: "needs-disclosure" | "quiet" | "pinged" }`
  - `UsageAnalyticsService` with `getStatus()`, `consentPatch(choice)`, `setConsent(choice)`, `describePayload()`, `onSessionStart({ isInteractive })`, `maybePing()`

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/unit/services/analytics/usage-analytics-service.test.ts` (delete the old `telemetry-service.test.ts` after porting any of its cases you still want — the privacy-gate cases are re-expressed below):

```ts
import { describe, expect, test } from "bun:test";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import {
  DEFAULT_ANALYTICS_ENDPOINT,
  UNSET_INSTALL_ID_PLACEHOLDER,
  UsageAnalyticsService,
  type AnalyticsFetch,
} from "@/services/analytics/UsageAnalyticsService";

const UUID = "11111111-2222-4333-8444-555555555555";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  let saves = 0;
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {
      saves += 1;
    },
    get rawRef() {
      return raw;
    },
    get saveCount() {
      return saves;
    },
  };
}

function makeService(
  config: ReturnType<typeof makeConfig>,
  options: { fetchImpl?: AnalyticsFetch; env?: { DO_NOT_TRACK?: string; CI?: string } } = {},
) {
  return new UsageAnalyticsService({
    config,
    currentVersion: "0.3.0",
    endpoint: DEFAULT_ANALYTICS_ENDPOINT,
    fetchImpl:
      options.fetchImpl ??
      (async () => {
        throw new Error("fetch must not be called");
      }),
    now: () => Date.UTC(2026, 7, 14),
    platform: { os: "linux", arch: "x64" },
    env: options.env ?? {},
  });
}

describe("identifier lifecycle", () => {
  test("declining stores no install id", async () => {
    const config = makeConfig({ analytics: "unset", installId: UUID });
    await makeService(config).setConsent("disabled");
    expect(config.rawRef.analytics).toBe("disabled");
    expect(config.rawRef.installId).toBe("");
  });

  test("enabling mints one install id", async () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    await makeService(config).setConsent("enabled");
    expect(config.rawRef.analytics).toBe("enabled");
    expect(config.rawRef.installId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("describePayload writes nothing and hides the id when not enabled", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const payload = makeService(config).describePayload();
    expect(payload.installId).toBe(UNSET_INSTALL_ID_PLACEHOLDER);
    expect(config.rawRef.installId).toBe("");
    expect(config.saveCount).toBe(0);
  });

  test("describePayload shows the real id once enabled", () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    expect(makeService(config).describePayload().installId).toBe(UUID);
  });
});

describe("consentPatch", () => {
  test("is pure and returns the same keys setConsent would write", () => {
    const config = makeConfig({ analytics: "unset", installId: "" });
    const patch = makeService(config).consentPatch("disabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "" });
    expect(config.saveCount).toBe(0);
  });

  test("refuses to enable under DO_NOT_TRACK", () => {
    const config = makeConfig({ analytics: "unset" });
    const patch = makeService(config, { env: { DO_NOT_TRACK: "1" } }).consentPatch("enabled");
    expect(patch).toEqual({ analytics: "disabled", installId: "" });
  });
});

describe("onSessionStart", () => {
  test("first run discloses, persists, and does NOT send", async () => {
    const config = makeConfig({ analytics: "unset" });
    const calls: string[] = [];
    const service = makeService(config, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    const outcome = await service.onSessionStart({ isInteractive: true });

    expect(outcome).toEqual({ kind: "needs-disclosure" });
    expect(calls).toEqual([]);
  });

  test("the launch after disclosure does send", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const calls: string[] = [];
    const service = makeService(config, {
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });

    const outcome = await service.onSessionStart({ isInteractive: true });

    expect(outcome).toEqual({ kind: "pinged" });
    expect(calls).toEqual([DEFAULT_ANALYTICS_ENDPOINT]);
  });

  test("no TTY stays unset — writes nothing, sends nothing", async () => {
    const config = makeConfig({ analytics: "unset" });
    const outcome = await makeService(config).onSessionStart({ isInteractive: false });
    expect(outcome).toEqual({ kind: "quiet" });
    expect(config.rawRef.analytics).toBe("unset");
    expect(config.saveCount).toBe(0);
  });

  test("env block rewrites a stale enabled config to disabled and clears the id", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const outcome = await makeService(config, { env: { CI: "true" } }).onSessionStart({
      isInteractive: true,
    });
    expect(outcome).toEqual({ kind: "quiet" });
    expect(config.rawRef.analytics).toBe("disabled");
    expect(config.rawRef.installId).toBe("");
  });

  test("CI=0 does not block — the regression this replaces", async () => {
    const config = makeConfig({ analytics: "enabled", installId: UUID });
    const calls: string[] = [];
    const service = makeService(config, {
      env: { CI: "0", DO_NOT_TRACK: "0" },
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 204 });
      },
    });
    await service.onSessionStart({ isInteractive: true });
    expect(config.rawRef.analytics).toBe("enabled");
    expect(calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `bun run test apps/cli/test/unit/services/analytics/usage-analytics-service.test.ts`
Expected: FAIL — `UNSET_INSTALL_ID_PLACEHOLDER` and `onSessionStart` do not exist.

- [ ] **Step 3: Rewrite the service**

Replace `apps/cli/src/services/analytics/UsageAnalyticsService.ts` entirely:

```ts
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import {
  canPersistEnabled,
  canSend,
  envBlockFlag,
  resolveConsentState,
  type ConsentEnv,
} from "@/domain/analytics/consent-policy";

import { ensureInstallId } from "./install-id";

/** Official ping endpoint. Override with `KUNAI_ANALYTICS_URL`. */
export const DEFAULT_ANALYTICS_ENDPOINT = "https://kunai-analytics.vercel.app/api/ping";

export const ANALYTICS_PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Delay before retrying a failed send. A failed ping must not consume the
 * 24h cadence, or a single flaky network moment silently discards the day.
 * Retries happen on the next CLI launch — never on an in-process timer, which
 * would be killed with the short-lived process.
 */
export const ANALYTICS_RETRY_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Shown instead of a real UUID to anyone who has not enabled analytics.
 * Rendering a preview must never be what creates an identifier.
 */
export const UNSET_INSTALL_ID_PLACEHOLDER = "<generated when you enable>";

/** Wire contract with users — exactly five keys. Never add one silently. */
export type AnalyticsPayload = {
  readonly installId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly ts: number;
};

export type AnalyticsConsentChoice = "enabled" | "disabled";

/**
 * What the caller must do next. The service cannot show UI — it lives in
 * `services/` and the disclosure lives in `app-shell/` — so it returns an
 * instruction instead of reaching across the boundary.
 */
export type SessionStartOutcome =
  { readonly kind: "needs-disclosure" } | { readonly kind: "quiet" } | { readonly kind: "pinged" };

export type AnalyticsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type AnalyticsConfig = {
  getRaw(): KitsuneConfig;
  update(partial: Partial<KitsuneConfig>): Promise<void>;
  save(): Promise<void>;
};

export type UsageAnalyticsServiceDeps = {
  readonly config: AnalyticsConfig;
  readonly currentVersion: string;
  readonly endpoint: string;
  readonly fetchImpl?: AnalyticsFetch;
  readonly now?: () => number;
  readonly platform?: { readonly os: string; readonly arch: string };
  readonly pingTimeoutMs?: number;
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: ConsentEnv;
};

export class UsageAnalyticsService {
  private readonly fetchImpl: AnalyticsFetch;
  private readonly now: () => number;
  private readonly platform: { readonly os: string; readonly arch: string };
  private readonly pingTimeoutMs: number;
  private readonly env: ConsentEnv;

  constructor(private readonly deps: UsageAnalyticsServiceDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => Date.now());
    this.platform = deps.platform ?? { os: process.platform, arch: process.arch };
    this.pingTimeoutMs = deps.pingTimeoutMs ?? 2_500;
    this.env = deps.env ?? { DO_NOT_TRACK: process.env.DO_NOT_TRACK, CI: process.env.CI };
  }

  getStatus(): KitsuneConfig["analytics"] {
    return this.deps.config.getRaw().analytics;
  }

  /**
   * The config keys a consent choice implies. Pure, so the setup wizard can
   * fold it into its single batched write instead of becoming a second writer.
   */
  consentPatch(choice: AnalyticsConsentChoice): Partial<KitsuneConfig> {
    const blocked = envBlockFlag(this.env) !== null;
    if (choice === "disabled" || blocked) {
      // Clearing the id is the guarantee: it exists iff analytics is enabled.
      return { analytics: "disabled", installId: "" };
    }
    return { analytics: "enabled", installId: ensureInstallId(this.deps.config.getRaw()) };
  }

  async setConsent(
    choice: AnalyticsConsentChoice,
  ): Promise<{ readonly applied: AnalyticsConsentChoice }> {
    const patch = this.consentPatch(choice);
    await this.deps.config.update(patch);
    await this.deps.config.save();
    return { applied: patch.analytics as AnalyticsConsentChoice };
  }

  /**
   * Exact JSON that would be sent. A query: performs no writes, and does not
   * mint an install id for someone who has not enabled analytics.
   */
  describePayload(): AnalyticsPayload {
    const config = this.deps.config.getRaw();
    const enabled = config.analytics === "enabled" && config.installId.trim().length > 0;
    return {
      installId: enabled ? config.installId : UNSET_INSTALL_ID_PLACEHOLDER,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: this.now(),
    };
  }

  /**
   * The one entry point `main.ts` calls. All branching lives here.
   *
   * The first run never sends: disclosure is raised, the caller persists the
   * outcome, and the ping goes out on the next launch. Without that rule
   * "on by default, disclosed" would mean the data left before the notice.
   */
  async onSessionStart(options: { readonly isInteractive: boolean }): Promise<SessionStartOutcome> {
    const state = resolveConsentState({
      env: this.env,
      isInteractive: options.isInteractive,
      stored: this.deps.config.getRaw().analytics,
    });

    if (!canPersistEnabled(state)) {
      // A stale `enabled` config must not survive an env block.
      if (this.deps.config.getRaw().analytics === "enabled") {
        await this.deps.config.update({ analytics: "disabled", installId: "" });
        await this.deps.config.save();
      }
      return { kind: "quiet" };
    }

    if (state.kind === "awaiting-disclosure") return { kind: "needs-disclosure" };
    if (!canSend(state)) return { kind: "quiet" };

    await this.maybePing();
    return { kind: "pinged" };
  }

  /** Fire-and-forget; never blocks startup/playback. Failures are silent. */
  pingInBackground(): void {
    void this.maybePing().catch(() => {
      // Silent by design — analytics must never surface as a user-facing failure.
    });
  }

  async maybePing(): Promise<void> {
    const config = this.deps.config.getRaw();
    const state = resolveConsentState({
      env: this.env,
      isInteractive: true,
      stored: config.analytics,
    });
    if (!canSend(state)) return;

    const endpoint = this.deps.endpoint.trim();
    if (!endpoint) return;

    const now = this.now();
    if (
      config.lastAnalyticsPingAt > 0 &&
      now - config.lastAnalyticsPingAt < ANALYTICS_PING_INTERVAL_MS
    ) {
      return;
    }
    // A pending retry from an earlier failed send is still cooling down.
    if (config.analyticsRetryAfter > now) return;

    const installId = ensureInstallId(config);
    const payload: AnalyticsPayload = {
      installId,
      version: this.deps.currentVersion,
      os: this.platform.os,
      arch: this.platform.arch,
      ts: now,
    };

    const outcome = await this.send(endpoint, payload);

    // Success and permanent rejection both consume the 24h cadence; only a
    // transient failure schedules a near-term retry.
    await this.deps.config.update(
      outcome === "retry"
        ? { installId, analyticsRetryAfter: now + ANALYTICS_RETRY_BACKOFF_MS }
        : { installId, lastAnalyticsPingAt: now, analyticsRetryAfter: 0 },
    );
    await this.deps.config.save();
  }

  /**
   * `permanent` covers success and 4xx: both mean "do not try this again today".
   * `retry` covers network errors, timeouts, and 5xx.
   */
  private async send(endpoint: string, payload: AnalyticsPayload): Promise<"permanent" | "retry"> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return response.status >= 500 ? "retry" : "permanent";
    } catch {
      return "retry";
    } finally {
      clearTimeout(timer);
    }
  }
}

export function resolveAnalyticsEndpoint(
  env: NodeJS.ProcessEnv = process.env,
  configured = "",
): string {
  const fromEnv = typeof env.KUNAI_ANALYTICS_URL === "string" ? env.KUNAI_ANALYTICS_URL.trim() : "";
  if (fromEnv) return fromEnv;
  const fromConfig = configured.trim();
  if (fromConfig) return fromConfig;
  return DEFAULT_ANALYTICS_ENDPOINT;
}
```

- [ ] **Step 4: Delete the superseded consent module**

```bash
git rm apps/cli/src/services/analytics/consent.ts
rg -n "services/analytics/consent" --type ts
```

Expected: no matches. If `setup-workflows.ts` still imports it, leave it broken — Task 4 fixes that file, and `typecheck` will remind you.

- [ ] **Step 5: Run the tests**

Run: `bun run test apps/cli/test/unit/services/analytics/usage-analytics-service.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analytics): opt-out service with disclosure before first send

- onSessionStart returns an instruction; the service never reaches into UI
- consentPatch is pure so setup stays a single batched write
- describePayload no longer mints an install id as a side effect of rendering
- declining clears installId: it now exists iff analytics is enabled"
```

---

## Task 4: Wire `main.ts` and the setup wizard to the single owner

**Files:**

- Modify: `apps/cli/src/main.ts:875-903`
- Modify: `apps/cli/src/app-shell/workflows/setup-workflows.ts:1-49,79-118`
- Create: `apps/cli/test/unit/app-shell/setup-analytics-write.test.ts`

**Interfaces:**

- Consumes: `container.usageAnalytics.onSessionStart`, `.consentPatch` (Task 3).
- Produces: `SetupPrefs.analyticsChoice` (renamed from `telemetryChoice`), consumed by Task 5.

- [ ] **Step 1: Replace the `main.ts` block**

Replace `apps/cli/src/main.ts:875-903` in full:

```ts
if (!config.offlineMode)
  void (async () => {
    try {
      const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const outcome = await container.usageAnalytics.onSessionStart({ isInteractive });
      if (outcome.kind === "needs-disclosure") {
        container.analyticsDisclosurePending = true;
      }
    } catch {
      // Analytics must never affect startup.
    }
  })();
```

Add to `apps/cli/src/container/types.ts`, next to the other mutable session fields:

```ts
/**
 * Set when the analytics notice has not been shown yet. The shell reads it
 * once on mount, shows the banner, and clears it. Mutable because the
 * decision is made in a startup task and consumed by the shell.
 */
analyticsDisclosurePending: boolean;
```

Initialise it to `false` in the container return object in `bootstrap-services.ts`.

- [ ] **Step 2: Make the setup wizard stop writing analytics keys**

In `apps/cli/src/app-shell/workflows/setup-workflows.ts`, delete the `resolveTelemetryConsent` and `ensureInstallId` imports (lines 8-9) and delete `resolveSetupTelemetry` (lines 37-49) entirely.

Replace line 79-80:

```ts
const analyticsPatch =
  outcome === "skipped"
    ? // Aborting the wizard is not disclosure. Stay off.
      container.usageAnalytics.consentPatch("disabled")
    : container.usageAnalytics.consentPatch(prefs.analyticsChoice);
```

Then in both `config.update({...})` calls, replace the `telemetry,` and `installId,` lines with:

```ts
      ...analyticsPatch,
```

And at line 123, change the diagnostics context to `context: { outcome, force, analytics: analyticsPatch.analytics }`.

- [ ] **Step 3: Write the failing test**

Create `apps/cli/test/unit/app-shell/setup-analytics-write.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  DEFAULT_ANALYTICS_ENDPOINT,
  UsageAnalyticsService,
} from "@/services/analytics/UsageAnalyticsService";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  let saves = 0;
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {
      saves += 1;
    },
    get rawRef() {
      return raw;
    },
    get saveCount() {
      return saves;
    },
  };
}

describe("setup consent write", () => {
  test("consentPatch merges into one config write, so setup saves once", async () => {
    const config = makeConfig({ analytics: "unset" });
    const service = new UsageAnalyticsService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_ANALYTICS_ENDPOINT,
      env: {},
    });

    // Mirrors what runSetupWizard does: one update, one save.
    await config.update({ onboardingVersion: 2, ...service.consentPatch("enabled") });
    await config.save();

    expect(config.saveCount).toBe(1);
    expect(config.rawRef.analytics).toBe("enabled");
    expect(config.rawRef.onboardingVersion).toBe(2);
    expect(config.rawRef.installId).not.toBe("");
  });

  test("an aborted wizard is not disclosure", () => {
    const config = makeConfig({ analytics: "unset" });
    const service = new UsageAnalyticsService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_ANALYTICS_ENDPOINT,
      env: {},
    });
    expect(service.consentPatch("disabled")).toEqual({ analytics: "disabled", installId: "" });
  });
});
```

- [ ] **Step 4: Run the full CLI suite**

Run: `bun run typecheck && bun run test`
Expected: PASS. Any test still referencing `resolveTelemetryConsent` or `telemetryChoice` must be updated to the new names — that is expected fallout from Task 3, not a regression.

- [ ] **Step 5: Confirm the policy has exactly one home**

```bash
rg -n "DO_NOT_TRACK|isTruthyEnv" --type ts apps/cli/src
```

Expected: matches only in `apps/cli/src/domain/analytics/consent-policy.ts` and the `env` default in `UsageAnalyticsService.ts`. Any other hit is a fourth copy — remove it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(analytics): main.ts and setup call one consent owner

Deletes the two hand-rolled copies of the env gate. main.ts no longer
fabricates choice: 'timeout' to reuse a prompt-shaped function, and the
setup wizard is no longer a second writer of analytics config."
```

---

## Task 5: Redesigned consent slide

**Files:**

- Modify: `apps/cli/src/app-shell/setup-shell.tsx:37-43` (`SetupPrefs`), `:482-548` (`TelemetrySlide`), `:633-647,674-677,708-721,782-786,826`
- Create: `apps/cli/test/unit/app-shell/analytics-consent-slide.test.tsx`

**Interfaces:**

- Consumes: `SakuraPetal` primitives — `BLOOM_FRAMES`, `STATIC_PETAL`, `reducedMotionEnabled()`, `useFrameTick(active, intervalMs, stopAfter?)` from `@/app-shell/primitives/SakuraPetal`; `SlideLayout`, `SlideTitle`, `FooterHint`, `palette` (already in this file).
- Produces: `SetupPrefs.analyticsChoice: "enabled" | "disabled"`, consumed by Task 4's `setup-workflows.ts`.

- [ ] **Step 1: Rename the pref field**

In `apps/cli/src/app-shell/setup-shell.tsx`, change `SetupPrefs` (lines 37-43):

```ts
export interface SetupPrefs {
  audio: string;
  subtitle: string;
  downloadsEnabled: boolean;
  /** Setup-time analytics choice before DO_NOT_TRACK / CI resolution. */
  analyticsChoice: "enabled" | "disabled";
}
```

Rename the `Slide` union member `"telemetry"` → `"analytics"` (lines 20, 29), the state `telemetryIdx` → `analyticsIdx` (line 633), and every `slide === "telemetry"` comparison (lines 640, 676, 708, 720, 782).

**The default flips.** At line 633 the initial index becomes `1`-equivalent — see Step 3 for the option order that makes index `0` mean _keep it on_.

- [ ] **Step 2: Write the failing test**

Create `apps/cli/test/unit/app-shell/analytics-consent-slide.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";

import { AnalyticsSlide } from "@/app-shell/setup-shell";

describe("analytics consent slide", () => {
  test("states that skipping keeps it on", () => {
    const { lastFrame } = render(<AnalyticsSlide width={80} rows={24} selectedIndex={0} />);
    expect(lastFrame()).toContain("skip (keeps it on)");
    expect(lastFrame()).not.toMatch(/\[s\]\s+skip\s*$/m);
  });

  test("shows the exact payload inline, not behind another command", () => {
    const { lastFrame } = render(<AnalyticsSlide width={80} rows={24} selectedIndex={0} />);
    for (const key of ["installId", "version", "os", "arch", "ts"]) {
      expect(lastFrame()).toContain(key);
    }
  });

  test("names what is never sent", () => {
    const { lastFrame } = render(<AnalyticsSlide width={80} rows={24} selectedIndex={0} />);
    expect(lastFrame()).toContain("Never:");
    expect(lastFrame()).toContain("titles");
  });

  test("index 0 is keep-it-on", () => {
    const { lastFrame } = render(<AnalyticsSlide width={80} rows={24} selectedIndex={0} />);
    expect(lastFrame()).toContain("Keep it on");
  });

  test("reduced motion renders the static petal only", () => {
    const prior = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
    try {
      const { lastFrame } = render(<AnalyticsSlide width={80} rows={24} selectedIndex={0} />);
      expect(lastFrame()).toContain("❀");
      expect(lastFrame()).not.toContain("✾");
      expect(lastFrame()).not.toContain("❁");
    } finally {
      if (prior === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = prior;
    }
  });
});
```

`AnalyticsSlide` must be `export`ed from `setup-shell.tsx` for this test — the other slides are module-private, so add `export` only to this one and note why in a comment.

- [ ] **Step 3: Run it to confirm it fails**

Run: `bun run test apps/cli/test/unit/app-shell/analytics-consent-slide.test.tsx`
Expected: FAIL — `AnalyticsSlide` is not exported.

- [ ] **Step 4: Replace the slide**

Replace `apps/cli/src/app-shell/setup-shell.tsx:482-548`:

```tsx
/**
 * Slow, deliberate petal drift. Loader cadence (150ms) would say this screen
 * is loading something; it is not. The user is reading a consent decision.
 */
const CONSENT_PETAL_INTERVAL_MS = 900;

/** Exported only so the consent copy can be asserted in a unit test. */
export function AnalyticsSlide({
  width,
  rows,
  selectedIndex,
}: {
  width: number;
  rows: number;
  selectedIndex: number;
}) {
  // Motion lives in the frame ornaments only — never under the text being read.
  const tick = useFrameTick(true, CONSENT_PETAL_INTERVAL_MS);
  const still = reducedMotionEnabled();
  const bloom = still ? STATIC_PETAL : (BLOOM_FRAMES[tick % BLOOM_FRAMES.length] ?? STATIC_PETAL);
  const sidePetal = still || tick % 2 === 0 ? "✿" : " ";

  const opts = [
    {
      label: "Keep it on",
      detail: "Shows me which versions and platforms to support",
    },
    {
      label: "Turn it off",
      detail: "No network calls. No install id stored on disk.",
    },
  ];

  return (
    <SlideLayout
      width={width}
      rows={rows}
      footer={
        <FooterHint
          parts={[
            { key: "Enter", label: "confirm & next" },
            { key: "↑↓", label: "choose" },
            { key: "←/b", label: "back" },
            // Never a bare "skip": with an opt-out default, this clause is the
            // difference between disclosure and a dark pattern.
            { key: "s", label: "skip (keeps it on)" },
          ]}
        />
      }
    >
      <Box>
        <Text color={palette.accent} bold>
          {bloom}
        </Text>
        <Text color={palette.text} bold>
          {"  Anonymous usage ping  "}
        </Text>
        <Text color={palette.dim}>{sidePetal}</Text>
      </Box>

      <SlideTitle
        text=""
        sub="On by default. One ping per day. Turn it off right here, or anytime with /analytics."
      />

      <Box flexDirection="column">
        {opts.map((opt, i) => {
          const selected = i === selectedIndex;
          return (
            <Box key={opt.label} backgroundColor={selected ? palette.accentFill : undefined}>
              <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
              <Box flexDirection="column">
                <Text color={palette.text} bold={selected}>
                  {opt.label}
                  {i === 0 ? "   ← default" : ""}
                </Text>
                <Text color={selected ? palette.muted : palette.dim} dimColor={!selected}>
                  {"  "}
                  {opt.detail}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={palette.line}
        paddingX={1}
      >
        <Text color={palette.muted}>Exactly what is sent</Text>
        <Text color={palette.text}>{'{ "installId": "9f3a…", "version": "0.3.0",'}</Text>
        <Text color={palette.text}>{'  "os": "linux", "arch": "x64", "ts": 0 }'}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          Never: titles · queries · providers · URLs · paths
        </Text>
      </Box>
    </SlideLayout>
  );
}
```

Add the import at the top of the file:

```ts
import {
  BLOOM_FRAMES,
  reducedMotionEnabled,
  STATIC_PETAL,
  useFrameTick,
} from "./primitives/SakuraPetal";
```

- [ ] **Step 5: Flip the default and the skip key**

At line 633, the initial index becomes `0` (which is now _keep it on_) — confirm it reads `useState(0)`.

At lines 674-677, the `s` handler currently forces the decline. Replace the `slide === "telemetry"` branch with:

```ts
if (slide === "analytics") {
  // Skip accepts the default, which is on. The footer says so.
  setAnalyticsIdx(0);
  advance();
  return;
}
```

Use whatever the surrounding code calls to move to the next slide in place of `advance()` — read lines 660-700 and match it.

At line 647, the prefs assembly becomes:

```ts
      analyticsChoice: analyticsIdx === 0 ? "enabled" : "disabled",
```

At line 826, the abort path becomes `analyticsChoice: "disabled"` — aborting the wizard is not disclosure.

At lines 782-786, rename the JSX usage to `<AnalyticsSlide ... />`.

- [ ] **Step 6: Run the tests**

Run: `bun run test apps/cli/test/unit/app-shell/analytics-consent-slide.test.tsx && bun run typecheck`
Expected: PASS, 5 tests.

- [ ] **Step 7: Look at it**

Run: `bun run dev -- --setup` (or whatever flag forces the wizard — check `openSetupWizardFromShell(container, { force: true })` in `shell-workflows.ts:831` for the command id, likely `/setup`).

Confirm by eye: the petals move, the title and options do not, the payload block is readable at 80 columns, and the footer says `skip (keeps it on)`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(analytics): opt-out consent slide with inline payload

Default is now keep-it-on, the exact payload is visible at the moment of
the decision rather than behind another command, and skip states its
effect. Motion is confined to the frame ornaments at 900ms, never under
text being read; reduced motion pins everything to the static petal."
```

---

## Task 6: One-time disclosure banner for upgraders

**Files:**

- Create: `apps/cli/src/app-shell/analytics-disclosure-banner.tsx`
- Create: `apps/cli/test/unit/app-shell/analytics-disclosure-banner.test.tsx`
- Modify: the shell root that reads `container.analyticsDisclosurePending` — find it with `rg -n "mountRootContent" apps/cli/src/app-shell/root-shell*.tsx`

**Interfaces:**

- Consumes: `container.analyticsDisclosurePending` (Task 4), `container.usageAnalytics.setConsent` (Task 3).
- Produces: `AnalyticsDisclosureBanner` component.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/analytics-disclosure-banner.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";

import { AnalyticsDisclosureBanner } from "@/app-shell/analytics-disclosure-banner";

describe("analytics disclosure banner", () => {
  test("says it is on and how to turn it off", () => {
    const { lastFrame } = render(<AnalyticsDisclosureBanner onDismiss={() => {}} />);
    expect(lastFrame()).toContain("on");
    expect(lastFrame()).toContain("/analytics");
  });

  test("lists the payload fields and the never-sent line", () => {
    const { lastFrame } = render(<AnalyticsDisclosureBanner onDismiss={() => {}} />);
    expect(lastFrame()).toContain("installId");
    expect(lastFrame()).toContain("Never:");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run test apps/cli/test/unit/app-shell/analytics-disclosure-banner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner**

Create `apps/cli/src/app-shell/analytics-disclosure-banner.tsx`:

```tsx
// =============================================================================
// analytics-disclosure-banner.tsx — the one-time notice for upgraders
//
// Users who never see the setup wizard sit at analytics: "unset" and would
// otherwise never be told. This is shown once, on the first interactive launch
// after upgrade, and never again. That run still sends nothing — the first-run
// rule applies here exactly as it does in the wizard.
// =============================================================================

import { Box, Text, useInput } from "ink";
import React from "react";

import { STATIC_PETAL } from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

export function AnalyticsDisclosureBanner({ onDismiss }: { readonly onDismiss: () => void }) {
  useInput((_input, key) => {
    if (key.return || key.escape) onDismiss();
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.accent}
      paddingX={1}
      marginY={1}
    >
      <Box>
        <Text color={palette.accent} bold>
          {STATIC_PETAL}
        </Text>
        <Text color={palette.text} bold>
          {"  Anonymous usage ping is on"}
        </Text>
      </Box>
      <Text color={palette.muted}>
        Once a day, Kunai sends installId, version, os, arch, ts — nothing else.
      </Text>
      <Text color={palette.dim} dimColor>
        Never: titles · queries · providers · URLs · paths
      </Text>
      <Text color={palette.muted}>Turn it off anytime with /analytics.</Text>
      <Text color={palette.dim} dimColor>
        Enter to dismiss
      </Text>
    </Box>
  );
}
```

- [ ] **Step 4: Mount it**

In the shell root that owns startup overlays, read the flag once on mount and persist on dismiss:

```tsx
const [showAnalyticsNotice, setShowAnalyticsNotice] = React.useState(
  () => container.analyticsDisclosurePending,
);

const dismissAnalyticsNotice = React.useCallback(() => {
  setShowAnalyticsNotice(false);
  container.analyticsDisclosurePending = false;
  // Dismissal is the disclosure. Persist the default; this run still sends
  // nothing — the ping starts on the next launch.
  void container.usageAnalytics.setConsent("enabled").catch(() => {
    // Analytics must never surface as a user-facing failure.
  });
}, [container]);
```

and render `{showAnalyticsNotice ? <AnalyticsDisclosureBanner onDismiss={dismissAnalyticsNotice} /> : null}` above the main content.

- [ ] **Step 5: Run the tests**

Run: `bun run test apps/cli/test/unit/app-shell/analytics-disclosure-banner.test.tsx && bun run typecheck`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(analytics): one-time disclosure banner for upgraders

Closes the gap where analytics: 'unset' had no resolution path outside
the setup wizard. Shown once on the first interactive launch; the run
that shows it still sends nothing."
```

---

## Task 7: `/analytics` command surfaces

**Files:**

- Modify: `apps/cli/src/app-shell/workflows/shell-workflows.ts:1333-1400`

**Interfaces:**

- Consumes: `container.usageAnalytics.describePayload()`, `.getStatus()`, `.setConsent()` (Task 3).
- Produces: nothing downstream.

- [ ] **Step 1: Rewrite both handlers**

`describePayload()` is now synchronous and performs no writes, so drop the `await`:

```ts
async function handleAnalyticsShow(container: Container): Promise<"handled"> {
  const payload = container.usageAnalytics.describePayload();
  const json = JSON.stringify(payload, null, 2);
  await chooseFromListShell({
    title: "Analytics payload",
    subtitle:
      "Exact JSON that would be sent. Never includes titles, queries, providers, URLs, or paths.",
    options: [
      {
        value: "ok" as const,
        label: json,
        detail: "Press Enter to close · change consent with /analytics",
      },
    ],
  });
  return "handled";
}

async function handleAnalytics(container: Container): Promise<"handled"> {
  const status = container.usageAnalytics.getStatus();
  const payload = container.usageAnalytics.describePayload();
  const subtitle = [
    `Status: ${status}`,
    "On by default · at most one ping per day.",
    "Fields: installId, version, os, arch, ts — never titles, queries, providers, URLs, or paths.",
    "Turning it off also deletes the install id from disk.",
    "DO_NOT_TRACK=1 and CI=true block sends regardless of this setting.",
  ].join("  ·  ");

  const choice = await chooseFromListShell({
    title: "Analytics",
    subtitle,
    options: [
      {
        value: "show" as const,
        label: "Show payload JSON",
        detail: JSON.stringify(payload),
      },
      {
        value: "enable" as const,
        label: status === "enabled" ? "Keep it on" : "Turn on anonymous usage ping",
        detail: "One ping / 24h · installId + version + os + arch + ts only",
      },
      {
        value: "disable" as const,
        label: status === "disabled" ? "Keep it off" : "Turn it off",
        detail: "No network calls · install id deleted from disk",
      },
    ],
  });

  if (choice === "show") return handleAnalyticsShow(container);
  if (choice === "enable") await container.usageAnalytics.setConsent("enabled");
  if (choice === "disable") await container.usageAnalytics.setConsent("disabled");
  return "handled";
}
```

Read lines 1380-1400 of the current file before replacing, and preserve whatever the existing code does after the choice (toast, re-render, return value) rather than assuming the shape above matches.

- [ ] **Step 2: Verify opening the menu writes nothing**

Add to `apps/cli/test/unit/services/analytics/usage-analytics-service.test.ts`:

```ts
test("rendering the menu twice creates no install id", () => {
  const config = makeConfig({ analytics: "unset", installId: "" });
  const service = makeService(config);
  service.describePayload();
  service.describePayload();
  expect(config.rawRef.installId).toBe("");
  expect(config.saveCount).toBe(0);
});
```

- [ ] **Step 3: Run the tests**

Run: `bun run test apps/cli/test/unit/services/analytics/ && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(analytics): /analytics menu reflects the opt-out default

Opening the menu no longer mints an install id, and the copy states that
turning it off deletes the id rather than only stopping sends."
```

---

## Task 8: Rename the ingest app and drop Redis

**Files:**

- Move: `apps/telemetry-ingest/` → `apps/analytics-ingest/`
- Modify: root `package.json:10` (workspace list)
- Delete: `apps/analytics-ingest/src/{redis-keys,upstash-client,upstash-stores,snapshot}.ts`
- Modify: `apps/analytics-ingest/package.json`

**Interfaces:**

- Consumes: nothing.
- Produces: the `@kunai/analytics-ingest` workspace with `@neondatabase/serverless` available.

- [ ] **Step 1: Move the app**

```bash
git mv apps/telemetry-ingest apps/analytics-ingest
```

Update root `package.json:10` from `"apps/telemetry-ingest"` to `"apps/analytics-ingest"`.

- [ ] **Step 2: Update the package manifest**

Replace the top of `apps/analytics-ingest/package.json`:

```json
{
  "name": "@kunai/analytics-ingest",
  "private": true,
  "description": "Minimal maintainer-owned Vercel ingest for Kunai anonymous usage pings.",
  "type": "module",
  "scripts": {
    "typecheck": "bun tsc --noEmit",
    "lint": "oxlint .",
    "fmt": "oxfmt --write .",
    "fmt:check": "oxfmt --check .",
    "test": "bun test test",
    "migrate": "bun run scripts/migrate.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.0"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "@types/node": "catalog:"
  },
  "peerDependencies": {
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 3: Delete the Redis layer**

```bash
git rm apps/analytics-ingest/src/redis-keys.ts \
       apps/analytics-ingest/src/upstash-client.ts \
       apps/analytics-ingest/src/upstash-stores.ts \
       apps/analytics-ingest/src/snapshot.ts
```

Typecheck will now fail across `runtime-config.ts`, `ingest.ts`, and the three API handlers. Tasks 9-12 rebuild them; leave it red until then.

- [ ] **Step 4: Install**

```bash
bun install
```

Expected: `@neondatabase/serverless` resolves. If `^1.0.0` does not exist, run `bun add @neondatabase/serverless --cwd apps/analytics-ingest` and use whatever version it pins.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ingest): rename to analytics-ingest and drop the Redis layer

Backend is being replaced by Postgres; the Upstash client, key layout,
and snapshot module go with it. Build is intentionally red until the
store lands."
```

---

## Task 9: Schema and migration

**Files:**

- Create: `apps/analytics-ingest/sql/001_init.sql`
- Create: `apps/analytics-ingest/scripts/migrate.ts`

**Interfaces:**

- Consumes: `DATABASE_URL`.
- Produces: tables `ping_day`, `install_lifetime`, `daily_rollup`.

- [ ] **Step 1: Write the schema**

Create `apps/analytics-ingest/sql/001_init.sql`:

```sql
-- Kunai usage analytics. Never store raw install UUIDs, IPs, titles, or queries.
--
-- ping_day.install_hash is HMAC-SHA256(ANALYTICS_HASH_SECRET, installId). The
-- primary key IS the once-per-install-per-day gate: an ON CONFLICT DO NOTHING
-- insert is atomic, which a separate claim-then-record pair was not.

create table if not exists ping_day (
  day          date        not null,
  install_hash bytea       not null,
  version      text        not null,
  os           text        not null,
  arch         text        not null,
  -- Ships empty. No wire field writes to it until a deliberate change opens
  -- one; the payload key-set check rejects a sixth key today.
  extra        jsonb       not null default '{}'::jsonb,
  first_seen   timestamptz not null default now(),
  primary key (day, install_hash)
);

create index if not exists ping_day_day_idx on ping_day (day);

-- One permanent hashed row per install, holding only a first-seen date. This
-- is a durable pseudonymous record where a HyperLogLog kept only a sketch —
-- it is what an exact lifetime count costs. Stated plainly in
-- .docs/analytics-privacy-contract.md rather than implied to be equivalent.
create table if not exists install_lifetime (
  install_hash bytea primary key,
  first_seen   date not null
);

-- Permanent, and contains no identity of any kind.
create table if not exists daily_rollup (
  day               date primary key,
  active_installs   integer     not null,
  by_version        jsonb       not null,
  by_os             jsonb       not null,
  by_arch           jsonb       not null,
  lifetime_installs integer     not null,
  computed_at       timestamptz not null default now()
);
```

- [ ] **Step 2: Write the migration runner**

Create `apps/analytics-ingest/scripts/migrate.ts`:

```ts
/** Applies sql/*.sql in filename order. Idempotent: every statement is IF NOT EXISTS. */
import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(connectionString);
const sqlDir = join(import.meta.dir, "..", "sql");

for (const file of readdirSync(sqlDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  const body = readFileSync(join(sqlDir, file), "utf8");
  // Split on statement boundaries: the HTTP driver takes one statement per call.
  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const statement of statements) {
    await sql.query(statement);
  }
  console.log(`applied ${file} (${statements.length} statements)`);
}
```

- [ ] **Step 3: Apply it**

```bash
DATABASE_URL="<your neon pooled url>" bun run --cwd apps/analytics-ingest migrate
```

Expected: `applied 001_init.sql (5 statements)`. Run it twice to confirm idempotency.

- [ ] **Step 4: Commit**

```bash
git add apps/analytics-ingest/sql apps/analytics-ingest/scripts
git commit -m "feat(ingest): postgres schema

The (day, install_hash) primary key is the idempotency gate. Raw rows are
pruned at 35 days; daily_rollup is permanent and identity-free."
```

---

## Task 10: `AnalyticsStore` port, memory implementation, and the new ingest

**Files:**

- Create: `apps/analytics-ingest/src/store.ts`, `src/memory-store.ts`
- Rewrite: `apps/analytics-ingest/src/ingest.ts`
- Rewrite: `apps/analytics-ingest/test/ingest.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type DailyRollup = { day; activeInstalls; byVersion; byOs; byArch; lifetimeInstalls }`
  - `type RecordPingInput = { day; installHash; version; os; arch }`
  - `type AnalyticsStore = { recordPing; rollUpDay; readRollup; readRollups; pruneRawBefore }`
  - `createMemoryAnalyticsStore()`
  - `ingestAnalyticsPing({ method, body, hashSecret, store, now? })`
  - `ANALYTICS_PAYLOAD_KEYS`, `MAX_BODY_BYTES`, `TS_SKEW_MS`, `hashInstallId`, `parseAnalyticsPayload`, `utcDayKey`, `isTimestampSkewed`

- [ ] **Step 1: Define the port**

Create `apps/analytics-ingest/src/store.ts`:

```ts
/**
 * One port. The four it replaces (RateLimitStore, InstallDayGate,
 * DailyDistinctStore, LifetimeStore) were Redis data structures wearing
 * domain names — a TTL key, a SET, and a HyperLogLog. Postgres needs one
 * table and one upsert, so it needs one port.
 */

export type DailyRollup = {
  readonly day: string;
  readonly activeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  readonly lifetimeInstalls: number;
};

export type RecordPingInput = {
  readonly day: string;
  readonly installHash: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
};

export type AnalyticsStore = {
  /** Idempotent per (day, installHash). Repeat calls are a no-op. */
  recordPing(input: RecordPingInput): Promise<void>;
  /** Compute the day's rollup from raw rows and persist it. */
  rollUpDay(day: string): Promise<DailyRollup>;
  readRollup(day: string): Promise<DailyRollup | null>;
  /** Inclusive range, ascending by day. Admin surface only. */
  readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]>;
  /** Deletes raw rows strictly older than `day`. Returns the row count. */
  pruneRawBefore(day: string): Promise<number>;
};

export function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = key(row);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}
```

- [ ] **Step 2: Implement the memory store**

Create `apps/analytics-ingest/src/memory-store.ts`:

```ts
import { countBy, type AnalyticsStore, type DailyRollup, type RecordPingInput } from "./store";

/** In-process test double. Mirrors the Postgres semantics, including idempotency. */
export function createMemoryAnalyticsStore(): AnalyticsStore & {
  readonly rawCount: () => number;
} {
  const raw = new Map<string, RecordPingInput>();
  const lifetime = new Set<string>();
  const rollups = new Map<string, DailyRollup>();

  const keyOf = (day: string, hash: string) => `${day}::${hash}`;

  return {
    async recordPing(input) {
      const key = keyOf(input.day, input.installHash);
      if (raw.has(key)) return;
      raw.set(key, input);
      lifetime.add(input.installHash);
    },
    async rollUpDay(day) {
      const rows = [...raw.values()].filter((row) => row.day === day);
      const rollup: DailyRollup = {
        day,
        activeInstalls: rows.length,
        byVersion: countBy(rows, (row) => row.version),
        byOs: countBy(rows, (row) => row.os),
        byArch: countBy(rows, (row) => row.arch),
        lifetimeInstalls: lifetime.size,
      };
      rollups.set(day, rollup);
      return rollup;
    },
    async readRollup(day) {
      return rollups.get(day) ?? null;
    },
    async readRollups(fromDay, toDay) {
      return [...rollups.values()]
        .filter((r) => r.day >= fromDay && r.day <= toDay)
        .sort((a, b) => a.day.localeCompare(b.day));
    },
    async pruneRawBefore(day) {
      let removed = 0;
      for (const [key, row] of raw) {
        if (row.day < day) {
          raw.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    rawCount: () => raw.size,
  };
}
```

- [ ] **Step 3: Write the failing ingest test**

Replace `apps/analytics-ingest/test/ingest.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { createMemoryAnalyticsStore } from "../src/memory-store";
import {
  ANALYTICS_PAYLOAD_KEYS,
  hashInstallId,
  ingestAnalyticsPing,
  isTimestampSkewed,
  parseAnalyticsPayload,
  TS_SKEW_MS,
  utcDayKey,
} from "../src/ingest";

const HASH_SECRET = "test-analytics-hash-secret-not-for-prod";
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

const valid = {
  installId: "11111111-2222-4333-8444-555555555555",
  version: "0.3.0",
  os: "linux",
  arch: "x64",
  ts: NOW,
};

describe("payload contract", () => {
  test("accepts only the exact five keys", () => {
    expect(Object.keys(valid).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(parseAnalyticsPayload(valid)).toEqual(valid);
    expect(parseAnalyticsPayload({ ...valid, title: "nope" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, extra: {} })).toBeNull();
    const { arch: _arch, ...missing } = valid;
    expect(parseAnalyticsPayload(missing)).toBeNull();
  });

  test("rejects dimension values outside the allowlists", () => {
    expect(parseAnalyticsPayload({ ...valid, os: "haiku" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, arch: "sparc" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, version: "not-semver" })).toBeNull();
  });

  test("hashInstallId is HMAC-SHA256 hex and never contains the raw UUID", () => {
    const hashed = hashInstallId(HASH_SECRET, valid.installId);
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toContain(valid.installId);
    expect(hashed).toBe(
      createHmac("sha256", HASH_SECRET).update(valid.installId, "utf8").digest("hex"),
    );
  });

  test("rejects clock skew beyond 24h", () => {
    expect(isTimestampSkewed(NOW, NOW)).toBe(false);
    expect(isTimestampSkewed(NOW - TS_SKEW_MS - 1, NOW)).toBe(true);
  });
});

describe("ingestAnalyticsPing", () => {
  test("records one row and counts it", async () => {
    const store = createMemoryAnalyticsStore();
    const result = await ingestAnalyticsPing({
      method: "POST",
      body: valid,
      hashSecret: HASH_SECRET,
      store,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, day: utcDayKey(NOW) });
    expect(store.rawCount()).toBe(1);
  });

  test("two pings from the same install on the same day yield one row", async () => {
    const store = createMemoryAnalyticsStore();
    for (let i = 0; i < 5; i += 1) {
      await ingestAnalyticsPing({
        method: "POST",
        body: valid,
        hashSecret: HASH_SECRET,
        store,
        now: NOW,
      });
    }
    expect(store.rawCount()).toBe(1);
    const rollup = await store.rollUpDay(utcDayKey(NOW));
    expect(rollup.activeInstalls).toBe(1);
  });

  test("dimensions actually reach the rollup", async () => {
    const store = createMemoryAnalyticsStore();
    const installs = [
      { ...valid, installId: "aaaaaaaa-2222-4333-8444-555555555555", os: "darwin" },
      { ...valid, installId: "bbbbbbbb-2222-4333-8444-555555555555", version: "0.2.5" },
    ];
    for (const body of [valid, ...installs]) {
      await ingestAnalyticsPing({ method: "POST", body, hashSecret: HASH_SECRET, store, now: NOW });
    }
    const rollup = await store.rollUpDay(utcDayKey(NOW));
    expect(rollup.activeInstalls).toBe(3);
    expect(rollup.byVersion).toEqual({ "0.3.0": 2, "0.2.5": 1 });
    expect(rollup.byOs).toEqual({ linux: 2, darwin: 1 });
    expect(rollup.lifetimeInstalls).toBe(3);
  });

  test("rejects non-POST and a missing secret", async () => {
    const store = createMemoryAnalyticsStore();
    await expect(
      ingestAnalyticsPing({ method: "GET", body: valid, hashSecret: HASH_SECRET, store, now: NOW }),
    ).resolves.toEqual({ ok: false, status: 405, error: "method_not_allowed" });
    await expect(
      ingestAnalyticsPing({ method: "POST", body: valid, hashSecret: "", store, now: NOW }),
    ).resolves.toEqual({ ok: false, status: 503, error: "misconfigured" });
  });
});

describe("retention", () => {
  test("pruneRawBefore removes only older days", async () => {
    const store = createMemoryAnalyticsStore();
    await store.recordPing({
      day: "2026-06-01",
      installHash: "old",
      version: "0.3.0",
      os: "linux",
      arch: "x64",
    });
    await store.recordPing({
      day: "2026-08-14",
      installHash: "new",
      version: "0.3.0",
      os: "linux",
      arch: "x64",
    });
    expect(await store.pruneRawBefore("2026-07-10")).toBe(1);
    expect(store.rawCount()).toBe(1);
  });
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `bun run --cwd apps/analytics-ingest test`
Expected: FAIL — `ingestAnalyticsPing` and `parseAnalyticsPayload` do not exist.

- [ ] **Step 5: Rewrite the ingest**

Replace `apps/analytics-ingest/src/ingest.ts`:

```ts
/**
 * Anonymous usage ingest — privacy contract
 *
 * Accepts POST bodies shaped exactly as:
 *   { installId, version, os, arch, ts }
 *
 * Stores only:
 * - ping_day: HMAC(installId) + version/os/arch, 35-day retention
 * - install_lifetime: HMAC(installId) + first-seen date, permanent
 * - daily_rollup: aggregate counts, permanent, no identity
 *
 * Never stores or accepts: raw install UUIDs, IP addresses, titles, queries,
 * provider results, URLs, or file paths. This module never reads a client IP
 * at all — there is no rate-limit key to derive one for.
 *
 * `version`, `os`, and `arch` are aggregation keys, validated against strict
 * semver and closed allowlists so a hostile client cannot inject a fabricated
 * dimension into published aggregates. Unlike the previous revision, they are
 * actually stored and grouped.
 *
 * Abuse model: a hostile client can mint many install ids and inflate counts.
 * The (day, install_hash) primary key caps a real install at one row per day.
 * No one can expose another user's watch history — that data is never accepted.
 */

import { createHmac } from "node:crypto";

import { isAllowedArch, isAllowedOs, isValidVersion } from "./payload-validation";
import type { AnalyticsStore } from "./store";

export const ANALYTICS_PAYLOAD_KEYS = ["arch", "installId", "os", "ts", "version"] as const;

/** Reject client clocks more than ±24h from server time. */
export const TS_SKEW_MS = 24 * 60 * 60 * 1000;

export const MAX_BODY_BYTES = 512;

/** Raw dimension rows live this long; rollups are permanent. */
export const RAW_RETENTION_DAYS = 35;

export type AnalyticsIngestPayload = {
  readonly installId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly ts: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function parseAnalyticsPayload(body: unknown): AnalyticsIngestPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== ANALYTICS_PAYLOAD_KEYS.length) return null;
  for (let i = 0; i < ANALYTICS_PAYLOAD_KEYS.length; i += 1) {
    if (keys[i] !== ANALYTICS_PAYLOAD_KEYS[i]) return null;
  }
  const installId = typeof record.installId === "string" ? record.installId.trim() : "";
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const os = typeof record.os === "string" ? record.os.trim() : "";
  const arch = typeof record.arch === "string" ? record.arch.trim() : "";
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : NaN;
  if (!UUID_RE.test(installId)) return null;
  if (!isValidVersion(version)) return null;
  if (!isAllowedOs(os)) return null;
  if (!isAllowedArch(arch)) return null;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return { installId, version, os, arch, ts };
}

export function hashInstallId(secret: string, installId: string): string {
  return createHmac("sha256", secret).update(installId, "utf8").digest("hex");
}

export function isTimestampSkewed(clientTs: number, now: number, skewMs = TS_SKEW_MS): boolean {
  return Math.abs(clientTs - now) > skewMs;
}

export type IngestResult =
  | { readonly ok: true; readonly day: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

export async function ingestAnalyticsPing(input: {
  readonly method: string;
  readonly body: unknown;
  readonly hashSecret: string;
  readonly store: AnalyticsStore;
  readonly now?: number;
}): Promise<IngestResult> {
  if (input.method !== "POST") {
    return { ok: false, status: 405, error: "method_not_allowed" };
  }
  if (!input.hashSecret.trim()) {
    return { ok: false, status: 503, error: "misconfigured" };
  }
  const now = input.now ?? Date.now();
  const payload = parseAnalyticsPayload(input.body);
  if (!payload) {
    return { ok: false, status: 400, error: "invalid_payload" };
  }
  if (isTimestampSkewed(payload.ts, now)) {
    return { ok: false, status: 400, error: "timestamp_skew" };
  }

  const day = utcDayKey(now);
  // The store's (day, install_hash) key is the once-per-day gate. There is no
  // separate claim step to race against.
  await input.store.recordPing({
    day,
    installHash: hashInstallId(input.hashSecret, payload.installId),
    version: payload.version,
    os: payload.os,
    arch: payload.arch,
  });

  return { ok: true, day };
}
```

- [ ] **Step 6: Run the tests**

Run: `bun run --cwd apps/analytics-ingest test`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ingest): one AnalyticsStore port and a dimension-storing ingest

version/os/arch were validated then discarded; they now reach the rollup.
The (day, install_hash) key replaces the non-atomic claim-then-record
pair, and rate limiting leaves the code entirely -- the in-memory limiter
was per-instance on serverless and reset on every cold start."
```

---

## Task 11: Postgres store

**Files:**

- Create: `apps/analytics-ingest/src/postgres-store.ts`
- Rewrite: `apps/analytics-ingest/src/runtime-config.ts`
- Create: `apps/analytics-ingest/test/postgres-store.test.ts` (skipped without `DATABASE_URL`)

**Interfaces:**

- Consumes: `AnalyticsStore`, `DailyRollup`, `RecordPingInput` (Task 10).
- Produces: `createPostgresAnalyticsStore(connectionString)`, `loadAnalyticsRuntimeConfig(env)` returning `{ hashSecret, cronSecret, adminToken, store }`.

- [ ] **Step 1: Implement the store**

Create `apps/analytics-ingest/src/postgres-store.ts`:

```ts
import { neon } from "@neondatabase/serverless";

import type { AnalyticsStore, DailyRollup, RecordPingInput } from "./store";

type CountRow = { readonly bucket: string; readonly n: number };

function toCounts(rows: readonly CountRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.bucket] = Number(row.n);
  return counts;
}

export function createPostgresAnalyticsStore(connectionString: string): AnalyticsStore {
  const sql = neon(connectionString);

  return {
    async recordPing(input: RecordPingInput): Promise<void> {
      const hash = Buffer.from(input.installHash, "hex");
      // Idempotent by primary key. This single statement is the once-per-day gate.
      await sql.query(
        `insert into ping_day (day, install_hash, version, os, arch)
         values ($1, $2, $3, $4, $5)
         on conflict (day, install_hash) do nothing`,
        [input.day, hash, input.version, input.os, input.arch],
      );
      await sql.query(
        `insert into install_lifetime (install_hash, first_seen)
         values ($1, $2)
         on conflict (install_hash) do nothing`,
        [hash, input.day],
      );
    },

    async rollUpDay(day: string): Promise<DailyRollup> {
      const [active] = (await sql.query(`select count(*)::int as n from ping_day where day = $1`, [
        day,
      ])) as { n: number }[];
      const [lifetime] = (await sql.query(`select count(*)::int as n from install_lifetime`)) as {
        n: number;
      }[];

      const grouped = async (column: "version" | "os" | "arch") =>
        toCounts(
          (await sql.query(
            `select ${column} as bucket, count(*)::int as n
             from ping_day where day = $1 group by ${column}`,
            [day],
          )) as CountRow[],
        );

      const rollup: DailyRollup = {
        day,
        activeInstalls: Number(active?.n ?? 0),
        byVersion: await grouped("version"),
        byOs: await grouped("os"),
        byArch: await grouped("arch"),
        lifetimeInstalls: Number(lifetime?.n ?? 0),
      };

      await sql.query(
        `insert into daily_rollup
           (day, active_installs, by_version, by_os, by_arch, lifetime_installs, computed_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (day) do update set
           active_installs = excluded.active_installs,
           by_version = excluded.by_version,
           by_os = excluded.by_os,
           by_arch = excluded.by_arch,
           lifetime_installs = excluded.lifetime_installs,
           computed_at = now()`,
        [
          rollup.day,
          rollup.activeInstalls,
          JSON.stringify(rollup.byVersion),
          JSON.stringify(rollup.byOs),
          JSON.stringify(rollup.byArch),
          rollup.lifetimeInstalls,
        ],
      );

      return rollup;
    },

    async readRollup(day: string): Promise<DailyRollup | null> {
      const rows = (await sql.query(
        `select day::text, active_installs, by_version, by_os, by_arch, lifetime_installs
         from daily_rollup where day = $1`,
        [day],
      )) as Record<string, unknown>[];
      const row = rows[0];
      if (!row) return null;
      return {
        day: String(row.day),
        activeInstalls: Number(row.active_installs),
        byVersion: row.by_version as Record<string, number>,
        byOs: row.by_os as Record<string, number>,
        byArch: row.by_arch as Record<string, number>,
        lifetimeInstalls: Number(row.lifetime_installs),
      };
    },

    async readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]> {
      const rows = (await sql.query(
        `select day::text, active_installs, by_version, by_os, by_arch, lifetime_installs
         from daily_rollup where day >= $1 and day <= $2 order by day asc`,
        [fromDay, toDay],
      )) as Record<string, unknown>[];
      return rows.map((row) => ({
        day: String(row.day),
        activeInstalls: Number(row.active_installs),
        byVersion: row.by_version as Record<string, number>,
        byOs: row.by_os as Record<string, number>,
        byArch: row.by_arch as Record<string, number>,
        lifetimeInstalls: Number(row.lifetime_installs),
      }));
    },

    async pruneRawBefore(day: string): Promise<number> {
      const rows = (await sql.query(
        `with deleted as (delete from ping_day where day < $1 returning 1)
         select count(*)::int as n from deleted`,
        [day],
      )) as { n: number }[];
      return Number(rows[0]?.n ?? 0);
    },
  };
}
```

- [ ] **Step 2: Rewrite the runtime config**

Replace `apps/analytics-ingest/src/runtime-config.ts`:

```ts
import { createPostgresAnalyticsStore } from "./postgres-store";
import type { AnalyticsStore } from "./store";

export type AnalyticsRuntimeConfig = {
  readonly hashSecret: string;
  readonly cronSecret: string;
  readonly adminToken: string;
  readonly store: AnalyticsStore;
};

export type AnalyticsEnv = {
  readonly DATABASE_URL?: string;
  readonly ANALYTICS_HASH_SECRET?: string;
  readonly CRON_SECRET?: string;
  readonly ANALYTICS_ADMIN_TOKEN?: string;
  readonly [key: string]: string | undefined;
};

export function loadAnalyticsRuntimeConfig(
  env: AnalyticsEnv = process.env as AnalyticsEnv,
): AnalyticsRuntimeConfig | null {
  const connectionString = env.DATABASE_URL?.trim() ?? "";
  const hashSecret = env.ANALYTICS_HASH_SECRET?.trim() ?? "";
  if (!connectionString || !hashSecret) return null;
  return {
    hashSecret,
    cronSecret: env.CRON_SECRET?.trim() ?? "",
    adminToken: env.ANALYTICS_ADMIN_TOKEN?.trim() ?? "",
    store: createPostgresAnalyticsStore(connectionString),
  };
}
```

Update `apps/analytics-ingest/test/runtime-config.test.ts` to the new env names and shape — read the existing file and mirror its structure, swapping `UPSTASH_*` for `DATABASE_URL` and `TELEMETRY_HASH_SECRET` for `ANALYTICS_HASH_SECRET`.

- [ ] **Step 3: Write the integration test**

Create `apps/analytics-ingest/test/postgres-store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { createPostgresAnalyticsStore } from "../src/postgres-store";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

// Runs only when a scratch database is configured. Never point this at a
// database holding real aggregates: it writes and prunes.
describe.skipIf(!DATABASE_URL)("postgres store", () => {
  test("recordPing is idempotent per (day, installHash)", async () => {
    const store = createPostgresAnalyticsStore(DATABASE_URL!);
    const day = "1999-01-01";
    const installHash = "a".repeat(64);
    await store.pruneRawBefore("1999-01-02");

    for (let i = 0; i < 3; i += 1) {
      await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    }

    const rollup = await store.rollUpDay(day);
    expect(rollup.activeInstalls).toBe(1);
    expect(rollup.byVersion).toEqual({ "0.3.0": 1 });

    expect(await store.pruneRawBefore("1999-01-02")).toBe(1);
  });
});
```

- [ ] **Step 4: Run it**

```bash
bun run --cwd apps/analytics-ingest typecheck
DATABASE_URL="<neon scratch url>" bun run --cwd apps/analytics-ingest test
```

Expected: PASS. Without `DATABASE_URL` the Postgres suite skips and the rest still passes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ingest): neon postgres store

Aggregates are GROUP BY, so a new question needs no new key layout.
Retention is one DELETE. Postgres suite skips without DATABASE_URL."
```

---

## Task 12: Public metrics v2, cron, and admin endpoint

**Files:**

- Create: `apps/analytics-ingest/src/public-metrics.ts`
- Rewrite: `apps/analytics-ingest/api/ping.ts`, `api/cron/snapshot.ts`, `api/metrics/daily.ts`
- Create: `apps/analytics-ingest/api/metrics/admin.ts`
- Create: `apps/analytics-ingest/test/public-metrics.test.ts`
- Modify: `apps/analytics-ingest/vercel.json`

**Interfaces:**

- Consumes: `DailyRollup` (Task 10), `loadAnalyticsRuntimeConfig` (Task 11).
- Produces: `METRICS_SCHEMA_VERSION = 2`, `K_ANONYMITY_FLOOR = 5`, `suppressSmallBuckets`, `buildPublicMetrics`, `parsePublicMetrics`, `PublicAnalyticsMetrics`, `PUBLIC_METRICS_CACHE_CONTROL`.

- [ ] **Step 1: Write the failing test**

Create `apps/analytics-ingest/test/public-metrics.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  buildPublicMetrics,
  K_ANONYMITY_FLOOR,
  METRICS_SCHEMA_VERSION,
  parsePublicMetrics,
  suppressSmallBuckets,
} from "../src/public-metrics";

const rollup = {
  day: "2026-08-13",
  activeInstalls: 128,
  byVersion: { "0.3.0": 96, "0.2.5": 30, "0.1.0": 2 },
  byOs: { linux: 80, darwin: 44, win32: 4 },
  byArch: { x64: 96, arm64: 32 },
  lifetimeInstalls: 512,
};

describe("k-anonymity", () => {
  test("floor is 5", () => {
    expect(K_ANONYMITY_FLOOR).toBe(5);
  });

  test("buckets under the floor fold into other", () => {
    expect(suppressSmallBuckets({ a: 10, b: 3, c: 1 })).toEqual({ a: 10, other: 4 });
  });

  test("no other key when nothing is suppressed", () => {
    expect(suppressSmallBuckets({ a: 10, b: 7 })).toEqual({ a: 10, b: 7 });
  });

  test("suppression never changes the total", () => {
    const before = Object.values(rollup.byOs).reduce((a, b) => a + b, 0);
    const after = Object.values(suppressSmallBuckets(rollup.byOs)).reduce((a, b) => a + b, 0);
    expect(after).toBe(before);
  });
});

describe("public metrics v2", () => {
  test("suppresses small buckets and drops lifetimeMethod", () => {
    const metrics = buildPublicMetrics(rollup, "2026-08-14T00:05:00.000Z");
    expect(metrics.schemaVersion).toBe(2);
    expect(metrics.byVersion).toEqual({ "0.3.0": 96, "0.2.5": 30, other: 2 });
    expect(metrics.byOs).toEqual({ linux: 80, darwin: 44, other: 4 });
    expect(metrics).not.toHaveProperty("lifetimeMethod");
  });

  test("round-trips through parse", () => {
    const metrics = buildPublicMetrics(rollup, "2026-08-14T00:05:00.000Z");
    expect(parsePublicMetrics(JSON.parse(JSON.stringify(metrics)))).toEqual(metrics);
  });

  test("rejects a v1 snapshot and any unexpected key", () => {
    expect(
      parsePublicMetrics({
        schemaVersion: 1,
        day: "2026-08-13",
        activeInstalls: 1,
        lifetimeInstallsApprox: 1,
        lifetimeMethod: "hyperloglog",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
    ).toBeNull();

    const metrics = buildPublicMetrics(rollup, "2026-08-14T00:05:00.000Z");
    expect(parsePublicMetrics({ ...metrics, sneaky: 1 })).toBeNull();
  });

  test("schema version constant is 2", () => {
    expect(METRICS_SCHEMA_VERSION).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run --cwd apps/analytics-ingest test test/public-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement public metrics**

Create `apps/analytics-ingest/src/public-metrics.ts`:

```ts
import type { DailyRollup } from "./store";

export const METRICS_SCHEMA_VERSION = 2;

/**
 * Any dimension bucket smaller than this folds into "other".
 *
 * byVersion + byOs + byArch published together identify a single user on an
 * unusual combination in a small population. This is the cost of aggregating
 * dimensions at all, and the floor is the standard answer to it.
 */
export const K_ANONYMITY_FLOOR = 5;

/**
 * The snapshot is rewritten once per day by cron, so a CDN may safely serve a
 * stale copy for a full day while it revalidates. Without the stale window,
 * every shared-cache expiry stampedes the origin.
 */
export const PUBLIC_METRICS_CACHE_CONTROL =
  "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400";

export type PublicAnalyticsMetrics = {
  readonly schemaVersion: typeof METRICS_SCHEMA_VERSION;
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  readonly updatedAt: string;
};

/** Totals are preserved: suppressed counts move into "other", they are not dropped. */
export function suppressSmallBuckets(
  counts: Readonly<Record<string, number>>,
  floor = K_ANONYMITY_FLOOR,
): Record<string, number> {
  const kept: Record<string, number> = {};
  let other = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    if (count < floor) other += count;
    else kept[bucket] = count;
  }
  if (other > 0) kept.other = other;
  return kept;
}

export function buildPublicMetrics(rollup: DailyRollup, updatedAt: string): PublicAnalyticsMetrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: rollup.day,
    activeInstalls: Math.max(0, Math.floor(rollup.activeInstalls)),
    lifetimeInstalls: Math.max(0, Math.floor(rollup.lifetimeInstalls)),
    byVersion: suppressSmallBuckets(rollup.byVersion),
    byOs: suppressSmallBuckets(rollup.byOs),
    byArch: suppressSmallBuckets(rollup.byArch),
    updatedAt,
  };
}

const PUBLIC_METRICS_KEYS = [
  "activeInstalls",
  "byArch",
  "byOs",
  "byVersion",
  "day",
  "lifetimeInstalls",
  "schemaVersion",
  "updatedAt",
] as const;

function isCountMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
}

export function parsePublicMetrics(raw: unknown): PublicAnalyticsMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== PUBLIC_METRICS_KEYS.length) return null;
  for (let i = 0; i < PUBLIC_METRICS_KEYS.length; i += 1) {
    if (keys[i] !== PUBLIC_METRICS_KEYS[i]) return null;
  }
  if (record.schemaVersion !== METRICS_SCHEMA_VERSION) return null;
  if (typeof record.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.day)) return null;
  if (typeof record.activeInstalls !== "number" || record.activeInstalls < 0) return null;
  if (typeof record.lifetimeInstalls !== "number" || record.lifetimeInstalls < 0) return null;
  if (!isCountMap(record.byVersion)) return null;
  if (!isCountMap(record.byOs)) return null;
  if (!isCountMap(record.byArch)) return null;
  if (typeof record.updatedAt !== "string" || !record.updatedAt) return null;
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: record.day,
    activeInstalls: Math.floor(record.activeInstalls),
    lifetimeInstalls: Math.floor(record.lifetimeInstalls),
    byVersion: record.byVersion,
    byOs: record.byOs,
    byArch: record.byArch,
    updatedAt: record.updatedAt,
  };
}

/** Prefer yesterday's rollup for the public "active installs" line. */
export function snapshotDayKey(now = Date.now()): string {
  return new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Rewrite `api/ping.ts`**

Replace the whole file. The changes from the current version: `clientIpKey` is gone, there is no rate-limit store, and the runtime config is the new shape.

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

import { ingestAnalyticsPing, MAX_BODY_BYTES } from "../src/ingest";
import { loadAnalyticsRuntimeConfig } from "../src/runtime-config";

async function readJsonBodyLimited(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; error: "body_too_large" | "invalid_json" }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) return { ok: false, error: "body_too_large" };
    chunks.push(buf);
  }
  if (chunks.length === 0) return { ok: true, body: null };
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown> | null,
): void {
  // No CORS headers — the CLI does not need them; blocks casual browser spam.
  res.setHeader("Cache-Control", "no-store");
  if (payload) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return;
  }
  res.statusCode = status;
  res.end();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime) {
    sendJson(res, 503, { ok: false, error: "misconfigured" });
    return;
  }

  const method = req.method ?? "GET";
  if (method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const parsed = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    sendJson(res, 400, {
      ok: false,
      error: parsed.error === "body_too_large" ? "body_too_large" : "invalid_payload",
    });
    return;
  }

  try {
    const result = await ingestAnalyticsPing({
      method,
      body: parsed.body,
      hashSecret: runtime.hashSecret,
      store: runtime.store,
    });
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return;
    }
    // 204 empty — do not leak counts to clients.
    sendJson(res, 204, null);
  } catch {
    sendJson(res, 503, { ok: false, error: "upstream_unavailable" });
  }
}
```

- [ ] **Step 5: Rewrite the cron handler**

In `apps/analytics-ingest/api/cron/snapshot.ts`, keep the existing `authorize` and `unauthorized` helpers verbatim and replace only `loadTelemetryRuntimeConfig` with `loadAnalyticsRuntimeConfig` and the body of the `try` block:

```ts
try {
  const day = snapshotDayKey();
  const rollup = await runtime.store.rollUpDay(day);
  const metrics = buildPublicMetrics(rollup, new Date().toISOString());

  // Raw dimension rows past retention go now; the rollup above already
  // captured everything the public JSON and the admin view need.
  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const pruned = await runtime.store.pruneRawBefore(cutoff);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 200;
  // Operators only — not public; cron secret required.
  res.end(JSON.stringify({ ok: true, metrics, pruned }));
} catch {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 503;
  res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
}
```

with imports:

```ts
import { RAW_RETENTION_DAYS } from "../../src/ingest";
import { buildPublicMetrics, snapshotDayKey } from "../../src/public-metrics";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config";
```

- [ ] **Step 6: Rewrite the public metrics handler**

In `apps/analytics-ingest/api/metrics/daily.ts`, keep the method guard and error shapes; replace the read with a rollup read plus suppression:

```ts
try {
  const rollup = await runtime.store.readRollup(snapshotDayKey());
  if (!rollup) {
    res.statusCode = 404;
    res.setHeader("Cache-Control", "public, s-maxage=60, max-age=60");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "not_ready" }));
    return;
  }
  res.statusCode = 200;
  res.setHeader("Cache-Control", PUBLIC_METRICS_CACHE_CONTROL);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(buildPublicMetrics(rollup, new Date().toISOString())));
} catch {
  res.statusCode = 503;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
}
```

- [ ] **Step 7: Add the admin endpoint**

Create `apps/analytics-ingest/api/metrics/admin.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

import { snapshotDayKey } from "../../src/public-metrics";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config";

/**
 * Unsuppressed rollups for the maintainer. Never linked from the docs site and
 * never cached. Still contains no identity — rollups hold counts only — but the
 * k-anonymity floor does not apply here, so it stays behind a token.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime || !runtime.adminToken) {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
    return;
  }

  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!match || match[1] !== runtime.adminToken) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  try {
    const to = snapshotDayKey();
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    res.statusCode = 200;
    res.end(
      JSON.stringify({ ok: true, from, to, rollups: await runtime.store.readRollups(from, to) }),
    );
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
```

- [ ] **Step 8: Register the admin function**

In `apps/analytics-ingest/vercel.json`, add to `functions`:

```json
    "api/metrics/admin.ts": {
      "maxDuration": 10
    }
```

Leave the `/metrics/daily.json` rewrite and the cron entry as they are.

- [ ] **Step 9: Run everything**

```bash
bun run --cwd apps/analytics-ingest typecheck
bun run --cwd apps/analytics-ingest test
```

Expected: PASS, including 8 new public-metrics tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(ingest): v2 public metrics with dimension breakdowns

Drops lifetimeMethod: a storage detail that leaked into a public wire
format, and now exact rather than approximate. Buckets under 5 fold into
'other' -- version x os x arch published together identifies a single
user on an odd combination in a small population. Adds a token-guarded
admin endpoint reading unsuppressed rollups."
```

---

## Task 13: Docs site on v2

**Files:**

- Move: `apps/docs/lib/telemetry-metrics.ts` → `apps/docs/lib/analytics-metrics.ts`
- Move: `apps/docs/components/telemetry/opt-in-usage-panel.tsx` → `apps/docs/components/analytics/usage-panel.tsx`
- Move: `apps/docs/components/home/opt-in-telemetry-line.tsx` → `apps/docs/components/home/usage-line.tsx`
- Modify: `apps/docs/app/telemetry/page.tsx`, `apps/docs/app/(home)/page.tsx`
- Rewrite: `apps/docs/test/telemetry-metrics.test.ts` → `analytics-metrics.test.ts`
- Modify: `apps/docs/test/opt-in-usage-panel.test.tsx` → `usage-panel.test.tsx`

The route stays `/telemetry`. See the decision note at the top of this plan — `sitemap.ts`, `llms.txt/route.ts`, `doc-navigation.ts`, and `layout.shared.tsx` keep their URLs; only their **copy** changes from "Opt-in telemetry" to "Usage analytics".

**Interfaces:**

- Consumes: the v2 JSON produced by Task 12.
- Produces: `DocsAnalyticsMetrics`, `fetchDocsAnalyticsMetrics`, `parseDocsAnalyticsMetrics`, `formatUsageLine`.

- [ ] **Step 1: Write the failing test**

Create `apps/docs/test/analytics-metrics.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { formatUsageLine, parseDocsAnalyticsMetrics } from "../lib/analytics-metrics";

const v2 = {
  schemaVersion: 2,
  day: "2026-08-13",
  activeInstalls: 128,
  lifetimeInstalls: 512,
  byVersion: { "0.3.0": 96, other: 32 },
  byOs: { linux: 80, darwin: 48 },
  byArch: { x64: 96, arm64: 32 },
  updatedAt: "2026-08-14T00:05:00.000Z",
};

describe("docs analytics metrics", () => {
  test("accepts a v2 snapshot", () => {
    expect(parseDocsAnalyticsMetrics(v2)).toEqual(v2);
  });

  test("rejects v1 and unexpected keys", () => {
    expect(
      parseDocsAnalyticsMetrics({
        schemaVersion: 1,
        day: "2026-08-13",
        activeInstalls: 1,
        lifetimeInstallsApprox: 1,
        lifetimeMethod: "hyperloglog",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
    ).toBeNull();
    expect(parseDocsAnalyticsMetrics({ ...v2, sneaky: 1 })).toBeNull();
  });

  test("the home line names both numbers", () => {
    expect(formatUsageLine(v2)).toContain("128");
    expect(formatUsageLine(v2)).toContain("512");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run --cwd apps/docs test test/analytics-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the lib**

```bash
git mv apps/docs/lib/telemetry-metrics.ts apps/docs/lib/analytics-metrics.ts
git rm apps/docs/test/telemetry-metrics.test.ts
```

Then rewrite `apps/docs/lib/analytics-metrics.ts` to the v2 shape, mirroring `parsePublicMetrics` from Task 12 — same exact-key-set check, same `isCountMap` guard. Rename the exported symbols:

- `DEFAULT_TELEMETRY_METRICS_URL` → `DEFAULT_ANALYTICS_METRICS_URL = "https://kunai-analytics.vercel.app/metrics/daily.json"`
- `resolveTelemetryMetricsUrl` → `resolveAnalyticsMetricsUrl`, reading `KUNAI_ANALYTICS_METRICS_URL`
- `DocsTelemetryMetrics` → `DocsAnalyticsMetrics`, with `lifetimeInstalls`, `byVersion`, `byOs`, `byArch`, and no `lifetimeMethod`
- `parseDocsTelemetryMetrics` → `parseDocsAnalyticsMetrics`
- `fetchDocsTelemetryMetrics` → `fetchDocsAnalyticsMetrics` (keep `next: { revalidate: 3600 }`)
- `formatOptInTelemetryLine` → `formatUsageLine`:

```ts
export function formatUsageLine(metrics: DocsAnalyticsMetrics): string {
  return `Installs active on ${metrics.day}: ${metrics.activeInstalls} · lifetime ${metrics.lifetimeInstalls}`;
}
```

- [ ] **Step 4: Move and extend the panel**

```bash
mkdir -p apps/docs/components/analytics
git mv apps/docs/components/telemetry/opt-in-usage-panel.tsx \
       apps/docs/components/analytics/usage-panel.tsx
git mv apps/docs/components/home/opt-in-telemetry-line.tsx \
       apps/docs/components/home/usage-line.tsx
git mv apps/docs/test/opt-in-usage-panel.test.tsx apps/docs/test/usage-panel.test.tsx
```

Rename the component `OptInUsagePanel` → `UsagePanel`, update the import in `apps/docs/app/telemetry/page.tsx:1,3`, and keep the two existing `MetricHero` tiles wired to `activeInstalls` and `lifetimeInstalls` (no longer `approximate`).

Add a breakdown component below the heroes, in the same file:

```tsx
function BreakdownBar({
  label,
  counts,
}: {
  readonly label: string;
  readonly counts: Readonly<Record<string, number>>;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[11px] font-medium tracking-[0.14em] uppercase">
        {label}
      </p>
      <div className="bg-muted/40 flex h-2 w-full overflow-hidden rounded-full">
        {entries.map(([bucket, n]) => (
          <div
            key={bucket}
            className="bg-primary/70 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(n / total) * 100}%`, opacity: bucket === "other" ? 0.35 : 1 }}
          />
        ))}
      </div>
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
        {entries.map(([bucket, n]) => (
          <li key={bucket}>
            {bucket} <span className="text-foreground">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Render three of them (`byVersion`, `byOs`, `byArch`) in a responsive grid, and update the `PayloadContractCard` copy: the payload block is unchanged, but the surrounding text must say **on by default, opt out with `/analytics`** rather than opt-in. Add one line naming the suppression: _"Groups smaller than 5 installs are reported as `other`."_

- [ ] **Step 5: Update page copy**

In `apps/docs/app/telemetry/page.tsx`, change the `<h1>` and metadata `title` from "Opt-in telemetry" to "Usage analytics"; keep `canonical` and `url` at `/telemetry`. Do the same for the copy (not the URLs) in `apps/docs/lib/doc-navigation.ts:235`, `apps/docs/app/llms.txt/route.ts:34`, and `apps/docs/lib/layout.shared.tsx:61`.

In `apps/docs/app/(home)/page.tsx` and `home-page-shell.tsx`, rename the `telemetryLine` prop to `usageLine`.

- [ ] **Step 6: Run the docs suite**

```bash
bun run --cwd apps/docs test
bun run typecheck && bun run lint
```

Expected: PASS. `apps/docs/test/render.test.ts` and `drift.test.ts` also exercise these pages — if they fail on the renamed command ids, update their expectations to `analytics` / `analytics-show`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(docs): usage analytics panel on schemaVersion 2

Adds version/os/arch breakdown bars and states the suppression floor.
Route stays /telemetry: a public URL is user-facing vocabulary, and it is
in the sitemap and llms.txt."
```

---

## Task 14: Contract, CLAUDE.md, and the drift gate

The four documents that contradict the code the moment opt-out lands.

**Files:**

- Move + rewrite: `.docs/telemetry-privacy-contract.md` → `.docs/analytics-privacy-contract.md`
- Modify: `CLAUDE.md` (the telemetry non-negotiable, and one clause on the relay distinction)
- Modify: `docs/users/reliability-and-privacy.mdx`
- Modify: `.docs/feature-map.md:120`
- Create: `apps/cli/test/unit/architecture/analytics-payload-drift.test.ts`

**Interfaces:**

- Consumes: `AnalyticsPayload` keys (Task 3), `ANALYTICS_PAYLOAD_KEYS` (Task 10).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing drift test**

Create `apps/cli/test/unit/architecture/analytics-payload-drift.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../../..");
const CONTRACT = join(ROOT, ".docs/analytics-privacy-contract.md");
const USER_DOC = join(ROOT, "docs/users/reliability-and-privacy.mdx");

const PAYLOAD_KEYS = ["installId", "version", "os", "arch", "ts"] as const;

/**
 * The contract warns that any payload change must land in both documents in
 * the same change set. This is the gate that makes that true rather than
 * aspirational.
 */
describe("analytics payload documentation drift", () => {
  test("both documents name exactly the five wire keys", () => {
    for (const path of [CONTRACT, USER_DOC]) {
      const body = readFileSync(path, "utf8");
      for (const key of PAYLOAD_KEYS) {
        expect(body).toContain(key);
      }
      // A field that was removed must not linger in the prose.
      expect(body).not.toContain("lifetimeMethod");
      expect(body).not.toContain("hyperloglog");
    }
  });

  test("both documents state the opt-out default, not opt-in", () => {
    for (const path of [CONTRACT, USER_DOC]) {
      const body = readFileSync(path, "utf8").toLowerCase();
      expect(body).toContain("opt out");
      expect(body).not.toContain("telemetry is **opt-in**");
    }
  });

  test("both documents state the k-anonymity floor", () => {
    for (const path of [CONTRACT, USER_DOC]) {
      expect(readFileSync(path, "utf8")).toMatch(/fewer than 5|under 5|floor of 5/i);
    }
  });

  test("the contract states the install_lifetime retention tradeoff", () => {
    const body = readFileSync(CONTRACT, "utf8");
    expect(body).toContain("install_lifetime");
    expect(body).toMatch(/permanent|life of the project/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bun run test apps/cli/test/unit/architecture/analytics-payload-drift.test.ts`
Expected: FAIL — `.docs/analytics-privacy-contract.md` does not exist.

- [ ] **Step 3: Rewrite the contract**

```bash
git mv .docs/telemetry-privacy-contract.md .docs/analytics-privacy-contract.md
```

Rewrite it. Keep the structure (Consent / Payload / Ingest / Known limits / Changing this) and the tone. The rows that must change or appear:

- **Consent:** on by default, opt out. `unset` means the disclosure has not been shown and performs **zero** network calls. The first run never sends — disclosure, then persist, then ping from the next launch. No TTY stays `unset`, writing nothing. `DO_NOT_TRACK=1` and `CI=true` hard-block sending and enabling; `0`/`false`/`no` do not block. `/analytics` shows status and toggles.
- **Identifier:** `installId` exists on disk **if and only if** analytics is enabled. Turning it off deletes it. Rendering a preview never creates one.
- **Payload:** exactly `installId`, `version`, `os`, `arch`, `ts`. No title, query, provider, provider result, URL, or file path is ever transmitted. Adding a field is a product decision, not a refactor.
- **Ingest:** Neon Postgres. `ping_day` holds HMAC hash + the three dimensions, pruned at 35 days. `install_lifetime` holds **one permanent hashed row per install with a first-seen date** — a durable pseudonymous record where the previous design kept only a HyperLogLog sketch, and the cost of an exact lifetime count. `daily_rollup` is permanent and holds no identity. **The ingest never reads a client IP.**
- **Public aggregates:** dimension buckets with fewer than 5 installs fold into `other`. Suppression applies to the public JSON only; the token-guarded admin endpoint reads unsuppressed.
- **Metric intake rule:** before any field ships, write down the decision it will change, the aggregate that answers it, and its k-anonymity floor. A field that cannot name a decision does not ship.
- **Known limits:** platform access logs can still correlate IP ↔ body unless scrubbed at the edge — outside the application's control. Abuse can inflate counters; it cannot expose watch history, because the payload has nothing to expose.

- [ ] **Step 4: Update `CLAUDE.md`**

Replace the telemetry non-negotiable:

```markdown
- **Analytics is on by default, opt-out, and disclosed before the first send.**
  A fresh install is `unset` and sends nothing until the notice has been shown;
  the run that shows it still sends nothing. Payload-bounded to five keys. See
  [.docs/analytics-privacy-contract.md](.docs/analytics-privacy-contract.md)
  before touching `services/analytics` or `apps/analytics-ingest`.
```

And extend the relay rule immediately above it so the two do not read as contradictory:

```markdown
- **Kunai must never ship a shared public relay URL.** `providerRelay.baseUrl`
  is empty by default and user-owned. Analytics is the deliberate exception and
  not a precedent: relay carries the user's own video traffic and must stay
  user-owned, while analytics carries a bounded anonymous aggregate and ships a
  maintainer-owned default endpoint.
```

- [ ] **Step 5: Update the user doc and feature map**

Rewrite the telemetry section of `docs/users/reliability-and-privacy.mdx` to match the contract: on by default, how to turn it off (`/analytics`, `DO_NOT_TRACK=1`), the five fields verbatim, that turning it off deletes the install id, and the fewer-than-5 suppression rule.

In `.docs/feature-map.md:120`, update the row:

```markdown
| Usage analytics (opt-out) | `apps/cli/src/services/analytics/*`, `apps/cli/src/domain/analytics/*`, `apps/analytics-ingest` | [analytics-privacy-contract.md](./analytics-privacy-contract.md) |
```

- [ ] **Step 6: Run every gate**

```bash
bun run test apps/cli/test/unit/architecture/
bun run verify:doc-paths
bun run typecheck && bun run lint && bun run fmt
bun run test
```

Expected: all PASS. `verify:doc-paths` catches any link still pointing at the old contract filename.

- [ ] **Step 7: Full build**

```bash
bun run build
```

Expected: PASS. This is the gate for build-only errors that `typecheck` misses.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: analytics privacy contract for the opt-out default

Reverses the opt-in non-negotiable in CLAUDE.md, states the
install_lifetime retention tradeoff and the k-anonymity floor plainly
rather than implying the old guarantees still hold, and adds a drift
test so the contract and the user-facing page cannot diverge from code."
```

---

## Self-review

**Spec coverage.** §1 naming → Tasks 1, 8, 13. §2 consent → Tasks 2, 3, 4. §3 identifier → Task 3 (verified again in 7). §4 payload → Task 10. §5 storage → Tasks 9, 10, 11. §6 rate limiting → Tasks 10, 12. §7 public metrics → Task 12. §8 docs/observability → Tasks 12 (admin), 13 (panel). §9 UI → Tasks 5, 6, 7. §10 documents → Task 14. §11 tests → distributed, with the drift and boundary gates in 14 and 2.

**Type consistency.** `AnalyticsPreference` (Task 1) is consumed by `consent-policy.ts` (2) and the service (3). `consentPatch` (3) is consumed by setup (4). `analyticsChoice` (5) is consumed by setup (4) — note Task 4 is written before Task 5 but references the renamed field; if executing strictly in order, Task 4's `prefs.analyticsChoice` will not typecheck until Task 5 renames it. **Execute Task 5 before Task 4's final typecheck, or accept one red step between them.** `AnalyticsStore` (10) is implemented by memory (10) and Postgres (11) and consumed by every handler (12). `DailyRollup` (10) feeds `buildPublicMetrics` (12) and the docs parser (13).

**Known ordering wrinkle.** Tasks 4 and 5 are mutually dependent through `SetupPrefs.analyticsChoice`. Either do them as one commit or run Task 5's Step 1 (the field rename) first.

---

## Execution Handoff

Plan complete and saved to `.plans/usage-analytics-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.
