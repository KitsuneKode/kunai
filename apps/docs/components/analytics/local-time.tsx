"use client";

import { useEffect, useState } from "react";

function formatInViewerZone(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

/**
 * The viewer-local rendering of an ISO instant, or null when it cannot be
 * parsed — in which case the caller keeps showing its UTC label.
 *
 * Kept pure and separate from the component so it is testable without a DOM:
 * the parsing, the invalid-date guard and the formatting are what can go wrong,
 * not React running an effect.
 */
export function formatLocalTimestamp(
  iso: string,
  format: (date: Date) => string = formatInViewerZone,
): string | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed);
}

/**
 * Renders a UTC timestamp on the server and upgrades it to the viewer's own
 * clock after mount.
 *
 * The swap happens in an effect rather than during render, so the server HTML
 * and the first client render are identical and hydration does not mismatch.
 * Without JavaScript the UTC text simply stays.
 *
 * `iso` is already strict ISO 8601 — `parseDocsAnalyticsMetrics` normalises the
 * Postgres form the endpoint actually sends — so no engine is asked to parse a
 * shape it is not required to understand.
 *
 * Only the instant is localised. The day buckets themselves cannot be: they are
 * daily totals, and re-cutting them along a viewer's midnight would need the
 * individual pings, which are never stored.
 */
export function LocalTime({ iso, utcLabel }: { readonly iso: string; readonly utcLabel: string }) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    setLocal(formatLocalTimestamp(iso));
  }, [iso]);

  return <time dateTime={iso}>{local ?? utcLabel}</time>;
}
