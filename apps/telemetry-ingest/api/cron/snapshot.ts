import type { IncomingMessage, ServerResponse } from "node:http";

import { loadTelemetryRuntimeConfig } from "../../src/runtime-config";
import { collectPublicMetrics, writePublicMetricsToRedis } from "../../src/snapshot";

function unauthorized(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 401;
  res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
}

function authorize(req: IncomingMessage, cronSecret: string): boolean {
  if (!cronSecret) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return Boolean(match && match[1] === cronSecret);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = loadTelemetryRuntimeConfig();
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

  if (!authorize(req, runtime.cronSecret)) {
    unauthorized(res);
    return;
  }

  try {
    const metrics = await collectPublicMetrics({
      daily: runtime.daily,
      lifetime: runtime.lifetime,
    });
    await writePublicMetricsToRedis(runtime.redis, metrics);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    // Operators only — not public; cron secret required.
    res.end(JSON.stringify({ ok: true, metrics }));
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
