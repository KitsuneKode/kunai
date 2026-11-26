import type { IncomingMessage, ServerResponse } from "node:http";

import { analyticsDayKey, shiftDayKey } from "../../src/analytics-day.js";
import { authorizeBearer } from "../../src/bearer-auth.js";
import {
  fetchDistributionEntries,
  type DistributionFetch,
} from "../../src/distribution-sources.js";
import { monthOfDay, RAW_RETENTION_DAYS } from "../../src/ingest.js";
import { buildPublicMetrics, snapshotDayKey } from "../../src/public-metrics.js";
import {
  loadAnalyticsRuntimeConfig,
  type AnalyticsRuntimeConfig,
} from "../../src/runtime-config.js";
import type { AnalyticsStore } from "../../src/store.js";

/**
 * Ceiling on how many missed days one run back-fills, so a long outage cannot
 * push the function past its `maxDuration` and fail every subsequent run too.
 * The remainder is picked up tomorrow; nothing is lost while it is still inside
 * the raw retention window.
 */
const MAX_BACKFILL_DAYS = 10;

/**
 * `month_active` rows for a month are kept until the month after it is this
 * many days old. Every run recomputes each month that still has rows, so the
 * month's final rollup is the last one before its rows go — a week of missed
 * cron runs at a month boundary still loses nothing.
 */
export const MONTH_ACTIVE_GRACE_DAYS = 7;

/**
 * The distribution stage's whole budget. It runs last and is aborted rather
 * than allowed to push the function past `maxDuration`, which would lose the
 * reply for a rollup that already committed.
 */
export const DISTRIBUTION_TIMEOUT_MS = 15_000;

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

/**
 * A connection string carries credentials and Postgres puts the host into plenty
 * of its error messages. Function logs are operator-only, but a password does
 * not belong in one regardless, so URLs are reduced to their scheme.
 */
function redactConnectionStrings(message: string): string {
  return message.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,
    (match) => `${match.split("://")[0]}://…`,
  );
}

/**
 * The reply body stays the uniform opaque `upstream_unavailable` every other
 * endpoint returns — the caller learns nothing new. The reason goes to stderr,
 * which Vercel keeps as function logs, tagged with the step that failed.
 *
 * Before this, one `catch {}` swallowed the error entirely. The contract says a
 * stale `daily_rollup.computed_at` signals cron failure, but there was nothing
 * anywhere that said *why* it failed, so the signal was undiagnosable.
 */
function logFailure(stage: string, error: unknown): void {
  // Redact the whole description, not just the message: `name` is a writable
  // string too, and the contract promises *any* connection string is reduced
  // to its scheme.
  const described =
    error instanceof Error ? `${error.name}: ${error.message}` : `non-error: ${typeof error}`;
  console.error(
    `[analytics:cron:snapshot] ${stage} failed — ${redactConnectionStrings(described)}`,
  );
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
  const missed = await store.findDaysNeedingRollup(shiftDayKey(today, -RAW_RETENTION_DAYS), target);
  const ordered = [...new Set([...missed, target])].sort();
  // Newest days matter most to the public snapshot, so a truncated run keeps
  // the tail rather than the head.
  return ordered.slice(-MAX_BACKFILL_DAYS);
}

export type SnapshotHandlerDependencies = {
  readonly loadConfig?: () => AnalyticsRuntimeConfig | null;
  readonly now?: () => number;
  /** The distribution stage's only network access. Tests always inject it. */
  readonly fetch?: DistributionFetch;
};

/**
 * Mirrors `createRelayRpcHandler` in `apps/relay-server`: the default export is
 * the real handler, and the factory exists so a test can supply a store without
 * `mock.module`, which is process-global in Bun and applies at file-load time.
 */
export function createSnapshotHandler(dependencies: SnapshotHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;
  const clock = dependencies.now ?? Date.now;
  const distributionFetch = dependencies.fetch ?? fetch;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const runtime = loadConfig();
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

    const now = clock();
    const today = analyticsDayKey(now);
    const day = snapshotDayKey(now);

    // The rollup is the permanent record and the only part the public JSON
    // reads. It gets its own failure path: nothing after this point is allowed
    // to turn a committed rollup into a reported failure.
    let metrics: ReturnType<typeof buildPublicMetrics>;
    const rolledUp: string[] = [];
    try {
      for (const pending of await daysToRollUp(runtime.store, today, day)) {
        rolledUp.push((await runtime.store.rollUpDay(pending)).day);
      }
      const rollup = await runtime.store.readRollup(day);
      if (!rollup) throw new Error(`snapshot day ${day} has no rollup`);
      metrics = buildPublicMetrics(rollup);
    } catch (error) {
      logFailure("rollup", error);
      sendJson(res, 503, { ok: false, error: "upstream_unavailable" });
      return;
    }

    // Retention runs on its own statements, in its own transactions — a prune
    // failure cannot roll the rollup back. Reporting 503 here would mark the
    // cron run failed for a day whose data actually landed, which is the
    // opposite of what an operator needs to know. Deferred work is named in the
    // reply and logged instead.
    const deferred: string[] = [];

    let pruned = 0;
    try {
      pruned = await runtime.store.pruneRawBefore(shiftDayKey(today, -RAW_RETENTION_DAYS));
    } catch (error) {
      logFailure("pruneRaw", error);
      deferred.push("pruneRaw");
    }

    // install_lifetime is the only table with no natural ceiling: every install
    // id ever seen leaves a permanent row, and ids are minted by the client.
    // Retiring long-silent installs into a counter bounds both the storage and
    // the durable pseudonymous set without losing the exact lifetime total.
    let retired = 0;
    const retention = runtime.limits.lifetimeRetentionDays;
    if (retention > 0) {
      try {
        retired = (await runtime.store.pruneLifetimeBefore(shiftDayKey(today, -retention))).retired;
      } catch (error) {
        logFailure("pruneLifetime", error);
        deferred.push("pruneLifetime");
      }
    }

    // Monthly actives and v2 cohorts. Every month still holding rows is
    // recomputed; only a month whose rollup just succeeded may lose its rows.
    let months: readonly string[] = [];
    let monthPruned = 0;
    try {
      months = await runtime.store.rollUpMonths();
      try {
        monthPruned = await runtime.store.pruneMonthActiveBefore(
          monthOfDay(shiftDayKey(today, -MONTH_ACTIVE_GRACE_DAYS)),
        );
      } catch (error) {
        logFailure("pruneMonth", error);
        deferred.push("pruneMonth");
      }
    } catch (error) {
      logFailure("monthRollup", error);
      deferred.push("monthRollup", "pruneMonth");
    }

    // Public download counters from GitHub and npm. No client data is
    // involved, and a third-party outage must never read as a failed rollup:
    // it is deferred like retention, and tomorrow's snapshot covers the gap.
    let distribution = 0;
    try {
      const entries = await fetchDistributionEntries({
        fetch: distributionFetch,
        today,
        githubToken: runtime.githubToken,
        signal: AbortSignal.timeout(DISTRIBUTION_TIMEOUT_MS),
      });
      distribution = await runtime.store.writeDistributionSnapshot(today, entries);
    } catch (error) {
      logFailure("distribution", error);
      deferred.push("distribution");
    }

    // Operators only — not public; cron secret required.
    sendJson(res, 200, {
      ok: true,
      metrics,
      rolledUp,
      pruned,
      retired,
      months,
      monthPruned,
      distribution,
      deferred,
    });
  };
}

export default createSnapshotHandler();
