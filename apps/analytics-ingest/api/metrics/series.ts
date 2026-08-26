import type { IncomingMessage, ServerResponse } from "node:http";

import { PUBLIC_METRICS_CACHE_CONTROL, snapshotDayKey } from "../../src/public-metrics.js";
import { buildPublicSeries, clampSeriesDays, seriesStartDay } from "../../src/public-series.js";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config.js";

/**
 * Public read-only day-by-day aggregates. Same guarantees as the daily
 * snapshot — no install hashes, IPs, or raw ids — with suppression applied
 * across the whole window rather than per day, so a bucket near the small-cell
 * floor cannot blink in and out.
 *
 * Reads `daily_rollup`, which retention never prunes, so this adds no
 * collection and no new payload. `?days=` clamps to the served maximum.
 *
 * A 404 means no rollup has ever been computed, matching `daily.json`. A window
 * that simply contains no rollups yet is still a 404 rather than an empty
 * series, so a caller never renders an axis for a period with no data.
 *
 * Served as /metrics/series.json via vercel rewrite.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime) {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
    return;
  }

  try {
    const requested = new URL(req.url ?? "/", "http://localhost").searchParams.get("days");
    const days = clampSeriesDays(requested ?? undefined);
    const toDay = snapshotDayKey();
    const rollups = await runtime.store.readRollups(seriesStartDay(toDay, days), toDay);
    const series = buildPublicSeries(rollups);

    if (!series) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "public, s-maxage=60, max-age=60");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "not_ready" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Cache-Control", PUBLIC_METRICS_CACHE_CONTROL);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(series));
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
