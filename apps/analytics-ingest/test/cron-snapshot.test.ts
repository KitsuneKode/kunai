/**
 * The cron's failure reporting is the only thing standing between a stale
 * `daily_rollup.computed_at` and an operator who can act on it.
 *
 * Two behaviours matter and neither was covered: a retention failure must not
 * be reported as a failed snapshot (the rollup it follows is already
 * committed, on its own statement, in its own transaction), and whatever does
 * fail has to say so somewhere, because the reply body is deliberately opaque.
 */

import { describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createSnapshotHandler } from "../api/cron/snapshot";
import type { DistributionFetch } from "../src/distribution-sources";
import { loadAnalyticsLimits } from "../src/limits";
import { snapshotDayKey } from "../src/public-metrics";
import type { AnalyticsRuntimeConfig } from "../src/runtime-config";
import type { AnalyticsStore, DailyRollup } from "../src/store";
import { isGitHubApiUrl } from "./support/github-host";
import { inertStoreMethods } from "./support/inert-store";

const CRON_SECRET = "cron-secret-value";

function rollup(day: string): DailyRollup {
  return {
    day,
    computedAt: `${day}T00:05:00.000Z`,
    activeInstalls: 11,
    newInstalls: 3,
    byVersion: { "0.3.0": 11 },
    byOs: { linux: 11 },
    byArch: { x64: 11 },
    lifetimeInstalls: 57,
  };
}

function createStore(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  return {
    ...inertStoreMethods(),
    rollUpDay: async (day) => rollup(day),
    readRollup: async (day) => rollup(day),
    readLatestRollupAtOrBefore: async (day) => rollup(day),
    readRollups: async () => [],
    pruneRawBefore: async () => 3,
    pruneLifetimeBefore: async () => ({ retired: 2 }),
    ...overrides,
  };
}

function createConfig(store: AnalyticsStore): AnalyticsRuntimeConfig {
  return {
    hashSecret: "hash-secret",
    cronSecret: CRON_SECRET,
    adminToken: "admin-token",
    githubToken: "",
    limits: loadAnalyticsLimits({}),
    store,
  };
}

type Captured = { status: number; body: Record<string, unknown> };

/**
 * Answers every distribution request with an empty, well-formed body. No test
 * here reaches the network: the handler's only fetch is this one.
 */
const emptyDistribution: DistributionFetch = async (url) =>
  new Response(isGitHubApiUrl(url) ? "[]" : JSON.stringify({ downloads: [] }));

type RunOptions = { authorization?: string | null; fetch?: DistributionFetch; now?: number };

async function run(
  store: AnalyticsStore,
  { authorization = `Bearer ${CRON_SECRET}`, fetch = emptyDistribution, now }: RunOptions = {},
): Promise<{ captured: Captured; logs: string[] }> {
  const handler = createSnapshotHandler({
    loadConfig: () => createConfig(store),
    fetch,
    now: now === undefined ? undefined : () => now,
  });

  const req = {
    method: "GET",
    headers: authorization ? { authorization } : {},
  } as unknown as IncomingMessage;

  const captured: Captured = { status: 0, body: {} };
  const res = {
    setHeader: () => {},
    set statusCode(value: number) {
      captured.status = value;
    },
    end: (payload: string) => {
      captured.body = JSON.parse(payload) as Record<string, unknown>;
    },
  } as unknown as ServerResponse;

  const logs: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await handler(req, res);
  } finally {
    console.error = realError;
  }
  return { captured, logs };
}

