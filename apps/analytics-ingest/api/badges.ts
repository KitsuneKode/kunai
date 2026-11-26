import type { IncomingMessage, ServerResponse } from "node:http";

import { analyticsDayKey } from "../src/analytics-day.js";
import { buildBadge, isBadgeName, type BadgeName } from "../src/badges.js";
import { NO_STORE, sendJson } from "../src/http-json.js";
import { PUBLIC_METRICS_CACHE_CONTROL } from "../src/public-metrics.js";
import { loadLastCompleteMonth, loadPublicDistribution } from "../src/public-reads.js";
import {
  loadAnalyticsRuntimeConfig,
  type MetricsHandlerDependencies,
} from "../src/runtime-config.js";

/** Same label, no figure: what a badge shows while its number cannot be read. */
function unavailable(name: BadgeName) {
  return buildBadge(name, { distribution: null, lastCompleteMonth: null });
}

/**
 * shields.io endpoint badges, served as /badges/<name>.json via vercel rewrite.
 *
 * A badge that cannot be computed still answers 200 with "unavailable":
 * shields renders an error badge for anything else, and a README should show
 * that the number is missing rather than a broken image.
 */
export function createBadgeHandler(dependencies: MetricsHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;
  const now = dependencies.now ?? Date.now;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.method ?? "GET") !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" }, NO_STORE);
      return;
    }
    const name = new URL(req.url ?? "/", "http://localhost").searchParams.get("badge") ?? "";
    if (!isBadgeName(name)) {
      sendJson(res, 404, { ok: false, error: "unknown_badge" }, NO_STORE);
      return;
    }
    const runtime = loadConfig();
    if (!runtime) {
      sendJson(res, 200, unavailable(name), NO_STORE);
      return;
    }
    try {
      const today = analyticsDayKey(now());
      const badge = buildBadge(name, {
        distribution: name === "active" ? null : await loadPublicDistribution(runtime.store, today),
        lastCompleteMonth:
          name === "active" ? await loadLastCompleteMonth(runtime.store, today) : null,
      });
      sendJson(res, 200, badge, PUBLIC_METRICS_CACHE_CONTROL);
    } catch {
      sendJson(res, 200, unavailable(name), NO_STORE);
    }
  };
}

export default createBadgeHandler();
