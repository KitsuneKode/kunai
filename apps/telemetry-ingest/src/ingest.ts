/**
 * Opt-in telemetry ingest — privacy contract
 *
 * Accepts POST bodies shaped exactly as:
 *   { installId, version, os, arch, ts }
 *
 * Stores:
 * - ephemeral per-IP rate-limit timestamps (in-memory only; never persisted)
 * - for the current UTC day, an in-memory Set of install ids used only to
 *   compute a distinct count (not a durable identity store)
 *
 * Does NOT store:
 * - IP addresses in durable storage (platform access logs are out of scope and
 *   can still correlate IP↔body unless scrubbed by the operator)
 * - titles, queries, provider results, URLs, or file paths
 *
 * Abuse model: a hostile client can inflate the daily distinct counter (by
 * minting many install ids). With retained platform logs they might correlate
 * IP↔installId. They cannot expose another user's watch history — that data is
 * never accepted.
 */

export const TELEMETRY_PAYLOAD_KEYS = ["arch", "installId", "os", "ts", "version"] as const;

export type TelemetryIngestPayload = {
  readonly installId: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  readonly ts: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function utcDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function parseTelemetryPayload(body: unknown): TelemetryIngestPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== TELEMETRY_PAYLOAD_KEYS.length) return null;
  for (let i = 0; i < TELEMETRY_PAYLOAD_KEYS.length; i += 1) {
    if (keys[i] !== TELEMETRY_PAYLOAD_KEYS[i]) return null;
  }
  const installId = typeof record.installId === "string" ? record.installId.trim() : "";
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const os = typeof record.os === "string" ? record.os.trim() : "";
  const arch = typeof record.arch === "string" ? record.arch.trim() : "";
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : NaN;
  if (!UUID_RE.test(installId)) return null;
  if (!version || version.length > 64) return null;
  if (!os || os.length > 32) return null;
  if (!arch || arch.length > 32) return null;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return { installId, version, os, arch, ts };
}

export type RateLimitStore = {
  /** Returns true when the request is allowed. Must not persist the IP. */
  allow(ipKey: string, now: number): boolean;
};

export type DailyDistinctStore = {
  /** Record an install id for the UTC day; returns the distinct count for that day. */
  record(day: string, installId: string): number;
  count(day: string): number;
};

/** Best-effort in-memory rate limit. IP keys live only in process memory. */
export function createMemoryRateLimitStore(options?: {
  readonly windowMs?: number;
  readonly maxPerWindow?: number;
}): RateLimitStore {
  const windowMs = options?.windowMs ?? 60_000;
  const maxPerWindow = options?.maxPerWindow ?? 30;
  const hits = new Map<string, number[]>();

  return {
    allow(ipKey: string, now: number): boolean {
      const prior = hits.get(ipKey) ?? [];
      const recent = prior.filter((ts) => now - ts < windowMs);
      if (recent.length >= maxPerWindow) {
        hits.set(ipKey, recent);
        return false;
      }
      recent.push(now);
      hits.set(ipKey, recent);
      return true;
    },
  };
}

/** In-memory daily distinct install-id counter (single-instance / warm lambda). */
export function createMemoryDailyDistinctStore(): DailyDistinctStore {
  let day = "";
  let ids = new Set<string>();

  return {
    record(nextDay: string, installId: string): number {
      if (nextDay !== day) {
        day = nextDay;
        ids = new Set();
      }
      ids.add(installId);
      return ids.size;
    },
    count(nextDay: string): number {
      return nextDay === day ? ids.size : 0;
    },
  };
}

export type IngestResult =
  | { readonly ok: true; readonly day: string; readonly distinct: number }
  | { readonly ok: false; readonly status: number; readonly error: string };

export function ingestTelemetryPing(input: {
  readonly method: string;
  readonly body: unknown;
  readonly ipKey: string;
  readonly now?: number;
  readonly rateLimit: RateLimitStore;
  readonly daily: DailyDistinctStore;
}): IngestResult {
  if (input.method !== "POST") {
    return { ok: false, status: 405, error: "method_not_allowed" };
  }
  const now = input.now ?? Date.now();
  if (!input.rateLimit.allow(input.ipKey, now)) {
    return { ok: false, status: 429, error: "rate_limited" };
  }
  const payload = parseTelemetryPayload(input.body);
  if (!payload) {
    return { ok: false, status: 400, error: "invalid_payload" };
  }
  const day = utcDayKey(now);
  const distinct = input.daily.record(day, payload.installId);
  return { ok: true, day, distinct };
}