describe("cron snapshot failure reporting", () => {
  test("a retention failure does not report a committed rollup as failed", async () => {
    const { captured, logs } = await run(
      createStore({
        pruneRawBefore: async () => {
          throw new Error("statement timeout");
        },
      }),
    );

    // The rollup landed, so the run did its job — 503 here would tell an
    // operator the day is missing when it is not.
    expect(captured.status).toBe(200);
    expect(captured.body.ok).toBe(true);
    expect(captured.body.deferred).toEqual(["pruneRaw"]);
    expect(logs.join("\n")).toContain("pruneRaw failed");
  });

  test("a lifetime-retention failure is reported the same way", async () => {
    const { captured } = await run(
      createStore({
        pruneLifetimeBefore: async () => {
          throw new Error("deadlock detected");
        },
      }),
    );

    expect(captured.status).toBe(200);
    expect(captured.body.deferred).toEqual(["pruneLifetime"]);
    expect(captured.body.pruned).toBe(3);
  });

  test("a rollup failure still fails the run, opaquely, but is logged", async () => {
    const { captured, logs } = await run(
      createStore({
        rollUpDay: async () => {
          throw new Error("connection refused");
        },
      }),
    );

    expect(captured.status).toBe(503);
    // The body stays the uniform shape every other endpoint returns.
    expect(captured.body).toEqual({ ok: false, error: "upstream_unavailable" });
    expect(logs.join("\n")).toContain("rollup failed");
    expect(logs.join("\n")).toContain("connection refused");
  });

  test("a healthy run defers nothing", async () => {
    const { captured, logs } = await run(createStore());

    expect(captured.status).toBe(200);
    expect(captured.body.deferred).toEqual([]);
    expect(captured.body.rolledUp).toEqual([snapshotDayKey()]);
    expect(logs).toEqual([]);
  });

  test("credentials in an error message never reach the log", async () => {
    const { logs } = await run(
      createStore({
        rollUpDay: async () => {
          throw new Error(
            "connect ECONNREFUSED postgres://admin:hunter2@db.example.com:5432/analytics",
          );
        },
      }),
    );

    const line = logs.join("\n");
    expect(line).toContain("postgres://…");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("db.example.com");
  });

  test("credentials in an error's name never reach the log either", async () => {
    // `name` is a writable string, not only a class name. The contract says any
    // connection string is reduced to its scheme, so the whole description is
    // redacted — not just the message half of it.
    const { logs } = await run(
      createStore({
        rollUpDay: async () => {
          const error = new Error("connection refused");
          error.name = "postgres://admin:hunter2@db.example.com:5432/analytics";
          throw error;
        },
      }),
    );

    const line = logs.join("\n");
    expect(line).toContain("postgres://…");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("db.example.com");
  });

  test("an unauthenticated caller is refused before any store work", async () => {
    let touched = false;
    const { captured } = await run(
      createStore({
        findDaysNeedingRollup: async () => {
          touched = true;
          return [];
        },
      }),
      { authorization: null },
    );

    expect(captured.status).toBe(401);
    expect(touched).toBe(false);
  });

  test("a failing distribution stage leaves the rollup at 200 with deferred set", async () => {
    let written = false;
    const { captured, logs } = await run(
      createStore({
        writeDistributionSnapshot: async () => {
          written = true;
          return 0;
        },
      }),
      {
        fetch: async () => {
          throw new Error("getaddrinfo ENOTFOUND https://api.github.com/repos/x");
        },
      },
    );

    expect(captured.status).toBe(200);
    expect(captured.body.ok).toBe(true);
    expect(captured.body.rolledUp).toEqual([snapshotDayKey()]);
    expect(captured.body.deferred).toEqual(["distribution"]);
    // All or nothing: a partial snapshot would publish a false spike tomorrow.
    expect(written).toBe(false);
    expect(logs.join("\n")).toContain("distribution failed");
    expect(logs.join("\n")).not.toContain("api.github.com");
  });

  test("an upstream error status defers the distribution stage too", async () => {
    const { captured } = await run(createStore(), {
      fetch: async () => new Response("rate limited", { status: 403 }),
    });
    expect(captured.status).toBe(200);
    expect(captured.body.deferred).toEqual(["distribution"]);
  });

  test("a healthy distribution stage writes today's snapshot", async () => {
    const snapshots: { day: string; count: number }[] = [];
    const { captured } = await run(
      createStore({
        writeDistributionSnapshot: async (day, entries) => {
          snapshots.push({ day, count: entries.length });
          return entries.length;
        },
      }),
    );
    expect(captured.body.deferred).toEqual([]);
    // Launcher plus every platform package, each a zero from the empty fake.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.count).toBe(11);
    expect(captured.body.distribution).toBe(11);
  });

  test("a failed month rollup keeps its rows: the prune is deferred with it", async () => {
    let pruned = false;
    const { captured } = await run(
      createStore({
        rollUpMonths: async () => {
          throw new Error("deadlock detected");
        },
        pruneMonthActiveBefore: async () => {
          pruned = true;
          return 0;
        },
      }),
    );
    expect(captured.status).toBe(200);
    expect(captured.body.deferred).toEqual(["monthRollup", "pruneMonth"]);
    expect(pruned).toBe(false);
  });

  test("month rows are pruned only once the following month is a week old", async () => {
    const asked: string[] = [];
    const store = createStore({
      pruneMonthActiveBefore: async (month) => {
        asked.push(month);
        return 0;
      },
    });
    // 19:00 UTC is 00:30 IST the next day: these runs are labelled the 7th
    // and the 8th of December. November's rows survive the first and go after
    // the second, whose month rollup has already read them.
    await run(store, { now: Date.parse("2026-12-06T19:00:00.000Z") });
    await run(store, { now: Date.parse("2026-12-07T19:00:00.000Z") });
    expect(asked).toEqual(["2026-11", "2026-12"]);
  });
});
