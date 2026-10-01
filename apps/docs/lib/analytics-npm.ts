/**
 * The npm registry's own download counts for the Kunai package.
 *
 * A different kind of number than everything else on the page, kept off the
 * ingest pipeline on purpose: npm counts every tarball fetch — first installs,
 * reinstalls, upgrades, CI mirrors — and never sees the install.sh / GitHub
 * release channel at all. It is a channel pulse, not an install count, and its
 * days are UTC, not the analytics IST grid.
 *
 * Fetched docs-side at ISR time alongside the other public reads; a failed or
 * malformed response yields `null` and the card simply does not render, same
 * as the metrics fetches.
 */

import { fetchAnalyticsJson } from "./analytics-fetch";

export const NPM_PACKAGE_NAME = "@kitsunekode/kunai";

/** Window the card plots — long enough to see a release, short enough to stay a sparkline. */
export const NPM_DOWNLOADS_WINDOW_DAYS = 30;

export type NpmDownloadPoint = {
  readonly day: string;
  readonly downloads: number;
};

export type NpmDownloadSeries = {
  readonly package: string;
  readonly from: string;
  readonly to: string;
  readonly points: readonly NpmDownloadPoint[];
};

export function npmDownloadsUrl(from: string, to: string, pkg = NPM_PACKAGE_NAME): string {
  return `https://api.npmjs.org/downloads/range/${from}:${to}/${pkg}`;
}

/**
 * The last `days` COMPLETE UTC days. npm totals are per UTC calendar day, so
 * ending at yesterday keeps a half-counted today off the right edge — the same
 * rule the rollup window applies.
 */
export function npmWindow(now: number = Date.now()): { from: string; to: string } {
  const to = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const from = new Date(now - NPM_DOWNLOADS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validate rather than trust: the response is a third-party shape consumed at
 * build time. One malformed entry drops the whole series — a chart drawn from
 * a half-parsed window misstates the channel it claims to show.
 */
export function parseNpmDownloads(raw: unknown): NpmDownloadSeries | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const pkg = record.package;
  const from = record.start;
  const to = record.end;
  if (typeof pkg !== "string" || !pkg) return null;
  if (typeof from !== "string" || !isCalendarDay(from)) return null;
  if (typeof to !== "string" || !isCalendarDay(to)) return null;
  if (from > to) return null;
  if (!Array.isArray(record.downloads) || record.downloads.length === 0) return null;

  const byDay = new Map<string, number>();
  for (const entry of record.downloads) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { day, downloads } = entry as Record<string, unknown>;
    if (typeof day !== "string" || !isCalendarDay(day)) return null;
    if (typeof downloads !== "number" || !Number.isFinite(downloads) || downloads < 0) return null;
    byDay.set(day, Math.floor(downloads));
  }

  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, downloads]) => ({ day, downloads }));
  return { package: pkg, from, to, points };
}

export async function fetchNpmDownloads(options?: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
}): Promise<NpmDownloadSeries | null> {
  const { from, to } = npmWindow(options?.now);
  const url = options?.url ?? npmDownloadsUrl(from, to);
  const json = await fetchAnalyticsJson(url, options?.fetchImpl ?? fetch);
  return parseNpmDownloads(json);
}
