# Telemetry Phase 0 — Correctness and Pollution Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three correctness defects in the existing telemetry pipeline — unvalidated `version`/`os`/`arch` on ingest, silent permanent loss of a failed daily ping, and a missing CDN revalidation header — without any schema change or config migration.

**Architecture:** Three independent changes across two apps. The ingest server gains strict semver and closed-allowlist validation inside the existing `parseTelemetryPayload`, rejecting polluted dimensions at the door. The CLI's `TelemetryService` stops writing `lastTelemetryPingAt` on a failed send and instead writes a new `telemetryRetryAfter` marker, so the next CLI launch retries naturally instead of losing the day. The public metrics endpoint gains `stale-while-revalidate`. Nothing here changes the wire contract's key set, so old and new clients remain mutually compatible.

**Tech Stack:** Bun, TypeScript, `bun:test`, Vercel serverless handlers (`node:http` `IncomingMessage`/`ServerResponse`), Upstash Redis (untouched in this phase).

## Global Constraints

- Runtime is Bun. Use `bun`, `bunx`, `bun run` — never `npm` or `node`.
- Run tests with `bun run test`, never `bun test` directly. Per-file runs during TDD use `bun test <path>` from inside the owning app directory only.
- No change to `TELEMETRY_PAYLOAD_KEYS`. The accepted key set stays exactly `["arch", "installId", "os", "ts", "version"]`. This phase tightens _values_, never _keys_.
- No new config field may be added to `packages/config/src/types.ts` beyond `telemetryRetryAfter: number`. No migration code — absent fields normalize to `0`.
- Telemetry failures stay silent. No new user-facing error, log line, or thrown exception may escape `TelemetryService`.
- `DO_NOT_TRACK` and `CI` hard gates must keep working unchanged.
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run fmt`.
- Spec of record: `docs/superpowers/specs/2026-07-25-telemetry-privacy-and-observability-design.md` §3.3, §4, §7, §13 (Phase 0).

## File Structure

| File                                                              | Responsibility                                                       | Change                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| `apps/telemetry-ingest/src/payload-validation.ts`                 | Semver regex, os/arch allowlists, predicate functions. Pure, no I/O. | **Create**                    |
| `apps/telemetry-ingest/src/ingest.ts`                             | Wire the new predicates into `parseTelemetryPayload`.                | Modify (~line 55-66)          |
| `apps/telemetry-ingest/test/payload-validation.test.ts`           | Unit tests for the pure predicates.                                  | **Create**                    |
| `apps/telemetry-ingest/test/ingest.test.ts`                       | Integration tests that polluted payloads are rejected.               | Modify (append)               |
| `apps/telemetry-ingest/api/metrics/daily.ts`                      | Add `stale-while-revalidate` to the 200 response.                    | Modify (line 37)              |
| `apps/telemetry-ingest/test/metrics-daily.test.ts`                | Assert the cache header string.                                      | **Create**                    |
| `packages/config/src/types.ts`                                    | Declare `telemetryRetryAfter: number`.                               | Modify (~line 119)            |
| `packages/config/src/defaults.ts`                                 | Default `telemetryRetryAfter: 0`.                                    | Modify (~line 88)             |
| `apps/cli/src/services/persistence/ConfigServiceImpl.ts`          | Normalize on load + getter.                                          | Modify (~line 218, ~line 490) |
| `apps/cli/src/services/telemetry/TelemetryService.ts`             | Retry-marker send path.                                              | Modify (~line 111-164)        |
| `apps/cli/test/unit/services/telemetry/telemetry-service.test.ts` | Retry-marker behaviour tests.                                        | Modify (append)               |

`payload-validation.ts` is a separate file rather than inlined into `ingest.ts` because Phase 1 adds two more endpoints (`/api/install`, `/api/report`) that must share exactly these predicates. Putting them in `ingest.ts` would force those endpoints to import from a file named for a different concern.

---

### Task 1: Payload value validation predicates

Pure functions with no dependencies. `ingest.ts` is not touched in this task — only the new module and its tests.

**Files:**

- Create: `apps/telemetry-ingest/src/payload-validation.ts`
- Test: `apps/telemetry-ingest/test/payload-validation.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `SEMVER_RE: RegExp`
  - `ALLOWED_OS: readonly string[]`
  - `ALLOWED_ARCH: readonly string[]`
  - `isValidVersion(value: string): boolean`
  - `isAllowedOs(value: string): boolean`
  - `isAllowedArch(value: string): boolean`

  Task 2 imports all three predicates. Task 5 (Phase 1, not in this plan) will import them for the new endpoints.

