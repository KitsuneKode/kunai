import type { IncomingMessage, ServerResponse } from "node:http";

import { authorizeBearer } from "../../src/bearer-auth.js";
import { RAW_RETENTION_DAYS } from "../../src/ingest.js";
import { buildPublicMetrics, snapshotDayKey } from "../../src/public-metrics.js";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config.js";
import type { AnalyticsStore } from "../../src/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ceiling on how many missed days one run back-fills, so a long outage cannot
 * push the function past its `maxDuration` and fail every subsequent run too.
 * The remainder is picked up tomorrow; nothing is lost while it is still inside
 * the raw retention window.
 */
const MAX_BACKFILL_DAYS = 10;

function dayKeyBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

/**
 * Days that still hold raw rows but never got a rollup, oldest first.
 *
 * The previous revision rolled up exactly yesterday. A cron run that failed, or
 * simply did not fire, left that day without a rollup forever: nothing looked
 * back for it, and 35 days later retention deleted the rows it would have been
 * computed from. The rollup is the permanent record, so that was silent
 * permanent data loss dressed as a transient error.
 */
async function daysToRollUp(
  store: AnalyticsStore,
  today: string,
  target: string,
): Promise<readonly string[]> {
  const missed = await store.findDaysNeedingRollup(dayKeyBefore(today, RAW_RETENTION_DAYS), target);
  const ordered = [...new Set([...missed, target])].sort();
  // Newest days matter most to the public snapshot, so a truncated run keeps
  // the tail rather than the head.
  return ordered.slice(-MAX_BACKFILL_DAYS);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime || !runtime.cronSecret) {
    sendJson(res, 503, { ok: false, error: "misconfigured" });
    return;
  }

  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  if (!authorizeBearer(req, runtime.cronSecret)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  try {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const day = snapshotDayKey(now);

    const rolledUp: string[] = [];
    for (const pending of await daysToRollUp(runtime.store, today, day)) {
      rolledUp.push((await runtime.store.rollUpDay(pending)).day);
    }
    const rollup = await runtime.store.readRollup(day);
    if (!rollup) throw new Error(`snapshot day ${day} has no rollup`);
    const metrics = buildPublicMetrics(rollup);

    // Raw dimension rows past retention go now; the rollups above already
    // captured everything the public JSON and the admin view need.
    const pruned = await runtime.store.pruneRawBefore(dayKeyBefore(today, RAW_RETENTION_DAYS));

    // install_lifetime is the only table with no natural ceiling: every install
    // id ever seen leaves a permanent row, and ids are minted by the client.
    // Retiring long-silent installs into a counter bounds both the storage and
    // the durable pseudonymous set without losing the exact lifetime total.
    const retention = runtime.limits.lifetimeRetentionDays;
    const retired =
      retention > 0
        ? (await runtime.store.pruneLifetimeBefore(dayKeyBefore(today, retention))).retired
        : 0;

    // Operators only — not public; cron secret required.
    sendJson(res, 200, { ok: true, metrics, rolledUp, pruned, retired });
  } catch {
    sendJson(res, 503, { ok: false, error: "upstream_unavailable" });
  }
}
