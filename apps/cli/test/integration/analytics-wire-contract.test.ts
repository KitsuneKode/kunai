import { describe, expect, test } from "bun:test";

import { UsageAnalyticsService } from "@/services/analytics/usage-analytics-service";
import type { AnalyticsPingCompletion, KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

import { analyticsDayKey } from "../../../analytics-ingest/src/analytics-day";
import { ingestAnalyticsPing, type IngestResult } from "../../../analytics-ingest/src/ingest";
import { createMemoryAnalyticsStore } from "../../../analytics-ingest/src/memory-store";
import {
  buildPublicMetrics,
  parsePublicMetrics,
} from "../../../analytics-ingest/src/public-metrics";
import { memoryPingLog } from "../support/analytics-fixtures";

/**
 * The three sides of this feature are built and tested separately: the CLI
 * emits a payload, the ingest validates and aggregates it, the docs site
 * parses the published result. Each has its own suite, and each could stay
 * green while the contract between them drifted — which is exactly how the
 * previous revision ended up transmitting three fields nothing consumed.
 *
 * This test wires the CLI and the ingest together in-process. No network, no
 * database: the CLI's `fetchImpl` hands the real body straight to the real
 * ingest handler over a memory store.
 *
 * The third leg — that the docs site parses what the ingest publishes — lives
 * in `apps/docs/test/analytics-metrics.test.ts` instead. Importing the docs
 * lib here drags Next's `fetch` typing into the CLI's tsconfig, so the chain
 * is joined on the docs side, where those types belong.
 */

const HASH_SECRET = "integration-secret-not-for-prod";
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);
const TEST_ENDPOINT = "https://analytics.example.test/api/ping";

function makeConfig(overrides: Partial<KitsuneConfig> = {}) {
  let raw: KitsuneConfig = { ...DEFAULT_CONFIG, ...overrides };
  return {
    getRaw: () => ({ ...raw }),
    async update(partial: Partial<KitsuneConfig>) {
      raw = { ...raw, ...partial };
    },
    async save() {},
    async recordAnalyticsPing(completion: AnalyticsPingCompletion) {
      if (raw.analytics !== "enabled" || raw.installId !== completion.installId) return false;
      raw = {
        ...raw,
        analyticsRetryAfter: completion.analyticsRetryAfter,
      };
      if (completion.lastAnalyticsPingAt !== undefined)
        raw = { ...raw, lastAnalyticsPingAt: completion.lastAnalyticsPingAt };
      return true;
    },
    // This fake's memory is its disk, as with a single kunai process.
    async rotateAnalyticsIdentity(rotation: Partial<KitsuneConfig>) {
      if (raw.analytics !== "enabled") return false;
      raw = { ...raw, ...rotation };
      return true;
    },
    async readPersistedAnalyticsConsent() {
      return { analytics: raw.analytics, installId: raw.installId };
    },
    get rawRef() {
      return raw;
    },
  };
}

/** A CLI service whose every send is executed by the real ingest. */
function wireCliToIngest(options: {
  readonly store: ReturnType<typeof createMemoryAnalyticsStore>;
  readonly config: ReturnType<typeof makeConfig>;
  readonly version?: string;
  readonly os?: string;
  readonly arch?: string;
}) {
  const results: IngestResult[] = [];
  const service = new UsageAnalyticsService({
    pingLog: memoryPingLog(),
    config: options.config,
    currentVersion: options.version ?? "0.3.0",
    endpoint: TEST_ENDPOINT,
    now: () => NOW,
    platform: { os: options.os ?? "linux", arch: options.arch ?? "x64" },
    env: {},
    fetchImpl: async (_input, init) => {
      const body: unknown = JSON.parse(String(init?.body ?? "null"));
      const result = await ingestAnalyticsPing({
        method: String(init?.method ?? "GET"),
        body,
        hashSecret: HASH_SECRET,
        store: options.store,
        now: NOW,
      });
      results.push(result);
      return new Response(null, { status: result.ok ? 204 : result.status });
    },
  });
  return { service, results };
}

