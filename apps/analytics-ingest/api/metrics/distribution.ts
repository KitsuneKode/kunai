import type { IncomingMessage, ServerResponse } from "node:http";

import { analyticsDayKey } from "../../src/analytics-day.js";
import { NO_STORE, NOT_READY_CACHE_CONTROL, sendJson } from "../../src/http-json.js";
import { PUBLIC_METRICS_CACHE_CONTROL } from "../../src/public-metrics.js";
import { loadPublicDistribution } from "../../src/public-reads.js";
import {
  loadAnalyticsRuntimeConfig,
  type MetricsHandlerDependencies,
} from "../../src/runtime-config.js";

/**
 * Public download counts from GitHub release assets and npm, with daily
 * deltas. Nothing here came from a Kunai client.
 *
 * Served as /metrics/distribution.json via vercel rewrite. Same factory shape
 * as the other metrics handlers, so a test can pin the clock and the store.
 */
export function createDistributionMetricsHandler(dependencies: MetricsHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;
  const now = dependencies.now ?? Date.now;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.method ?? "GET") !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" }, NO_STORE);
      return;
    }
    const runtime = loadConfig();
    if (!runtime) {
      sendJson(res, 503, { ok: false, error: "misconfigured" }, NO_STORE);
      return;
    }
    try {
      const distribution = await loadPublicDistribution(runtime.store, analyticsDayKey(now()));
      if (!distribution) {
        sendJson(res, 404, { ok: false, error: "not_ready" }, NOT_READY_CACHE_CONTROL);
        return;
      }
      sendJson(res, 200, distribution, PUBLIC_METRICS_CACHE_CONTROL);
    } catch {
      sendJson(res, 503, { ok: false, error: "upstream_unavailable" }, NO_STORE);
    }
  };
}

export default createDistributionMetricsHandler();
