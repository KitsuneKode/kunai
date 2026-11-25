/**
 * The published distribution counts: downloads per release and per platform,
 * installs and updates from the marker assets, and day-by-day deltas.
 *
 * These are counts of downloads, not of people. A download that was never run,
 * a CI job re-downloading, and a mirror all count. The page and badges say
 * "downloads" for that reason.
 */

import type { DistributionRow } from "./store.js";

export const DISTRIBUTION_SCHEMA_VERSION = 1;

/** Days of deltas the endpoint publishes. */
export const DISTRIBUTION_WINDOW_DAYS = 90;

export type DistributionDelta = {
  readonly day: string;
  /** GitHub binary assets plus npm platform packages, since the previous snapshot. */
  readonly downloads: number;
  /** `install.marker` downloads since the previous snapshot; null before any marker exists. */
  readonly installs: number | null;
  readonly updates: number | null;
};

export type PublicDistribution = {
  readonly schemaVersion: typeof DISTRIBUTION_SCHEMA_VERSION;
  /** Day of the newest snapshot. */
  readonly asOf: string;
  readonly totals: {
    /** `github + npm`: one per binary or npm install. Sums `perPlatform`. */
    readonly downloads: number;
    readonly github: number;
    /** npm platform packages. */
    readonly npm: number;
    /** The npm launcher, reported apart: every npm install also fetches a platform package. */
    readonly npmLauncher: number;
    readonly installs: number | null;
    readonly updates: number | null;
  };
  readonly perRelease: readonly {
    readonly release: string;
    readonly downloads: number;
    readonly installs: number | null;
    readonly updates: number | null;
  }[];
  readonly perPlatform: readonly {
    readonly platform: string;
    readonly github: number;
    readonly npm: number;
    readonly total: number;
  }[];
  readonly daily: readonly DistributionDelta[];
};

function seriesKey(row: Pick<DistributionRow, "source" | "release" | "platform">): string {
  return `${row.source}::${row.release}::${row.platform}`;
}

/** Downloads of the product itself, excluding markers and the npm launcher. */
function isDownload(row: Pick<DistributionRow, "source" | "platform">): boolean {
  return row.source === "github" || (row.source === "npm" && row.platform !== "launcher");
}

function groupByDay(rows: readonly DistributionRow[]): Map<string, DistributionRow[]> {
  const byDay = new Map<string, DistributionRow[]>();
  for (const row of [...rows].sort((a, b) => a.day.localeCompare(b.day))) {
    const day = byDay.get(row.day) ?? [];
    day.push(row);
    byDay.set(row.day, day);
  }
  return byDay;
}

/**
 * Deltas between consecutive snapshots.
 *
 * The first snapshot has no predecessor, so it is an opening total and yields
 * no point. A series absent from the previous snapshot (a new release, a new
 * platform) counts from zero. A counter that went down — an asset deleted and
 * re-uploaded resets on GitHub — contributes nothing rather than a negative.
 * A missed cron day means the next point covers more than one day.
 */
export function computeDistributionDeltas(rows: readonly DistributionRow[]): DistributionDelta[] {
  const days = [...groupByDay(rows).entries()];
  const markersEver = rows.some((row) => row.source === "marker");
  const deltas: DistributionDelta[] = [];

  for (let i = 1; i < days.length; i += 1) {
    const [, previousRows = []] = days[i - 1] ?? [];
    const [day = "", currentRows = []] = days[i] ?? [];
    const previous = new Map(previousRows.map((row) => [seriesKey(row), row.cumulative]));

    let downloads = 0;
    let installs = 0;
    let updates = 0;
    for (const row of currentRows) {
      const delta = Math.max(0, row.cumulative - (previous.get(seriesKey(row)) ?? 0));
      if (isDownload(row)) downloads += delta;
      else if (row.source === "marker" && row.platform === "install") installs += delta;
      else if (row.source === "marker" && row.platform === "update") updates += delta;
    }
    deltas.push({
      day,
      downloads,
      installs: markersEver ? installs : null,
      updates: markersEver ? updates : null,
    });
  }
  return deltas;
}

/** Newest-first by release tag, comparing numeric runs as numbers. */
function compareReleasesDescending(a: string, b: string): number {
  return b.localeCompare(a, "en", { numeric: true });
}

/** Null when there is no snapshot at all. */
export function buildPublicDistribution(
  rows: readonly DistributionRow[],
): PublicDistribution | null {
  const byDay = groupByDay(rows);
  const asOf = [...byDay.keys()].at(-1);
  if (!asOf) return null;
  const latest = byDay.get(asOf) ?? [];

  const hasMarkers = latest.some((row) => row.source === "marker");
  const sum = (filter: (row: DistributionRow) => boolean) =>
    latest.filter(filter).reduce((total, row) => total + row.cumulative, 0);

  const releases = new Map<string, { downloads: number; installs: number; updates: number }>();
  const platforms = new Map<string, { github: number; npm: number }>();
  for (const row of latest) {
    if (row.source !== "npm") {
      const release = releases.get(row.release) ?? { downloads: 0, installs: 0, updates: 0 };
      if (row.source === "github") release.downloads += row.cumulative;
      else if (row.platform === "install") release.installs += row.cumulative;
      else if (row.platform === "update") release.updates += row.cumulative;
      releases.set(row.release, release);
    }
    if (isDownload(row)) {
      const platform = platforms.get(row.platform) ?? { github: 0, npm: 0 };
      if (row.source === "github") platform.github += row.cumulative;
      else platform.npm += row.cumulative;
      platforms.set(row.platform, platform);
    }
  }

  const github = sum((row) => row.source === "github");
  const npm = sum((row) => row.source === "npm" && row.platform !== "launcher");
  return {
    schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    asOf,
    totals: {
      downloads: github + npm,
      github,
      npm,
      npmLauncher: sum((row) => row.source === "npm" && row.platform === "launcher"),
      installs: hasMarkers
        ? sum((row) => row.source === "marker" && row.platform === "install")
        : null,
      updates: hasMarkers
        ? sum((row) => row.source === "marker" && row.platform === "update")
        : null,
    },
    perRelease: [...releases.entries()]
      .sort(([a], [b]) => compareReleasesDescending(a, b))
      .map(([release, counts]) => ({
        release,
        downloads: counts.downloads,
        installs: hasMarkers ? counts.installs : null,
        updates: hasMarkers ? counts.updates : null,
      })),
    perPlatform: [...platforms.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([platform, counts]) => ({
        platform,
        github: counts.github,
        npm: counts.npm,
        total: counts.github + counts.npm,
      })),
    daily: computeDistributionDeltas(rows),
  };
}
