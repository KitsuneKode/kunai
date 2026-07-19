import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createMemoryDailyDistinctStore,
  createMemoryRateLimitStore,
  ingestTelemetryPing,
} from "../src/ingest";

const rateLimit = createMemoryRateLimitStore();
const daily = createMemoryDailyDistinctStore();

function clientIpKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]?.trim()
        : "";
  // Ephemeral rate-limit key only — never written to durable storage.
  return raw || req.socket.remoteAddress || "unknown";
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const body = method === "POST" ? await readJsonBody(req) : null;
  const result = ingestTelemetryPing({
    method,
    body,
    ipKey: clientIpKey(req),
    rateLimit,
    daily,
  });

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (!result.ok) {
    res.statusCode = result.status;
    res.end(JSON.stringify({ ok: false, error: result.error }));
    return;
  }
  res.statusCode = 204;
  res.end();
}
