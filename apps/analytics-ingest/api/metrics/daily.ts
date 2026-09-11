import type { IncomingMessage, ServerResponse } from "node:http";

import {
  buildPublicMetrics,
  PUBLIC_METRICS_CACHE_CONTROL,
  snapshotDayKey,
} from "../../src/public-metrics.js";
import {
  loadAnalyticsRuntimeConfig,
  type MetricsHandlerDependencies,
} from "../../src/runtime-config.js";

/**
 * Public read-only aggregates. No install hashes, IPs, or raw ids — and
 * dimension buckets under the small-cell floor are folded into "other" by
 * `buildPublicMetrics` before anything leaves here.
 *
 * Serves the newest rollup at or before the snapshot day, not strictly that
 * day. The contract makes `updatedAt` the staleness signal — but the previous
 * revision answered 404 `not_ready` whenever yesterday's rollup was missing, so
 * a cron that stopped firing took the page down rather than letting the value
 * visibly age. A 404 now means no rollup has ever been computed.
 *
 * Served as /metrics/daily.json via vercel rewrite.
 */
/**
 * The factory exists so a test can pin the clock and the store; the default
 * export below is the real handler, exactly as Vercel resolves it. Same shape
 * as `createSnapshotHandler` in `api/cron/snapshot.ts`, and for the same
 * reason: `mock.module` is process-global in Bun and applies at file-load time.
 */
export function createDailyMetricsHandler(dependencies: MetricsHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;
  const now = dependencies.now ?? Date.now;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.method ?? "GET") !== "GET") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }

    const runtime = loadConfig();
    if (!runtime) {
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
      return;
    }

    try {
      const rollup = await runtime.store.readLatestRollupAtOrBefore(snapshotDayKey(now()));
      if (!rollup) {
        res.statusCode = 404;
        res.setHeader("Cache-Control", "public, s-maxage=60, max-age=60");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "not_ready" }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Cache-Control", PUBLIC_METRICS_CACHE_CONTROL);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(buildPublicMetrics(rollup)));
    } catch {
      res.statusCode = 503;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
    }
  };
}

export default createDailyMetricsHandler();
