import type { IncomingMessage, ServerResponse } from "node:http";

import { analyticsDayKey } from "../../src/analytics-day.js";
import { NO_STORE, NOT_READY_CACHE_CONTROL, sendJson } from "../../src/http-json.js";
import { PUBLIC_METRICS_CACHE_CONTROL } from "../../src/public-metrics.js";
import { loadPublicMonthly } from "../../src/public-reads.js";
import {
  loadAnalyticsRuntimeConfig,
  type MetricsHandlerDependencies,
} from "../../src/runtime-config.js";

/**
 * Public monthly actives, new installs per month and cohort retention, for
 * complete months only. Cells under the small-cell floor are null, and a
 * retention cell needs a cohort of 10 with at least 5 on each side of it.
 *
 * Served as /metrics/monthly.json via vercel rewrite.
 */
export function createMonthlyMetricsHandler(dependencies: MetricsHandlerDependencies = {}) {
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
      const monthly = await loadPublicMonthly(runtime.store, analyticsDayKey(now()));
      if (!monthly) {
        sendJson(res, 404, { ok: false, error: "not_ready" }, NOT_READY_CACHE_CONTROL);
        return;
      }
      sendJson(res, 200, monthly, PUBLIC_METRICS_CACHE_CONTROL);
    } catch {
      sendJson(res, 503, { ok: false, error: "upstream_unavailable" }, NO_STORE);
    }
  };
}

export default createMonthlyMetricsHandler();
