import type { IncomingMessage, ServerResponse } from "node:http";

import { ingestAnalyticsPing, MAX_BODY_BYTES } from "../src/ingest";
import { loadAnalyticsRuntimeConfig } from "../src/runtime-config";

async function readJsonBodyLimited(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; error: "body_too_large" | "invalid_json" }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      return { ok: false, error: "body_too_large" };
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return { ok: true, body: null };
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown> | null,
): void {
  // No CORS headers — the CLI does not need them; blocks casual browser spam.
  res.setHeader("Cache-Control", "no-store");
  if (payload) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return;
  }
  res.statusCode = status;
  res.end();
}

/**
 * The client IP is never read. The previous revision hashed it for an
 * in-memory rate limiter that reset on every cold start — so it bought
 * almost nothing while making "we never touch your IP" untrue. Abuse
 * protection is now the 512-byte body cap, Vercel's platform DDoS
 * mitigation, and the (day, install_hash) primary key.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const runtime = loadAnalyticsRuntimeConfig();
  if (!runtime) {
    sendJson(res, 503, { ok: false, error: "misconfigured" });
    return;
  }

  const method = req.method ?? "GET";
  if (method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const parsed = await readJsonBodyLimited(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    sendJson(res, 400, {
      ok: false,
      error: parsed.error === "body_too_large" ? "body_too_large" : "invalid_payload",
    });
    return;
  }

  try {
    const result = await ingestAnalyticsPing({
      method,
      body: parsed.body,
      hashSecret: runtime.hashSecret,
      store: runtime.store,
    });

    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return;
    }
    // 204 empty — do not leak counts to clients.
    sendJson(res, 204, null);
  } catch {
    sendJson(res, 503, { ok: false, error: "upstream_unavailable" });
  }
}