describe("CLI → ingest → docs wire contract", () => {
  test("a fixed smoke UUID counts as one active install and one new install in its cohort", async () => {
    // v2 counts new installs by cohort, never through `install_lifetime`: its id
    // rotates monthly, so a durable per-install row would be a fresh "install"
    // every month. Two processes sharing one identity are still one install.
    const store = createMemoryAnalyticsStore();
    for (let attempt = 0; attempt < 2; attempt++) {
      const config = makeConfig({
        analytics: "enabled",
        installId: "6b1a9f2c-58d4-4e77-9c31-0a5b7e2d84f0",
        analyticsCohort: "2026-08",
      });
      const { service } = wireCliToIngest({ store, config });
      await service.maybePing({ isInteractive: true });
    }

    const rollup = await store.rollUpDay(analyticsDayKey(NOW));
    expect(rollup.activeInstalls).toBe(1);
    // The v1 lifetime figures are not where a v2 install shows up.
    expect(rollup.newInstalls).toBe(0);
    expect(rollup.lifetimeInstalls).toBe(0);

    expect(await store.rollUpMonths()).toEqual(["2026-08"]);
    const [august] = await store.readMonthRollups("2026-08", "2026-08");
    expect(august?.activeInstalls).toBe(1);
    // Row (cohort, cohort) is the cohort's size: the month's new installs.
    const cohorts = await store.readCohortRollups("2026-08");
    expect(cohorts.map(({ cohort, month, installs }) => ({ cohort, month, installs }))).toEqual([
      { cohort: "2026-08", month: "2026-08", installs: 1 },
    ]);
  });

  test("a payload the CLI actually emits is accepted by the ingest", async () => {
    const store = createMemoryAnalyticsStore();
    const config = makeConfig({ analytics: "enabled", installId: crypto.randomUUID() });
    const { service, results } = wireCliToIngest({ store, config });

    await service.maybePing({ isInteractive: true });

    expect(results).toHaveLength(1);
    // `stored` reports whether the day's global write budget admitted the ping,
    // so an accepted-but-dropped ping is distinguishable from a stored one.
    expect(results[0]).toEqual({
      ok: true,
      day: analyticsDayKey(NOW),
      stored: true,
      duplicate: false,
    });
    expect(store.rawCount()).toBe(1);
  });

  test("the CLI's dimensions survive all the way into the public JSON", async () => {
    const store = createMemoryAnalyticsStore();

    // Three installs the CLI would genuinely produce on different machines.
    const fleet = [
      { version: "0.3.0", os: "linux", arch: "x64" },
      { version: "0.3.0", os: "darwin", arch: "arm64" },
      { version: "0.2.5", os: "linux", arch: "x64" },
    ];
    for (const machine of fleet) {
      const config = makeConfig({ analytics: "enabled", installId: crypto.randomUUID() });
      const { service } = wireCliToIngest({ store, ...machine, config });
      await service.maybePing({ isInteractive: true });
    }

    const rollup = await store.rollUpDay(analyticsDayKey(NOW));
    expect(rollup.activeInstalls).toBe(3);
    expect(rollup.byVersion).toEqual({ "0.3.0": 2, "0.2.5": 1 });
    expect(rollup.byOs).toEqual({ linux: 2, darwin: 1 });
    expect(rollup.byArch).toEqual({ x64: 2, arm64: 1 });
  });

  test("an Android install is accepted and counted as android", async () => {
    const store = createMemoryAnalyticsStore();
    const config = makeConfig({ analytics: "enabled", installId: crypto.randomUUID() });
    const { service, results } = wireCliToIngest({ store, config, os: "android", arch: "arm64" });
    await service.maybePing({ isInteractive: true });

    expect(results[0]?.ok).toBe(true);
    expect((await store.rollUpDay(analyticsDayKey(NOW))).byOs).toEqual({ android: 1 });
  });

  test("what a CLI ping produces survives a JSON round trip as valid v2", async () => {
    const store = createMemoryAnalyticsStore();
    const config = makeConfig({ analytics: "enabled", installId: crypto.randomUUID() });
    const { service } = wireCliToIngest({ store, config });
    await service.maybePing({ isInteractive: true });

    const rollup = await store.rollUpDay(analyticsDayKey(NOW));
    const published = buildPublicMetrics({ ...rollup, computedAt: new Date(NOW).toISOString() });

    // Round-trip through JSON: consumers receive text over HTTP, not the
    // in-memory object.
    const parsed = parsePublicMetrics(JSON.parse(JSON.stringify(published)) as unknown);

    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(2);
    expect(parsed?.activeInstalls).toBe(1);
  });

  test("a single install is suppressed to `other` before it is published", async () => {
    // One machine on an unusual build is the identifiability case the floor
    // exists for. The docs site must never receive the raw bucket.
    const store = createMemoryAnalyticsStore();
    const config = makeConfig({ analytics: "enabled", installId: crypto.randomUUID() });
    const { service } = wireCliToIngest({ store, config, os: "win32", arch: "arm64" });
    await service.maybePing({ isInteractive: true });

    const published = buildPublicMetrics(await store.rollUpDay(analyticsDayKey(NOW)));

    expect(published.byOs).toEqual({ other: 1 });
    expect(published.byOs.win32).toBeUndefined();
    expect(published.byArch).toEqual({ other: 1 });
  });
});

describe("CLI → ingest wire contract", () => {
  test("the ingest rejects anything the CLI would never send", async () => {
    const store = createMemoryAnalyticsStore();
    const rejected = await ingestAnalyticsPing({
      method: "POST",
      // A plausible future field added on the client without the contract
      // change: must be refused, not silently stored.
      body: {
        installId: "11111111-2222-4333-8444-555555555555",
        version: "0.3.0",
        os: "linux",
        arch: "x64",
        ts: NOW,
        query: "dune",
      },
      hashSecret: HASH_SECRET,
      store,
      now: NOW,
    });

    expect(rejected).toEqual({ ok: false, status: 400, error: "invalid_payload" });
    expect(store.rawCount()).toBe(0);
  });

  test("a disabled CLI never reaches the ingest at all", async () => {
    const store = createMemoryAnalyticsStore();
    const config = makeConfig({ analytics: "disabled", installId: "" });
    const { service, results } = wireCliToIngest({ store, config });

    await service.maybePing({ isInteractive: true });
    await service.onSessionStart({ isInteractive: true });

    expect(results).toEqual([]);
    expect(store.rawCount()).toBe(0);
  });
});
