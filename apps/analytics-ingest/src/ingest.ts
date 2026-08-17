/**
 * Anonymous usage ingest — privacy contract
 *
 * Accepts POST bodies shaped exactly as:
 *   { installId, version, os, arch, ts }
 *
 * Stores only:
 * - ping_day: HMAC(installId) + version/os/arch, 35-day retention
 * - install_lifetime: HMAC(installId) + first-seen date, permanent
 * - daily_rollup: aggregate counts, permanent, no identity
 *
 * Never stores or accepts: raw install UUIDs, IP addresses, titles, queries,
 * provider results, URLs, or file paths. This module never reads a client IP
 * at all — there is no rate-limit key to derive one for.
 *
 * `version`, `os`, and `arch` are aggregation keys, validated against strict
 * semver and closed allowlists so a hostile client cannot inject a fabricated
 * dimension into published aggregates. Unlike the previous revision, they are
 * actually stored and grouped rather than validated and discarded.
 *
 * Abuse model: a hostile client can mint many install ids and inflate counts.
 * The (day, install_hash) primary key caps a real install at one row per day.
 * No one can expose another user's watch history — that data is never accepted.
 */

import { createHmac } from "node:crypto";

import { isAllowedArch, isAllowedOs, isValidVersion } from "./payload-validation";
import type { AnalyticsStore } from "./store";

export const ANALYTICS_PAYLOAD_KEYS = ["arch", "installId", "os", "ts", "version"] as const;

/** Reject client clocks more than ±24h from server time. */
export const TS_SKEW_MS = 24 * 60 * 60 * 1000;

export const MAX_BODY_BYTES = 512;

/** Raw dimension rows live this long; rollups are permanent. */
export const RAW_RETENTION_DAYS = 35;

export type AnalyticsIngestPayload = {
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

export function parseAnalyticsPayload(body: unknown): AnalyticsIngestPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== ANALYTICS_PAYLOAD_KEYS.length) return null;
  for (let i = 0; i < ANALYTICS_PAYLOAD_KEYS.length; i += 1) {
    if (keys[i] !== ANALYTICS_PAYLOAD_KEYS[i]) return null;
  }
  const installId = typeof record.installId === "string" ? record.installId.trim() : "";
  const version = typeof record.version === "string" ? record.version.trim() : "";
  const os = typeof record.os === "string" ? record.os.trim() : "";
  const arch = typeof record.arch === "string" ? record.arch.trim() : "";
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : NaN;
  if (!UUID_RE.test(installId)) return null;
  if (!isValidVersion(version)) return null;
  if (!isAllowedOs(os)) return null;
  if (!isAllowedArch(arch)) return null;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return { installId, version, os, arch, ts };
}

export function hashInstallId(secret: string, installId: string): string {
  return createHmac("sha256", secret).update(installId, "utf8").digest("hex");
}

export function isTimestampSkewed(clientTs: number, now: number, skewMs = TS_SKEW_MS): boolean {
  return Math.abs(clientTs - now) > skewMs;
}

export type IngestResult =
  | { readonly ok: true; readonly day: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

export async function ingestAnalyticsPing(input: {
  readonly method: string;
  readonly body: unknown;
  readonly hashSecret: string;
  readonly store: AnalyticsStore;
  readonly now?: number;
}): Promise<IngestResult> {
  if (input.method !== "POST") {
    return { ok: false, status: 405, error: "method_not_allowed" };
  }
  if (!input.hashSecret.trim()) {
    return { ok: false, status: 503, error: "misconfigured" };
  }
  const now = input.now ?? Date.now();
  const payload = parseAnalyticsPayload(input.body);
  if (!payload) {
    return { ok: false, status: 400, error: "invalid_payload" };
  }
  if (isTimestampSkewed(payload.ts, now)) {
    return { ok: false, status: 400, error: "timestamp_skew" };
  }

  const day = utcDayKey(now);
  // The store's (day, install_hash) key is the once-per-day gate. There is no
  // separate claim step to race against.
  await input.store.recordPing({
    day,
    installHash: hashInstallId(input.hashSecret, payload.installId),
    version: payload.version,
    os: payload.os,
    arch: payload.arch,
  });

  return { ok: true, day };
}
