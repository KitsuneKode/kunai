/**
 * shields.io endpoint badges: https://shields.io/badges/endpoint-badge
 *
 * Each badge is built from a figure the ingest already publishes, with the
 * same small-cell floor, so a badge can never say more than the JSON beside it.
 */

import type { PublicDistribution } from "./public-distribution.js";
import { SMALL_CELL_FLOOR } from "./public-metrics.js";
import type { MonthRollup } from "./store.js";

export const BADGE_NAMES = ["downloads", "active", "installs"] as const;
export type BadgeName = (typeof BADGE_NAMES)[number];

/**
 * Wording is still an open maintainer decision (Decision 4 of the analytics
 * plan); this is its stated default. The figure is the last complete calendar
 * month, the closest exact window to 30 days that does not step daily.
 */
export const ACTIVE_BADGE_LABEL = "active (opted in, 30d)";

export const BADGE_CACHE_SECONDS = 3600;

export type ShieldsBadge = {
  readonly schemaVersion: 1;
  readonly label: string;
  readonly message: string;
  readonly color: string;
  readonly cacheSeconds: number;
};

export function isBadgeName(value: string): value is BadgeName {
  return BADGE_NAMES.some((name) => name === value);
}

/** `999`, `1k`, `12.3k`, `4.5M`. */
export function formatBadgeCount(count: number): string {
  const units: [number, string][] = [
    [1_000_000, "M"],
    [1_000, "k"],
  ];
  for (const [size, suffix] of units) {
    if (count >= size) {
      const scaled = Math.floor((count / size) * 10) / 10;
      return `${scaled.toFixed(1).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(count);
}

/**
 * A badge for one count. Null renders as "unavailable" rather than zero: the
 * figure does not exist yet, which is different from nobody.
 */
export function countBadge(label: string, count: number | null): ShieldsBadge {
  if (count === null) {
    return {
      schemaVersion: 1,
      label,
      message: "unavailable",
      color: "lightgrey",
      cacheSeconds: BADGE_CACHE_SECONDS,
    };
  }
  return {
    schemaVersion: 1,
    label,
    message: count < SMALL_CELL_FLOOR ? `fewer than ${SMALL_CELL_FLOOR}` : formatBadgeCount(count),
    color: "blue",
    cacheSeconds: BADGE_CACHE_SECONDS,
  };
}

export type BadgeSources = {
  readonly distribution: PublicDistribution | null;
  /** The last complete month's rollup, if there is one. */
  readonly lastCompleteMonth: MonthRollup | null;
};

export function buildBadge(name: BadgeName, sources: BadgeSources): ShieldsBadge {
  switch (name) {
    case "downloads":
      return countBadge("downloads", sources.distribution?.totals.downloads ?? null);
    case "active":
      return countBadge(ACTIVE_BADGE_LABEL, sources.lastCompleteMonth?.activeInstalls ?? null);
    case "installs":
      // Null until release assets carry `install.marker`: before that, GitHub
      // cannot tell an install from an update, and neither can this.
      return countBadge("installs", sources.distribution?.totals.installs ?? null);
  }
}
