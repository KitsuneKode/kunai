/**
 * Shared setup for the Postgres-backed suites.
 *
 * These files run against one database, in one process, and every one of them
 * writes. `install_lifetime` and `lifetime_retired` in particular are permanent
 * by design, so a row another file left behind silently shifts a lifetime
 * assertion here — a failure that looks like a rollup bug and is not. Each
 * suite therefore starts from an empty database rather than from whatever ran
 * before it.
 */

import { neon } from "@neondatabase/serverless";

/**
 * Deliberately NOT `DATABASE_URL`. These tests write, prune, and truncate, and
 * `DATABASE_URL` is set in far too many shells for something destructive to key
 * off it — a stray one must never let `bun run test` mutate a real database.
 * Opting in has to be explicit.
 */
export const TEST_DATABASE_URL = process.env.ANALYTICS_TEST_DATABASE_URL?.trim();

/** Far enough back that no real rollup could ever occupy these days. */
export const SCRATCH_DAYS = {
  old: "1999-01-01",
  main: "1999-02-01",
} as const;

/**
 * Suite-scoped install ids.
 *
 * These files share one scratch database. `install_lifetime.first_seen` is
 * write-once, so a hardening ping of install 1 on May and a lifecycle ping of
 * install 1 on February used to be the same HMAC: February's lifetime count
 * dropped the three May rows and failed on main as Expected 8, Received 5.
 * Prefixing the last UUID group keeps each suite's n=1 a different install.
 */
export type AnalyticsTestSuite = "lifecycle" | "hardening" | "store";

const SUITE_PREFIX: Record<AnalyticsTestSuite, string> = {
  lifecycle: "00",
  hardening: "10",
  store: "20",
};

export function testInstallId(n: number, suite: AnalyticsTestSuite): string {
  return `00000000-0000-4000-8000-${SUITE_PREFIX[suite]}${String(n).padStart(10, "0")}`;
}

export async function resetAnalyticsTables(): Promise<void> {
  if (!TEST_DATABASE_URL) return;
  const sql = neon(TEST_DATABASE_URL);
  await sql.query("truncate ping_day, install_lifetime, daily_rollup, ingest_budget");
  await sql.query("update lifetime_retired set retired_installs = 0 where id = 1");
}

/** Row counts the store port deliberately does not expose. */
export async function tableCount(table: "ping_day" | "install_lifetime"): Promise<number> {
  if (!TEST_DATABASE_URL) return 0;
  const sql = neon(TEST_DATABASE_URL);
  const rows = (await sql.query(`select count(*)::int as n from ${table}`)) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}
