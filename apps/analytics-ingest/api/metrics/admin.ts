import type { IncomingMessage, ServerResponse } from "node:http";

import { snapshotDayKey } from "../../src/public-metrics";
import { loadAnalyticsRuntimeConfig } from "../../src/runtime-config";

/** Last 30 days including the snapshot day. */
const ADMIN_WINDOW_DAYS = 30;

/**
 * Unsuppressed rollups for the maintainer. Never linked from the docs site
 * and never cached. Rollups hold counts only — no identity — but the
 * k-anonymity floor does not apply here, so it stays behind a token.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if ((req.method ?? "GET") !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime || !runtime.adminToken) {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "misconfigured" }));
    return;
  }

  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!match || match[1] !== runtime.adminToken) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  try {
    const to = snapshotDayKey();
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - (ADMIN_WINDOW_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rollups = await runtime.store.readRollups(from, to);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, from, to, rollups }));
  } catch {
    res.statusCode = 503;
    res.end(JSON.stringify({ ok: false, error: "upstream_unavailable" }));
  }
}
