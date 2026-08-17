import type { IncomingMessage, ServerResponse } from "node:http";

import { ingestAnalyticsPing, MAX_BODY_BYTES } from "../src/ingest";
import { loadAnalyticsRuntimeConfig } from "../src/runtime-config";

type ReadResult =
  | { ok: true; body: unknown }
  | { ok: false; error: "body_too_large" | "invalid_json" };

/**
 * Read at most `maxBytes` of request body.
 *
 * Deliberately not `for await`: breaking out of that loop early calls the
 * iterator's `return()`, which destroys the request *and its socket* while the
 * caller is still one microtask away from writing the response. The reply then
 * never reaches the client, which sees Node's default empty `200` — so the
 * size cap, the primary abuse control here, reported success for exactly the
 * bodies it was meant to refuse.
 *
 * Pausing instead stops the upload without tearing down the socket, leaving
 * the caller free to answer. The caller destroys the request afterwards.
 */
function readJsonBodyLimited(req: IncomingMessage, maxBytes: number): Promise<ReadResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const settle = (result: ReadResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        req.pause();
        settle({ ok: false, error: "body_too_large" });
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      if (chunks.length === 0) return settle({ ok: true, body: null });
      try {
        settle({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
      } catch {
        settle({ ok: false, error: "invalid_json" });
      }
    });

    req.on("error", () => settle({ ok: false, error: "invalid_json" }));
    req.on("aborted", () => settle({ ok: false, error: "invalid_json" }));
  });
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
    const tooLarge = parsed.error === "body_too_large";
    // The sender may still be uploading. Close rather than pretend to keep the
    // connection alive for a body already refused.
    if (tooLarge) res.setHeader("Connection", "close");
    sendJson(res, 400, {
      ok: false,
      error: tooLarge ? "body_too_large" : "invalid_payload",
    });
    // Only now: destroying before the reply is written is what silently turned
    // this rejection into an empty 200.
    if (tooLarge) req.destroy();
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
