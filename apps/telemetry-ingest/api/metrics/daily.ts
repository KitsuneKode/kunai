import type { IncomingMessage, ServerResponse } from "node:http";

import { loadTelemetryRuntimeConfig } from "../../src/runtime-config";
import { readPublicMetricsFromRedis } from "../../src/snapshot";

/**
 * Public read-only aggregates. No install hashes, IPs, or raw ids.
 * Served as /metrics/daily.json via vercel rewrite.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  const runtime = loadTelemetryRuntimeConfig();
  if (!runtime) {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
    return;
  }

  try {
    const metrics = await readPublicMetricsFromRedis(runtime.redis);
    if (!metrics) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "public, s-maxage=60, max-age=60");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "not_ready" }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("Cache-Control", "public, s-maxage=3600, max-age=300");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(metrics));
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
