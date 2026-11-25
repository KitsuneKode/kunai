/**
 * Anonymous usage ingest — privacy contract
 *
 * Accepts POST bodies shaped exactly as one of:
 *   v1: { installId, version, os, arch, ts }
 *   v2: { id, cohort, day, version, os, arch }
 *
 * v1 is accepted forever: published binaries are immutable, and every one of
 * them treats a 4xx as permanent for 24 hours. v2 has to be accepted here
 * before any client sends it, for the same reason.
 *
 * Stores only:
 * - ping_day: HMAC(id) + version/os/arch, 35-day retention
 * - month_active: HMAC(id) + the v2 cohort month, kept until the month after
 *   is a week old, then folded into aggregate rollups
 * - install_lifetime (v1 only): HMAC(installId) + first/last-seen dates; folds
 *   into a retired counter after the silence window
 * - daily_rollup, month_rollup, cohort_rollup: aggregate counts, no identity
 *
 * Never stores or accepts: raw install UUIDs, IP addresses, titles, queries,
 * provider results, URLs, or file paths. This module never reads a client IP
 * at all — there is no rate-limit key to derive one for.
 *
 * `version`, `os`, and `arch` are aggregation keys, validated against strict
 * semver and closed allowlists so a hostile client cannot inject a fabricated
 * dimension into published aggregates.
 *
 * Abuse model: a hostile client can mint many install ids and inflate counts.
 * The (day, install_hash) primary key caps a real install at one row per day.
 * No one can expose another user's watch history — that data is never accepted.
 */

import { createHmac } from "node:crypto";

import { z } from "zod";

import { analyticsDayKey, shiftDayKey } from "./analytics-day.js";
import {
  isAllowedArch,
  isAllowedOs,
  isValidCohort,
  isValidDayLabel,
  isValidVersion,
} from "./payload-validation.js";
import type { AnalyticsStore } from "./store.js";

/** The v1 wire keys, sorted. Every client released so far sends exactly these. */
export const ANALYTICS_PAYLOAD_KEYS = ["arch", "installId", "os", "ts", "version"] as const;

/** The v2 wire keys, sorted. No client sends these yet; the ingest accepts them first. */
export const ANALYTICS_PAYLOAD_V2_KEYS = ["arch", "cohort", "day", "id", "os", "version"] as const;

/** Reject v1 client clocks more than ±24h from server time. */
export const TS_SKEW_MS = 24 * 60 * 60 * 1000;

/** A v2 `day` may differ from the ingest's own label by at most this many days. */
export const DAY_LABEL_WINDOW_DAYS = 1;

export const MAX_BODY_BYTES = 512;

/** Raw dimension rows live this long; rollups are permanent. */
export const RAW_RETENTION_DAYS = 35;

type PingDimensions = {
  readonly version: string;
  readonly os: string;
  readonly arch: string;
};

/** Every release up to and including 0.3.x. */
export type AnalyticsPingV1 = PingDimensions & {
  readonly wire: 1;
  readonly installId: string;
  readonly ts: number;
};

/**
 * The monthly-rotating payload. `id` is `HMAC-SHA256(localSecret, "YYYY-MM")`
 * computed on the client, so the same install sends an unrelated id each month.
 */
export type AnalyticsPingV2 = PingDimensions & {
  readonly wire: 2;
  readonly id: string;
  /** `YYYY-MM`: the month analytics was enabled on this install. */
  readonly cohort: string;
  /** `YYYY-MM-DD`: the client's own day label. */
  readonly day: string;
};

export type AnalyticsIngestPayload = AnalyticsPingV1 | AnalyticsPingV2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A client-side `sha256(installId)` (v1) or a monthly HMAC (v2): 64 hex either
 * way, so the raw install id never leaves the machine that generated it.
 *
 * Both v1 shapes are accepted, and the order that matters is deployment order:
 * the ingest has to accept a shape *before* any client sends one, or every
 * ping from an upgraded install answers 400 until this deploys. Published
 * binaries are immutable, so the UUID branch stays for as long as pre-0.3.0
 * installs ping -- it is not transitional scaffolding to delete on a schedule.
 */
const INSTALL_DIGEST_RE = /^[0-9a-f]{64}$/i;

export function isAcceptedInstallId(value: string): boolean {
  return UUID_RE.test(value) || INSTALL_DIGEST_RE.test(value);
}