- [ ] **Step 1: Write the failing test**

Create `apps/telemetry-ingest/test/payload-validation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  ALLOWED_ARCH,
  ALLOWED_OS,
  isAllowedArch,
  isAllowedOs,
  isValidVersion,
} from "../src/payload-validation";

describe("version validation", () => {
  test("accepts plain semver", () => {
    expect(isValidVersion("0.3.0")).toBe(true);
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
  });

  test("accepts prerelease and build metadata", () => {
    expect(isValidVersion("0.4.0-beta.1")).toBe(true);
    expect(isValidVersion("0.4.0-rc.1+build.5")).toBe(true);
  });

  test("rejects non-semver pollution", () => {
    expect(isValidVersion("")).toBe(false);
    expect(isValidVersion("v0.3.0")).toBe(false);
    expect(isValidVersion("0.3")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion("0.3.0; DROP TABLE")).toBe(false);
    expect(isValidVersion("<script>alert(1)</script>")).toBe(false);
    expect(isValidVersion("01.3.0")).toBe(false);
  });

  test("rejects oversized input without catastrophic backtracking", () => {
    const started = Date.now();
    expect(isValidVersion(`${"9".repeat(5000)}.0.0`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("os and arch allowlists", () => {
  test("accepts every documented platform", () => {
    for (const os of ALLOWED_OS) expect(isAllowedOs(os)).toBe(true);
    for (const arch of ALLOWED_ARCH) expect(isAllowedArch(arch)).toBe(true);
  });

  test("covers the platforms Kunai actually ships to", () => {
    expect(isAllowedOs("linux")).toBe(true);
    expect(isAllowedOs("darwin")).toBe(true);
    expect(isAllowedOs("win32")).toBe(true);
    expect(isAllowedArch("x64")).toBe(true);
    expect(isAllowedArch("arm64")).toBe(true);
  });

  test("rejects unknown or spoofed values", () => {
    expect(isAllowedOs("")).toBe(false);
    expect(isAllowedOs("Linux")).toBe(false);
    expect(isAllowedOs("beos")).toBe(false);
    expect(isAllowedArch("")).toBe(false);
    expect(isAllowedArch("X64")).toBe(false);
    expect(isAllowedArch("sparc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/telemetry-ingest && bun test test/payload-validation.test.ts
```

Expected: FAIL — `Cannot find module '../src/payload-validation'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/telemetry-ingest/src/payload-validation.ts`:

```ts
/**
 * Value-level validation for telemetry payload dimensions.
 *
 * `version`, `os`, and `arch` are aggregation keys, not display strings — a
 * polluted value corrupts a whole dimension rather than one rendered label.
 * Validation is an allowlist by design; a denylist would leak.
 *
 * Shared by every ingest endpoint so the accepted value space cannot drift
 * between them.
 */

/** Official semver, anchored, no leading `v`, no leading zeros. */
export const SEMVER_RE =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** `process.platform` values Kunai builds for. */
export const ALLOWED_OS = ["linux", "darwin", "win32"] as const;

/** `process.arch` values Kunai builds for. */
export const ALLOWED_ARCH = ["x64", "arm64"] as const;

/** Guards against pathological regex input before the pattern ever runs. */
const MAX_VERSION_LEN = 64;

export function isValidVersion(value: string): boolean {
  if (!value || value.length > MAX_VERSION_LEN) return false;
  return SEMVER_RE.test(value);
}

export function isAllowedOs(value: string): boolean {
  return (ALLOWED_OS as readonly string[]).includes(value);
}

export function isAllowedArch(value: string): boolean {
  return (ALLOWED_ARCH as readonly string[]).includes(value);
}
```

