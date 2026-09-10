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
import { loadAnalyticsLimits } from "../src/limits";
import { snapshotDayKey } from "../src/public-metrics";
import type { AnalyticsRuntimeConfig } from "../src/runtime-config";
import type { AnalyticsStore, DailyRollup } from "../src/store";

const CRON_SECRET = "cron-secret-value";

function rollup(day: string): DailyRollup {
  return {
    day,
    computedAt: `${day}T00:05:00.000Z`,
    activeInstalls: 11,
    byVersion: { "0.3.0": 11 },
    byOs: { linux: 11 },
    byArch: { x64: 11 },
    lifetimeInstalls: 57,
  };
}

function createStore(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  return {
    recordPing: async () => ({ admitted: true }),
    rollUpDay: async (day) => rollup(day),
    readRollup: async (day) => rollup(day),
    readLatestRollupAtOrBefore: async (day) => rollup(day),
    readRollups: async () => [],
    findDaysNeedingRollup: async () => [],
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
    limits: loadAnalyticsLimits({}),
    store,
  };
}

type Captured = { status: number; body: Record<string, unknown> };

async function run(
  store: AnalyticsStore,
  { authorization = `Bearer ${CRON_SECRET}` }: { authorization?: string | null } = {},
): Promise<{ captured: Captured; logs: string[] }> {
  const handler = createSnapshotHandler({ loadConfig: () => createConfig(store) });

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
});