const dimensions = {
  version: z.string().trim().refine(isValidVersion),
  os: z.string().trim().refine(isAllowedOs),
  arch: z.string().trim().refine(isAllowedArch),
};

/** `strictObject` is the sixth-key rule: an unknown key fails the decode. */
const pingV1Schema = z.strictObject({
  installId: z.string().trim().refine(isAcceptedInstallId),
  ...dimensions,
  ts: z.number().positive(),
});

const pingV2Schema = z
  .strictObject({
    id: z.string().trim().regex(INSTALL_DIGEST_RE),
    cohort: z.string().trim().refine(isValidCohort),
    day: z.string().trim().refine(isValidDayLabel),
    ...dimensions,
  })
  // A cohort is the month analytics was enabled, so it cannot postdate the
  // ping reporting it. `day` itself is checked against the ingest clock later.
  .refine((ping) => ping.cohort <= ping.day.slice(0, 7));

/**
 * Decode either wire shape, or null.
 *
 * The two key sets share only the three dimensions, so a body matches at most
 * one schema; a mixture of the two matches neither.
 */
export function parseAnalyticsPayload(body: unknown): AnalyticsIngestPayload | null {
  const v1 = pingV1Schema.safeParse(body);
  if (v1.success) return { wire: 1, ...v1.data };
  const v2 = pingV2Schema.safeParse(body);
  // Lower-cased so one client id cannot become two installs by changing case.
  if (v2.success) return { wire: 2, ...v2.data, id: v2.data.id.toLowerCase() };
  return null;
}

export function hashInstallId(secret: string, installId: string): string {
  return createHmac("sha256", secret).update(installId, "utf8").digest("hex");
}

export function isTimestampSkewed(clientTs: number, now: number, skewMs = TS_SKEW_MS): boolean {
  return Math.abs(clientTs - now) > skewMs;
}

/**
 * Whether a v2 client day label sits within ±{@link DAY_LABEL_WINDOW_DAYS} of
 * the ingest's own label. This replaces the v1 `ts` check: it gives the same
 * replay and skew protection without a precise client clock reading.
 */
export function isDayLabelInWindow(clientDay: string, ingestDay: string): boolean {
  return (
    clientDay >= shiftDayKey(ingestDay, -DAY_LABEL_WINDOW_DAYS) &&
    clientDay <= shiftDayKey(ingestDay, DAY_LABEL_WINDOW_DAYS)
  );
}

/** `YYYY-MM` of a `YYYY-MM-DD` label. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

export type IngestResult =
  /**
   * `stored: false` means the day's global write budget was already spent. The
   * request is still a success as far as the client is concerned — a flood must
   * not learn where the ceiling sits, and a legitimate client cannot act on it
   * either — but the caller can see it, so the drop is never silent to us.
   * `duplicate: true` means the install already pinged today, so nothing was
   * written and no budget was spent.
   */
  | {
      readonly ok: true;
      readonly day: string;
      readonly stored: boolean;
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly status: number; readonly error: string };

export type IngestRequest = {
  readonly method: string;
  readonly body: unknown;
  readonly hashSecret: string;
  readonly store: AnalyticsStore;
  readonly now?: number;
};

export async function ingestAnalyticsPing(input: IngestRequest): Promise<IngestResult> {
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

  const day = analyticsDayKey(now);
  if (payload.wire === 1 && isTimestampSkewed(payload.ts, now)) {
    return { ok: false, status: 400, error: "timestamp_skew" };
  }
  if (payload.wire === 2 && !isDayLabelInWindow(payload.day, day)) {
    return { ok: false, status: 400, error: "day_out_of_window" };
  }

  // The store's (day, install_hash) key is the once-per-day gate. There is no
  // separate claim step to race against. The store also charges the day's
  // global admission budget in the same statement.
  const result = await input.store.recordPing({
    day,
    installHash: hashInstallId(
      input.hashSecret,
      payload.wire === 1 ? payload.installId : payload.id,
    ),
    version: payload.version,
    os: payload.os,
    arch: payload.arch,
    // v2 ids rotate on the client's month, so the month they count toward is
    // the client's — validated above to be within a day of ours. v1 ids never
    // rotate and have no cohort; they keep their install_lifetime row.
    v2:
      payload.wire === 2
        ? { activeMonth: monthOfDay(payload.day), cohort: payload.cohort }
        : undefined,
  });

  return { ok: true, day, stored: result.admitted, duplicate: result.duplicate };
}
