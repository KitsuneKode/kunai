/**
 * The read endpoints must ask the store for the day the shared clock resolves.
 *
 * `no-second-day-clock` proves none of them derives a label of its own, but not
 * that each one asks for the right day: an endpoint could still call the wrong
 * helper, or subtract a day twice. Each handler here runs against a pinned
 * clock and a store that records what it was asked for, on both sides of the
 * cutover.
 *
 * Every expected day comes from `previousAnalyticsDayKey` at the same pinned
 * instant, so these stay true if the cutover moves.
 */
import { describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createAdminMetricsHandler } from "../api/metrics/admin";
import { createDailyMetricsHandler } from "../api/metrics/daily";
import { createSeriesMetricsHandler } from "../api/metrics/series";
import { IST_DAY_BOUNDARY_FROM, previousAnalyticsDayKey, shiftDayKey } from "../src/analytics-day";
import { loadAnalyticsLimits } from "../src/limits";
import type { AnalyticsRuntimeConfig } from "../src/runtime-config";
import type { AnalyticsStore, DailyRollup } from "../src/store";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const ADMIN_TOKEN = "admin-token-value";

/** One instant on each side of the seam, named by what it exercises. */
const INSTANTS = [
  ["an hour before the cutover", IST_DAY_BOUNDARY_FROM - 60 * MINUTE_MS],
  ["19:00 UTC after the cutover", IST_DAY_BOUNDARY_FROM + DAY_MS + 30 * MINUTE_MS],
] as const;

/** What the store was asked for during one request. */
type Asked = { latestAtOrBefore?: string; from?: string; to?: string };

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type HandlerFactory = (dependencies: {
  loadConfig: () => AnalyticsRuntimeConfig | null;
  now: () => number;
}) => Handler;

function rollup(day: string): DailyRollup {
  return {
    day,
    computedAt: `${day}T00:05:00.000Z`,
    activeInstalls: 7,
    byVersion: { "0.3.0": 7 },
    byOs: { linux: 7 },
    byArch: { x64: 7 },
    lifetimeInstalls: 9,
  };
}

function createConfig(asked: Asked): AnalyticsRuntimeConfig {
  const store = {
    recordPing: async () => ({ admitted: true }),
    rollUpDay: async (day: string) => rollup(day),
    readRollup: async (day: string) => rollup(day),
    readLatestRollupAtOrBefore: async (day: string) => {
      asked.latestAtOrBefore = day;
      return rollup(day);
    },
    readRollups: async (from: string, to: string) => {
      asked.from = from;
      asked.to = to;
      return [rollup(to)];
    },
    findDaysNeedingRollup: async () => [],
    pruneRawBefore: async () => 0,
    pruneLifetimeBefore: async () => ({ retired: 0 }),
  } satisfies AnalyticsStore;

  return {
    hashSecret: "hash-secret",
    cronSecret: "cron-secret",
    adminToken: ADMIN_TOKEN,
    limits: loadAnalyticsLimits({}),
    store,
  };
}

/** Drive one handler at a pinned instant and report what the store was asked. */
async function ask(
  createHandler: HandlerFactory,
  now: number,
  { url = "/", authorization }: { url?: string; authorization?: string } = {},
): Promise<Asked> {
  const asked: Asked = {};
  const handler = createHandler({ loadConfig: () => createConfig(asked), now: () => now });
  const req = {
    method: "GET",
    url,
    headers: authorization ? { authorization } : {},
  } as unknown as IncomingMessage;
  const res = {
    statusCode: 0,
    setHeader: () => {},
    end: () => {},
  } as unknown as ServerResponse;

  await handler(req, res);
  return asked;
}

describe("the read endpoints follow the shared clock", () => {
  for (const [label, now] of INSTANTS) {
    const expected = previousAnalyticsDayKey(now);

    test(`daily asks for the newest rollup at or before the shared day — ${label}`, async () => {
      expect((await ask(createDailyMetricsHandler, now)).latestAtOrBefore).toBe(expected);
    });

    test(`series ends its window on the shared day — ${label}`, async () => {
      const asked = await ask(createSeriesMetricsHandler, now, { url: "/?days=7" });
      expect(asked.to).toBe(expected);
      // Inclusive window: seven days ending on the shared day.
      expect(asked.from).toBe(shiftDayKey(expected, -6));
    });

    test(`admin ends its 30-day window on the shared day — ${label}`, async () => {
      const asked = await ask(createAdminMetricsHandler, now, {
        authorization: `Bearer ${ADMIN_TOKEN}`,
      });
      expect(asked.to).toBe(expected);
      expect(asked.from).toBe(shiftDayKey(expected, -29));
    });
  }

  test("an unauthenticated admin read never reaches the store", async () => {
    expect(await ask(createAdminMetricsHandler, IST_DAY_BOUNDARY_FROM)).toEqual({});
  });
});
