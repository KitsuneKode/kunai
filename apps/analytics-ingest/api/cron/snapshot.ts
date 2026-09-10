import type { IncomingMessage, ServerResponse } from "node:http";

import { authorizeBearer } from "../../src/bearer-auth.js";
import { RAW_RETENTION_DAYS } from "../../src/ingest.js";
import { buildPublicMetrics, snapshotDayKey } from "../../src/public-metrics.js";
import {
  loadAnalyticsRuntimeConfig,
  type AnalyticsRuntimeConfig,
} from "../../src/runtime-config.js";
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
  const described =
    error instanceof Error
      ? `${error.name}: ${redactConnectionStrings(error.message)}`
      : `non-error: ${typeof error}`;
  console.error(`[analytics:cron:snapshot] ${stage} failed — ${described}`);
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

export type SnapshotHandlerDependencies = {
  readonly loadConfig?: () => AnalyticsRuntimeConfig | null;
};

/**
 * Mirrors `createRelayRpcHandler` in `apps/relay-server`: the default export is
 * the real handler, and the factory exists so a test can supply a store without
 * `mock.module`, which is process-global in Bun and applies at file-load time.
 */
export function createSnapshotHandler(dependencies: SnapshotHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;

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

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
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
      pruned = await runtime.store.pruneRawBefore(dayKeyBefore(today, RAW_RETENTION_DAYS));
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
        retired = (await runtime.store.pruneLifetimeBefore(dayKeyBefore(today, retention))).retired;
      } catch (error) {
        logFailure("pruneLifetime", error);
        deferred.push("pruneLifetime");
      }
    }

    // Operators only — not public; cron secret required.
    sendJson(res, 200, { ok: true, metrics, rolledUp, pruned, retired, deferred });
  };
}

export default createSnapshotHandler();