Note on the regex: each numeric group is bounded (`\d{0,8}`) and the length guard runs first, so the 5000-character test input is rejected before matching begins.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/telemetry-ingest && bun test test/payload-validation.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/telemetry-ingest/src/payload-validation.ts apps/telemetry-ingest/test/payload-validation.test.ts
git commit -m "feat(telemetry): add semver and platform allowlist predicates"
```

---

### Task 2: Reject polluted dimensions at ingest

Replaces the current length-only checks at `apps/telemetry-ingest/src/ingest.ts:61-63`. The key set and every other rule stay exactly as they are.

**Files:**

- Modify: `apps/telemetry-ingest/src/ingest.ts:55-66`
- Test: `apps/telemetry-ingest/test/ingest.test.ts` (append a new `describe` block)

**Interfaces:**

- Consumes: `isValidVersion`, `isAllowedOs`, `isAllowedArch` from Task 1.
- Produces: no signature change. `parseTelemetryPayload(body: unknown): TelemetryIngestPayload | null` keeps its exact shape; only the set of inputs mapping to `null` grows.

- [ ] **Step 1: Write the failing test**

Append to `apps/telemetry-ingest/test/ingest.test.ts`. The file already defines a `valid` fixture at module scope — reuse it, do not redefine it.

```ts
describe("telemetry ingest dimension validation", () => {
  test("rejects non-semver versions", () => {
    expect(parseTelemetryPayload({ ...valid, version: "latest" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, version: "v0.3.0" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, version: "0.3" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, version: "<script>x</script>" })).toBeNull();
  });

  test("accepts prerelease versions", () => {
    const parsed = parseTelemetryPayload({ ...valid, version: "0.4.0-beta.1" });
    expect(parsed?.version).toBe("0.4.0-beta.1");
  });

  test("rejects os and arch outside the allowlist", () => {
    expect(parseTelemetryPayload({ ...valid, os: "beos" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, os: "Linux" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, arch: "sparc" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, arch: "X64" })).toBeNull();
  });

  test("still accepts every shipped platform combination", () => {
    for (const os of ["linux", "darwin", "win32"]) {
      for (const arch of ["x64", "arm64"]) {
        expect(parseTelemetryPayload({ ...valid, os, arch })).not.toBeNull();
      }
    }
  });

  test("polluted payloads are rejected end-to-end with 400", async () => {
    const result = await ingestTelemetryPing({
      method: "POST",
      body: { ...valid, version: "latest", ts: Date.now() },
      ipKey: "ip-hash-pollution",
      hashSecret: HASH_SECRET,
      rateLimit: createMemoryRateLimitStore(),
      installDayGate: createMemoryInstallDayGate(),
      daily: createMemoryDailyDistinctStore(),
      lifetime: createMemoryLifetimeStore(),
    });
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_payload" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/telemetry-ingest && bun test test/ingest.test.ts
```

Expected: FAIL. `"latest"`, `"beos"`, and `"sparc"` currently pass the length-only checks, so `parseTelemetryPayload` returns an object where `null` is asserted.

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `apps/telemetry-ingest/src/ingest.ts`, after the `node:crypto` import:

```ts
import { isAllowedArch, isAllowedOs, isValidVersion } from "./payload-validation";
```

Then replace these three lines inside `parseTelemetryPayload`:

```ts
if (!version || version.length > 64) return null;
if (!os || os.length > 32) return null;
if (!arch || arch.length > 32) return null;
```

with:

```ts
if (!isValidVersion(version)) return null;
if (!isAllowedOs(os)) return null;
if (!isAllowedArch(arch)) return null;
```

Also update the file's header comment. Replace the line:

```
 * - titles, queries, provider results, URLs, or file paths
```

with:

```
 * - titles, queries, provider results, URLs, or file paths
 *
 * `version`, `os`, and `arch` are aggregation keys and are validated against
 * strict semver and closed allowlists (see payload-validation.ts) so a hostile
 * client cannot inject a fabricated dimension into published aggregates.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/telemetry-ingest && bun test test/ingest.test.ts
```

Expected: PASS. Every pre-existing test in the file must still pass — the `valid` fixture uses `version: "0.3.0"`, `os: "linux"`, `arch: "x64"`, all of which remain acceptable.

- [ ] **Step 5: Commit**

```bash
git add apps/telemetry-ingest/src/ingest.ts apps/telemetry-ingest/test/ingest.test.ts
git commit -m "fix(telemetry): validate version, os, and arch as aggregation keys"
```

---

### Task 3: Stale-while-revalidate on public metrics

The snapshot changes once per day but the CDN currently has no way to serve stale content during revalidation, so every cache miss stampedes the origin.

**Files:**

- Modify: `apps/telemetry-ingest/api/metrics/daily.ts:37`
- Create: `apps/telemetry-ingest/test/metrics-daily.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `PUBLIC_METRICS_CACHE_CONTROL: string`, exported from `apps/telemetry-ingest/src/snapshot.ts`. The constant lives beside the snapshot logic it describes so the handler and its test share one definition rather than duplicating a header string.

- [ ] **Step 1: Write the failing test**

Create `apps/telemetry-ingest/test/metrics-daily.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { PUBLIC_METRICS_CACHE_CONTROL } from "../src/snapshot";

describe("public metrics cache policy", () => {
  test("serves stale content for a day while revalidating", () => {
    expect(PUBLIC_METRICS_CACHE_CONTROL).toBe(
      "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400",
    );
  });

  test("stale window is not shorter than the shared cache window", () => {
    const read = (directive: string): number => {
      const match = new RegExp(`${directive}=(\\d+)`).exec(PUBLIC_METRICS_CACHE_CONTROL);
      if (!match?.[1]) throw new Error(`missing directive: ${directive}`);
      return Number(match[1]);
    };
    expect(read("stale-while-revalidate")).toBeGreaterThanOrEqual(read("s-maxage"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/telemetry-ingest && bun test test/metrics-daily.test.ts
```

Expected: FAIL — `PUBLIC_METRICS_CACHE_CONTROL` is not exported from `../src/snapshot`.

- [ ] **Step 3: Write minimal implementation**

In `apps/telemetry-ingest/src/snapshot.ts`, add below the existing `METRICS_SCHEMA_VERSION` export:

```ts
/**
 * The snapshot is rewritten once per day by cron, so a CDN may safely serve a
 * stale copy for a full day while it revalidates. Without the stale window,
 * every shared-cache expiry stampedes the origin.
 */
export const PUBLIC_METRICS_CACHE_CONTROL =
  "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400";
```

In `apps/telemetry-ingest/api/metrics/daily.ts`, extend the snapshot import:

```ts
import { PUBLIC_METRICS_CACHE_CONTROL, readPublicMetricsFromRedis } from "../../src/snapshot";
```

Then replace line 37:

```ts
res.setHeader("Cache-Control", "public, s-maxage=3600, max-age=300");
```

with:

```ts
res.setHeader("Cache-Control", PUBLIC_METRICS_CACHE_CONTROL);
```

Leave the 404, 405, and 503 branches alone — `no-store` on errors and a short window on `not_ready` are both correct as they stand.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/telemetry-ingest && bun test test/metrics-daily.test.ts && bun test test
```

Expected: PASS for the new file, and the whole `apps/telemetry-ingest` suite still green.

- [ ] **Step 5: Commit**

```bash
git add apps/telemetry-ingest/src/snapshot.ts apps/telemetry-ingest/api/metrics/daily.ts apps/telemetry-ingest/test/metrics-daily.test.ts
git commit -m "perf(telemetry): serve stale public metrics while revalidating"
```

---

### Task 4: Add the `telemetryRetryAfter` config field

Config plumbing only. `TelemetryService` is not touched until Task 5, so this task lands a field that nothing reads yet — that keeps the behavioural change in Task 5 reviewable on its own.

**Files:**

- Modify: `packages/config/src/types.ts` (after `lastTelemetryPingAt`, ~line 119)
- Modify: `packages/config/src/defaults.ts` (after `lastTelemetryPingAt: 0`, ~line 88)
- Modify: `apps/cli/src/services/persistence/ConfigServiceImpl.ts` (~line 218 normalization, ~line 490 getters)
- Test: `apps/cli/test/unit/services/telemetry/telemetry-service.test.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces: `KitsuneConfig.telemetryRetryAfter: number` (epoch ms; `0` means no pending retry), plus a `get telemetryRetryAfter(): number` accessor on `ConfigServiceImpl`. Task 5 reads and writes this field.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/services/telemetry/telemetry-service.test.ts`. The file already imports `DEFAULT_CONFIG` and `KitsuneConfig` — reuse them.

```ts
describe("telemetryRetryAfter config field", () => {
  test("defaults to zero, meaning no pending retry", () => {
    expect(DEFAULT_CONFIG.telemetryRetryAfter).toBe(0);
  });

  test("is a distinct field from the success cadence mark", () => {
    const config: KitsuneConfig = {
      ...DEFAULT_CONFIG,
      lastTelemetryPingAt: 111,
      telemetryRetryAfter: 222,
    };
    expect(config.lastTelemetryPingAt).toBe(111);
    expect(config.telemetryRetryAfter).toBe(222);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/cli && bun test test/unit/services/telemetry/telemetry-service.test.ts
```

Expected: FAIL — TypeScript reports `telemetryRetryAfter` does not exist on `KitsuneConfig`.

- [ ] **Step 3: Write minimal implementation**

In `packages/config/src/types.ts`, directly after the `lastTelemetryPingAt: number;` line and its comment:

```ts
/**
 * Earliest epoch ms at which a failed telemetry send may be retried.
 * `0` means no retry is pending. Set instead of `lastTelemetryPingAt` when a
 * send fails, so the next CLI launch retries rather than losing the day.
 */
telemetryRetryAfter: number;
```

In `packages/config/src/defaults.ts`, directly after `lastTelemetryPingAt: 0,`:

```ts
  telemetryRetryAfter: 0,
```

In `apps/cli/src/services/persistence/ConfigServiceImpl.ts`, directly after the `lastTelemetryPingAt` normalization block:

```ts
      telemetryRetryAfter:
        typeof loaded.telemetryRetryAfter === "number" &&
        Number.isFinite(loaded.telemetryRetryAfter)
          ? Math.max(0, loaded.telemetryRetryAfter)
          : 0,
```

An absent field normalizes to `0`, which is why no migration is required.

In the same file, directly after the `get lastTelemetryPingAt()` accessor:

```ts
  get telemetryRetryAfter(): number {
    return this.config.telemetryRetryAfter;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/cli && bun test test/unit/services/telemetry/telemetry-service.test.ts && bun tsc --noEmit
```

Expected: PASS, and typecheck clean. If `ConfigStore.ts` or another module builds a `KitsuneConfig` literal without spreading `DEFAULT_CONFIG`, typecheck will point at it — add `telemetryRetryAfter: 0` there too.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/types.ts packages/config/src/defaults.ts apps/cli/src/services/persistence/ConfigServiceImpl.ts apps/cli/test/unit/services/telemetry/telemetry-service.test.ts
git commit -m "feat(config): add telemetryRetryAfter marker field"
```

---

### Task 5: Retry a failed ping on next launch instead of losing the day

The current `maybePing` persists `lastTelemetryPingAt` _before_ the network call, so any transient failure discards that day's ping permanently. An in-process backoff loop is the wrong fix — a fire-and-forget task in a CLI that often exits within a second has its timers killed. Instead, distinguish success from failure and gate retries on a short marker.

**Files:**

- Modify: `apps/cli/src/services/telemetry/TelemetryService.ts:111-164`
- Test: `apps/cli/test/unit/services/telemetry/telemetry-service.test.ts` (append)

**Interfaces:**

- Consumes: `KitsuneConfig.telemetryRetryAfter` from Task 4.
- Produces:
  - `TELEMETRY_RETRY_BACKOFF_MS: number` (exported constant, `15 * 60 * 1000`)
  - `maybePing(): Promise<void>` — unchanged signature, changed persistence behaviour.

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/test/unit/services/telemetry/telemetry-service.test.ts`. Add `TELEMETRY_RETRY_BACKOFF_MS` to the existing import from `@/services/telemetry/TelemetryService`.

```ts
describe("TelemetryService retry marker", () => {
  const DAY = Date.UTC(2026, 6, 20, 12, 0, 0);

  function okFetch(calls: unknown[]): TelemetryFetch {
    return async (...args) => {
      calls.push(args);
      return new Response("{}", { status: 200 });
    };
  }

  function failFetch(calls: unknown[]): TelemetryFetch {
    return async (...args) => {
      calls.push(args);
      throw new Error("network down");
    };
  }

  test("a failed send leaves the cadence mark untouched and sets a retry marker", async () => {
    const config = makeConfig({ telemetry: "enabled", lastTelemetryPingAt: 0 });
    const calls: unknown[] = [];

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl: failFetch(calls),
      now: () => DAY,
      env: {},
    });

    await service.maybePing();

    expect(calls).toHaveLength(1);
    expect(config.rawRef.lastTelemetryPingAt).toBe(0);
    expect(config.rawRef.telemetryRetryAfter).toBe(DAY + TELEMETRY_RETRY_BACKOFF_MS);
  });

  test("the retry marker suppresses re-sends until it expires", async () => {
    const config = makeConfig({
      telemetry: "enabled",
      lastTelemetryPingAt: 0,
      telemetryRetryAfter: DAY + TELEMETRY_RETRY_BACKOFF_MS,
    });
    const calls: unknown[] = [];

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl: okFetch(calls),
      now: () => DAY + 60_000,
      env: {},
    });

    await service.maybePing();

    expect(calls).toHaveLength(0);
  });

  test("a later launch retries once the marker has expired", async () => {
    const config = makeConfig({
      telemetry: "enabled",
      lastTelemetryPingAt: 0,
      telemetryRetryAfter: DAY + TELEMETRY_RETRY_BACKOFF_MS,
    });
    const calls: unknown[] = [];
    const later = DAY + TELEMETRY_RETRY_BACKOFF_MS + 1;

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl: okFetch(calls),
      now: () => later,
      env: {},
    });

    await service.maybePing();

    expect(calls).toHaveLength(1);
    expect(config.rawRef.lastTelemetryPingAt).toBe(later);
    expect(config.rawRef.telemetryRetryAfter).toBe(0);
  });

  test("a 5xx response is treated as failure, not success", async () => {
    const config = makeConfig({ telemetry: "enabled", lastTelemetryPingAt: 0 });
    const fetchImpl: TelemetryFetch = async () => new Response("nope", { status: 503 });

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl,
      now: () => DAY,
      env: {},
    });

    await service.maybePing();

    expect(config.rawRef.lastTelemetryPingAt).toBe(0);
    expect(config.rawRef.telemetryRetryAfter).toBe(DAY + TELEMETRY_RETRY_BACKOFF_MS);
  });

  test("a 4xx response is permanent — cadence advances so the client stops hammering", async () => {
    const config = makeConfig({ telemetry: "enabled", lastTelemetryPingAt: 0 });
    const fetchImpl: TelemetryFetch = async () => new Response("bad", { status: 400 });

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl,
      now: () => DAY,
      env: {},
    });

    await service.maybePing();

    expect(config.rawRef.lastTelemetryPingAt).toBe(DAY);
    expect(config.rawRef.telemetryRetryAfter).toBe(0);
  });

  test("a failure never throws out of pingInBackground", async () => {
    const config = makeConfig({ telemetry: "enabled", lastTelemetryPingAt: 0 });

    const service = new TelemetryService({
      config,
      currentVersion: "0.3.0",
      endpoint: DEFAULT_TELEMETRY_ENDPOINT,
      fetchImpl: async () => {
        throw new Error("network down");
      },
      now: () => DAY,
      env: {},
    });

    expect(() => service.pingInBackground()).not.toThrow();
    await Bun.sleep(10);
    expect(config.rawRef.telemetryRetryAfter).toBe(DAY + TELEMETRY_RETRY_BACKOFF_MS);
  });
});
```

The 4xx case matters: a malformed payload will fail identically forever, so retrying it every 15 minutes would turn one broken client into a permanent request source. Advancing the daily cadence is the correct backpressure.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/cli && bun test test/unit/services/telemetry/telemetry-service.test.ts
```

