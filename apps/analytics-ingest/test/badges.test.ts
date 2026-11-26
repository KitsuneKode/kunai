import { describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createBadgeHandler } from "../api/badges";
import { createDistributionMetricsHandler } from "../api/metrics/distribution";
import { createMonthlyMetricsHandler } from "../api/metrics/monthly";
import { ACTIVE_BADGE_LABEL, countBadge, formatBadgeCount } from "../src/badges";
import { loadAnalyticsLimits } from "../src/limits";
import { createMemoryAnalyticsStore } from "../src/memory-store";
import type { MetricsHandlerDependencies } from "../src/runtime-config";
import type { AnalyticsStore } from "../src/store";

/** 12:00 UTC on 14 December 2026: the analytics day is the 14th, the last complete month November. */
const NOW = Date.UTC(2026, 11, 14, 12, 0, 0);

type JsonValue =
  | string
  | number
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type Reply = { status: number; body: Record<string, JsonValue>; cache: string };

async function call(
  createHandler: (
    dependencies: MetricsHandlerDependencies,
  ) => (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  store: AnalyticsStore | null,
  url = "/",
): Promise<Reply> {
  const handler = createHandler({
    loadConfig: () =>
      store && {
        hashSecret: "hash-secret",
        cronSecret: "cron-secret",
        adminToken: "admin-token",
        githubToken: "",
        limits: loadAnalyticsLimits({}),
        store,
      },
    now: () => NOW,
  });
  const reply: Reply = { status: 0, body: {}, cache: "" };
  // SAFETY: the handlers read only method/url/headers; the stub supplies exactly that surface.
  const req = { method: "GET", url, headers: {} } as IncomingMessage;
  // SAFETY: the handlers write only statusCode/setHeader/end; the stub supplies
  // exactly that surface with the real parameter types.
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: number | string | readonly string[]) => {
      if (name === "Cache-Control") reply.cache = String(value);
    },
    end: (payload?: string) => {
      // SAFETY: every handler under test ends with JSON.stringify of an object.
      if (payload) reply.body = JSON.parse(payload) as Reply["body"];
    },
  } as ServerResponse;
  await handler(req, res);
  reply.status = res.statusCode;
  return reply;
}

describe("badge formatting", () => {
  test("counts read the way shields badges usually do", () => {
    expect(formatBadgeCount(999)).toBe("999");
    expect(formatBadgeCount(1000)).toBe("1k");
    expect(formatBadgeCount(12_345)).toBe("12.3k");
    expect(formatBadgeCount(4_560_000)).toBe("4.5M");
  });

  test("the floor applies, and a missing figure is not a zero", () => {
    expect(countBadge("installs", 4).message).toBe("fewer than 5");
    expect(countBadge("installs", null)).toMatchObject({
      schemaVersion: 1,
      message: "unavailable",
      color: "lightgrey",
    });
  });
});

describe("badge endpoints", () => {
  test("downloads sums GitHub assets and npm platform packages", async () => {
    const store = createMemoryAnalyticsStore();
    await store.writeDistributionSnapshot("2026-12-13", [
      { source: "github", release: "v0.4.0", platform: "linux-x64", cumulative: 12_000 },
      { source: "npm", release: "", platform: "linux-x64", cumulative: 300 },
      { source: "npm", release: "", platform: "launcher", cumulative: 310 },
    ]);
    const reply = await call(createBadgeHandler, store, "/api/badges?badge=downloads");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      schemaVersion: 1,
      label: "downloads",
      message: "12.3k",
      color: "blue",
      cacheSeconds: 3600,
    });
  });

  test("installs is unavailable until a marker asset exists", async () => {
    const store = createMemoryAnalyticsStore();
    await store.writeDistributionSnapshot("2026-12-13", [
      { source: "github", release: "v0.4.0", platform: "linux-x64", cumulative: 50 },
    ]);
    expect((await call(createBadgeHandler, store, "/?badge=installs")).body.message).toBe(
      "unavailable",
    );

    await store.writeDistributionSnapshot("2026-12-14", [
      { source: "github", release: "v0.5.0", platform: "linux-x64", cumulative: 50 },
      { source: "marker", release: "v0.5.0", platform: "install", cumulative: 2_100 },
    ]);
    expect((await call(createBadgeHandler, store, "/?badge=installs")).body.message).toBe("2.1k");
  });

  test("active reads the last complete month, under its open-decision label", async () => {
    const store = createMemoryAnalyticsStore();
    for (let n = 0; n < 7; n += 1) {
      await store.recordPing({
        day: "2026-11-10",
        installHash: `${n}`.repeat(64),
        version: "0.3.0",
        os: "linux",
        arch: "x64",
      });
    }
    // The current month is busier, and must not be what the badge shows.
    for (let n = 10; n < 30; n += 1) {
      await store.recordPing({
        day: "2026-12-02",
        installHash: `${n}`.padEnd(64, "f"),
        version: "0.3.0",
        os: "linux",
        arch: "x64",
      });
    }
    await store.rollUpMonths();
    const reply = await call(createBadgeHandler, store, "/?badge=active");
    expect(reply.body.label).toBe(ACTIVE_BADGE_LABEL);
    expect(reply.body.label).toBe("active last month (opted in)");
    expect(reply.body.message).toBe("7");
  });

  test("an unknown badge is a 404, and a store outage is an unavailable badge", async () => {
    const store = createMemoryAnalyticsStore();
    expect((await call(createBadgeHandler, store, "/?badge=stars")).status).toBe(404);

    const failing: AnalyticsStore = {
      ...store,
      readMonthRollups: async () => {
        throw new Error("connection refused");
      },
    };
    const reply = await call(createBadgeHandler, failing, "/?badge=active");
    expect(reply.status).toBe(200);
    expect(reply.body.message).toBe("unavailable");
    expect(reply.cache).toBe("no-store");
  });
});

describe("public JSON endpoints", () => {
  test("distribution.json is 404 until a snapshot exists, then publishes it", async () => {
    const store = createMemoryAnalyticsStore();
    expect((await call(createDistributionMetricsHandler, store)).status).toBe(404);
    await store.writeDistributionSnapshot("2026-12-14", [
      { source: "github", release: "v0.4.0", platform: "android-x64", cumulative: 3 },
    ]);
    const reply = await call(createDistributionMetricsHandler, store);
    expect(reply.status).toBe(200);
    expect(reply.body.asOf).toBe("2026-12-14");
  });

  test("monthly.json publishes complete months only", async () => {
    const store = createMemoryAnalyticsStore();
    expect((await call(createMonthlyMetricsHandler, store)).status).toBe(404);
    for (let n = 0; n < 6; n += 1) {
      await store.recordPing({
        day: "2026-11-03",
        installHash: `${n}`.repeat(64),
        version: "0.5.0",
        os: "android",
        arch: "arm64",
        v2: { activeMonth: "2026-11", cohort: "2026-11" },
      });
    }
    await store.rollUpMonths();
    const reply = await call(createMonthlyMetricsHandler, store);
    expect(reply.status).toBe(200);
    expect(reply.body.throughMonth).toBe("2026-11");
    expect(reply.body.months).toEqual([{ month: "2026-11", activeInstalls: 6 }]);
  });

  test("an unconfigured deployment answers 503 on the JSON and an unavailable badge", async () => {
    expect((await call(createMonthlyMetricsHandler, null)).status).toBe(503);
    expect((await call(createDistributionMetricsHandler, null)).status).toBe(503);
    const badge = await call(createBadgeHandler, null, "/?badge=downloads");
    expect(badge.status).toBe(200);
    expect(badge.body.message).toBe("unavailable");
  });
});
