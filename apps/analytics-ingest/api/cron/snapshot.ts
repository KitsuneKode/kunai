import type { IncomingMessage, ServerResponse } from "node:http";

import { authorizeBearer } from "../../src/bearer-auth";
import { RAW_RETENTION_DAYS } from "../../src/ingest";
import { buildPublicMetrics, snapshotDayKey } from "../../src/public-metrics";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config";

function unauthorized(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 401;
  res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime || !runtime.cronSecret) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
    return;
  }

  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  if (!authorizeBearer(req, runtime.cronSecret)) {
    unauthorized(res);
    return;
  }

  try {
    const day = snapshotDayKey();
    const rollup = await runtime.store.rollUpDay(day);
    const metrics = buildPublicMetrics(rollup);

    // Raw dimension rows past retention go now; the rollup above already
    // captured everything the public JSON and the admin view need.
    const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const pruned = await runtime.store.pruneRawBefore(cutoff);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    // Operators only — not public; cron secret required.
    res.end(JSON.stringify({ ok: true, metrics, pruned }));
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