Expected: FAIL — `TELEMETRY_RETRY_BACKOFF_MS` is not exported, and the current implementation writes `lastTelemetryPingAt` before sending.

- [ ] **Step 3: Write minimal implementation**

In `apps/cli/src/services/telemetry/TelemetryService.ts`, add below `TELEMETRY_PING_INTERVAL_MS`:

```ts
/**
 * Delay before retrying a failed send. A failed ping must not consume the
 * 24h cadence, or a single flaky network moment silently discards the day.
 * Retries happen on the next CLI launch — never on an in-process timer, which
 * would be killed with the short-lived process.
 */
export const TELEMETRY_RETRY_BACKOFF_MS = 15 * 60 * 1000;
```

Then replace the body of `maybePing` from the cadence check through the end of the method:

```ts
  async maybePing(): Promise<void> {
    const config = this.deps.config.getRaw();
    if (config.telemetry !== "enabled") {
      return;
    }
    // Hard gate: env flags win over a stale enabled config.
    if (isTelemetryEnvBlocked(this.env)) {
      return;
    }
    const endpoint = this.deps.endpoint.trim();
    if (!endpoint) {
      return;
    }
    const now = this.now();
    if (
      config.lastTelemetryPingAt > 0 &&
      now - config.lastTelemetryPingAt < TELEMETRY_PING_INTERVAL_MS
    ) {
      return;
    }
    // A pending retry from an earlier failed send is still cooling down.
    if (config.telemetryRetryAfter > now) {
      return;
    }

    const installId = ensureInstallId(config);

    const payload: TelemetryPayload = {
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
        ? { installId, telemetryRetryAfter: now + TELEMETRY_RETRY_BACKOFF_MS }
        : { installId, lastTelemetryPingAt: now, telemetryRetryAfter: 0 },
    );
    await this.deps.config.save();
  }

  /**
   * `permanent` covers success and 4xx: both mean "do not try this again today".
   * `retry` covers network errors, timeouts, and 5xx.
   */
  private async send(
    endpoint: string,
    payload: TelemetryPayload,
  ): Promise<"permanent" | "retry"> {
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
      // Network error, timeout, or abort — all transient.
      return "retry";
    } finally {
      clearTimeout(timer);
    }
  }
```

