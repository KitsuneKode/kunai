"use client";

import { useEffect, useState } from "react";

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
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return;
    setLocal(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        parsed,
      ),
    );
  }, [iso]);

  return <time dateTime={iso}>{local ?? utcLabel}</time>;
}
