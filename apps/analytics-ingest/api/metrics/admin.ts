import type { IncomingMessage, ServerResponse } from "node:http";

import { shiftDayKey } from "../../src/analytics-day.js";
import { authorizeBearer } from "../../src/bearer-auth.js";
import { snapshotDayKey } from "../../src/public-metrics.js";
import {
  loadAnalyticsRuntimeConfig,
  type MetricsHandlerDependencies,
} from "../../src/runtime-config.js";

/** Last 30 days including the snapshot day. */
const ADMIN_WINDOW_DAYS = 30;

/**
 * Unsuppressed rollups for the maintainer. Never linked from the docs site
 * and never cached. Rollups hold counts only — no identity — but the
 * public small-cell suppression does not apply here, so it stays behind a token.
 */
/**
 * The factory exists so a test can pin the clock and the store; the default
 * export below is the real handler, exactly as Vercel resolves it. Same shape
 * as `createSnapshotHandler` in `api/cron/snapshot.ts`, and for the same
 * reason: `mock.module` is process-global in Bun and applies at file-load time.
 */
export function createAdminMetricsHandler(dependencies: MetricsHandlerDependencies = {}) {
  const loadConfig = dependencies.loadConfig ?? loadAnalyticsRuntimeConfig;
  const now = dependencies.now ?? Date.now;

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");

    if ((req.method ?? "GET") !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }

    const runtime = loadConfig();
    if (!runtime || !runtime.adminToken) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
      return;
    }

    if (!authorizeBearer(req, runtime.adminToken)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }

    try {
      const to = snapshotDayKey(now());
      const from = shiftDayKey(to, -(ADMIN_WINDOW_DAYS - 1));
      const rollups = await runtime.store.readRollups(from, to);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, from, to, rollups }));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
    }
  };
}

export default createAdminMetricsHandler();