Three things changed from the original. The pre-send `config.update` is gone — persistence now happens exactly once, after the outcome is known. The anti-spam guarantee is preserved by the `telemetryRetryAfter` check, which is written on every failure path. And the response status is now inspected rather than discarded.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/cli && bun test test/unit/services/telemetry/telemetry-service.test.ts
```

Expected: PASS. Every pre-existing test in the file must stay green, in particular the `unset`/`disabled`/`DO_NOT_TRACK`/`CI` zero-network-call tests, which are untouched by this change.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/telemetry/TelemetryService.ts apps/cli/test/unit/services/telemetry/telemetry-service.test.ts
git commit -m "fix(telemetry): retry a failed ping on next launch instead of losing the day"
```

---

### Task 6: Document the tightened contract and verify the whole repo

The privacy documentation in `.docs/experience-overview.md` describes the payload contract users are asked to trust. It must state the new validation, or the published claim drifts from the code.

**Files:**

- Modify: `.docs/experience-overview.md` (the "Opt-in telemetry" section, ~line 114-140)

**Interfaces:**

- Consumes: everything from Tasks 1-5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the documentation**

In `.docs/experience-overview.md`, inside the "Opt-in telemetry" bullet list, add after the bullet beginning "No title, query, provider result...":

```markdown
- `version` must be strict semver and `os`/`arch` must be on a closed allowlist —
  the ingest server rejects anything else, so a hostile client cannot inject a
  fabricated dimension into published aggregates
- A failed send does **not** consume the 24h cadence: it schedules a 15-minute
  retry marker so the next launch retries, rather than silently losing the day
```

