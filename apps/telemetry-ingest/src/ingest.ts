/**
 * Opt-in telemetry ingest — privacy contract
 *
 * Accepts POST bodies shaped exactly as:
 *   { installId, version, os, arch, ts }
 *
 * Durable stores (when wired to Redis) keep only:
 * - ephemeral rate-limit keys (IP hash / install hash) with short TTL
 * - per-UTC-day SET of HMAC(installId) with 48h TTL
 * - lifetime HyperLogLog of HMAC(installId)
 * - cached daily distinct integers
 *
 * Does NOT store:
 * - raw install UUIDs
 * - IP addresses in durable identity storage
 * - titles, queries, provider results, URLs, or file paths
 *
 * Abuse model: a hostile client can mint many install ids and inflate counters
 * (subject to rate limits). They cannot expose another user's watch history —
 * that data is never accepted. Redis dumps without TELEMETRY_HASH_SECRET cannot
 * be joined back to clients.
 */

import { createHmac } from "node:crypto";

export const TELEMETRY_PAYLOAD_KEYS = ["arch", "installId", "os", "ts", "version"] as const;

/** Reject client clocks more than ±24h from server time. */
export const TS_SKEW_MS = 24 * 60 * 60 * 1000;

export const MAX_BODY_BYTES = 512;

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

export function hashInstallId(secret: string, installId: string): string {
  return createHmac("sha256", secret).update(installId, "utf8").digest("hex");
}

export function isTimestampSkewed(clientTs: number, now: number, skewMs = TS_SKEW_MS): boolean {
  return Math.abs(clientTs - now) > skewMs;
}

export type RateLimitStore = {
  /** Returns true when the request is allowed. Must not persist the raw IP. */
  allow(ipKey: string, now: number): boolean | Promise<boolean>;
};

/** One successful count per installHash per UTC day. */
export type InstallDayGate = {
  /**
   * Returns true when this installHash has not yet been counted for `day`.
   * Implementations must mark it claimed when returning true.
   */
  claim(day: string, installHash: string): boolean | Promise<boolean>;
};

export type DailyDistinctStore = {
  /** Record an installHash for the UTC day; returns the distinct count for that day. */
  record(day: string, installHash: string): number | Promise<number>;
  count(day: string): number | Promise<number>;
  /** Test-only peek at members (memory store). */
  debugMembers?(day: string): readonly string[];
};

export type LifetimeStore = {
  add(installHash: string): void | Promise<void>;
  approxCount(): number | Promise<number>;
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

export function createMemoryInstallDayGate(): InstallDayGate {
  const claimed = new Map<string, Set<string>>();
  return {
    claim(day: string, installHash: string): boolean {
      let set = claimed.get(day);
      if (!set) {
        set = new Set();
        claimed.set(day, set);
      }
      if (set.has(installHash)) return false;
      set.add(installHash);
      return true;
    },
  };
}

/** In-memory daily distinct install-hash counter. */
export function createMemoryDailyDistinctStore(): DailyDistinctStore {
  const byDay = new Map<string, Set<string>>();

  return {
    record(nextDay: string, installHash: string): number {
      let ids = byDay.get(nextDay);
      if (!ids) {
        ids = new Set();
        byDay.set(nextDay, ids);
      }
      ids.add(installHash);
      return ids.size;
    },
    count(nextDay: string): number {
      return byDay.get(nextDay)?.size ?? 0;
    },
    debugMembers(day: string): readonly string[] {
      return [...(byDay.get(day) ?? [])];
    },
  };
}

/** In-memory lifetime distinct (exact Set — production uses HyperLogLog). */
export function createMemoryLifetimeStore(): LifetimeStore {
  const ids = new Set<string>();
  return {
    add(installHash: string): void {
      ids.add(installHash);
    },
    approxCount(): number {
      return ids.size;
    },
  };
}

export type IngestResult =
  | {
      readonly ok: true;
      readonly day: string;
      readonly distinct: number;
      readonly alreadyCounted?: boolean;
    }
  | { readonly ok: false; readonly status: number; readonly error: string };

export async function ingestTelemetryPing(input: {
  readonly method: string;
  readonly body: unknown;
  readonly ipKey: string;
  readonly now?: number;
  readonly hashSecret: string;
  readonly rateLimit: RateLimitStore;
  readonly installDayGate: InstallDayGate;
  readonly daily: DailyDistinctStore;
  readonly lifetime: LifetimeStore;
}): Promise<IngestResult> {
  if (input.method !== "POST") {
    return { ok: false, status: 405, error: "method_not_allowed" };
  }
  if (!input.hashSecret.trim()) {
    return { ok: false, status: 503, error: "misconfigured" };
  }
  const now = input.now ?? Date.now();
  if (!(await input.rateLimit.allow(input.ipKey, now))) {
    return { ok: false, status: 429, error: "rate_limited" };
  }
  const payload = parseTelemetryPayload(input.body);
  if (!payload) {
    return { ok: false, status: 400, error: "invalid_payload" };
  }
  if (isTimestampSkewed(payload.ts, now)) {
    return { ok: false, status: 400, error: "timestamp_skew" };
  }
  const day = utcDayKey(now);
  const installHash = hashInstallId(input.hashSecret, payload.installId);
  const claimed = await input.installDayGate.claim(day, installHash);
  if (!claimed) {
    const distinct = await input.daily.count(day);
    return { ok: true, day, distinct, alreadyCounted: true };
  }
  const distinct = await input.daily.record(day, installHash);
  await input.lifetime.add(installHash);
  return { ok: true, day, distinct };
}
