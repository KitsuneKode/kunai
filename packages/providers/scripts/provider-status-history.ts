/**
 * The per-day record behind the status page's history strips.
 *
 * The sweep writes two things each run: the latest result for every provider
 * (`generated-provider-status.json`) and this, one line per provider per day,
 * kept for the last `HISTORY_KEEP_DAYS` days. The strips on the page are read from
 * it. It stores a status per provider per day and nothing else, so it stays small
 * (a year of it would be a few tens of kilobytes) and a bad day can be read at a
 * glance.
 *
 * Pure: it takes the previous file and returns the next one, so the trimming and
 * the "a second run on the same day replaces the first" rule are tested without a
 * network or a clock.
 */

export type SweepStatus = "healthy" | "degraded" | "blocked" | "down" | "dead";

export type HistoryDay = {
  /** UTC calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  /** Provider id to the status the sweep gave it that day. */
  readonly providers: Readonly<Record<string, SweepStatus>>;
};

export type HistoryFile = {
  readonly schemaVersion: 1;
  /** Oldest first. */
  readonly days: readonly HistoryDay[];
};

/** Long enough to see a provider that flaps, short enough to stay a glance. */
export const HISTORY_KEEP_DAYS = 60;

/** The UTC day an ISO timestamp falls on. */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Add (or replace) one day. Days stay sorted oldest first and are trimmed to the
 * newest `keep`. A second sweep on the same UTC day replaces the first rather than
 * adding a duplicate day, so a manual re-run never double-counts.
 */
export function updateHistory(
  previous: HistoryFile | null,
  day: string,
  statuses: Readonly<Record<string, SweepStatus>>,
  keep: number = HISTORY_KEEP_DAYS,
): HistoryFile {
  const others = (previous?.days ?? []).filter((entry) => entry.day !== day);
  const days = [...others, { day, providers: statuses }]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-keep);
  return { schemaVersion: 1, days };
}