In the same section, extend the sentence describing the ingest server. Replace:

```
It accepts POST only, validates the payload shape,
rejects clock skew, rate-limits per IP hash, and counts at most once per
HMAC-hashed install id per UTC day.
```

with:

```
It accepts POST only, validates the payload shape and every dimension value,
rejects clock skew, rate-limits per IP hash, and counts at most once per
HMAC-hashed install id per UTC day.
```

- [ ] **Step 2: Run the full verification suite**

```bash
cd /home/kitsunekode/Projects/hacking/kitsunesnipe
bun run typecheck && bun run lint && bun run test
```

Expected: all three pass. `bun run test` runs the turbo pipeline across `apps/cli`, `apps/telemetry-ingest`, and `packages/*`.

If `apps/docs` tests fail on `lib/telemetry-metrics.ts`, that is unrelated to this phase — that module reads the snapshot shape, which Phase 0 does not change. Investigate before assuming it is pre-existing.

- [ ] **Step 3: Format**

```bash
bun run fmt
```

- [ ] **Step 4: Verify the diff contains no unintended changes**

```bash
git status --short && git diff
```

Expected: only formatting changes from `bun run fmt`, if any. Confirm that `TELEMETRY_PAYLOAD_KEYS` in `apps/telemetry-ingest/src/ingest.ts` is unchanged — the key set must remain `["arch", "installId", "os", "ts", "version"]`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(telemetry): document dimension validation and retry semantics"
```

---

## Verification

Phase 0 is complete when all of the following hold:

- `bun run typecheck`, `bun run lint`, and `bun run test` pass from the repo root.
- `TELEMETRY_PAYLOAD_KEYS` is unchanged; no wire key was added or removed.
- A payload with `version: "latest"`, `os: "beos"`, or `arch: "sparc"` yields `400 invalid_payload`.
- A payload with `version: "0.3.0"`, `os: "linux"`, `arch: "x64"` is still accepted — old clients keep working.
- A failed send leaves `lastTelemetryPingAt` at its prior value and sets `telemetryRetryAfter`.
- A 4xx response advances `lastTelemetryPingAt` and clears `telemetryRetryAfter`.
- `GET /metrics/daily.json` returns `Cache-Control: public, s-maxage=3600, max-age=300, stale-while-revalidate=86400` on a 200.
- A config file lacking `telemetryRetryAfter` loads without error and normalizes it to `0`.

## Out of scope for Phase 0

Deferred to later phases of the spec, listed so no one implements them here:

- Rotating install ids, `ageBucket`, the first-run beacon (Phase 1)
- Consent tiers `off`/`basic`/`full` and `errorReports` (Phase 1)
- Setup wizard changes and `kunai doctor` (Phase 2)
- Postgres, rollup cron, k-anonymity suppression (Phase 3)
- Docs charts (Phase 4)
- `AnalyticsEvent`, `/api/report`, ops dashboard (Phase 5)
- Error fingerprinting and the crash prompt (Phase 6)
