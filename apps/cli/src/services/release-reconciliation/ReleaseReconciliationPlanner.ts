import {
  compareEpisodeCursors,
  pickHighestEpisodeCursor,
  toEpisodeCursor,
} from "@/domain/media/episode-cursor";

import type {
  ExistingReleaseProjection,
  ReleaseReconciliationCandidate,
  ReleaseReconciliationHistoryRow,
  ReleaseReconciliationSkip,
  ReleaseReconciliationTrigger,
} from "./types";

export const RECONCILIATION_TRIGGER_BUDGETS: Record<ReleaseReconciliationTrigger, number> = {
  startup: 25,
  "browse-idle": 10,
  history: 50,
  calendar: 50,
  "post-playback": 1,
};

export type PlanReleaseReconciliationCandidatesInput = {
  readonly trigger: ReleaseReconciliationTrigger;
  readonly now: string;
  readonly historyRows: readonly ReleaseReconciliationHistoryRow[];
  readonly existingProjections: ReadonlyMap<string, ExistingReleaseProjection>;
  readonly mutedTitleIds?: ReadonlySet<string>;
};

export type ReleaseReconciliationCandidatePlan = {
  readonly candidates: readonly ReleaseReconciliationCandidate[];
  readonly skipped: readonly ReleaseReconciliationSkip[];
};

export function planReleaseReconciliationCandidates(
  input: PlanReleaseReconciliationCandidatesInput,
): ReleaseReconciliationCandidatePlan {
  const skipped: ReleaseReconciliationSkip[] = [];
  const grouped = new Map<string, ReleaseReconciliationHistoryRow[]>();

  for (const row of input.historyRows) {
    if (row.mediaKind === "movie") {
      skipped.push({ titleId: row.titleId, reason: "movie" });
      continue;
    }
    if (row.mediaKind !== "series" && row.mediaKind !== "anime") {
      skipped.push({ titleId: row.titleId, reason: "missing-catalog-id" });
      continue;
    }
    if (input.mutedTitleIds?.has(row.titleId)) {
      skipped.push({ titleId: row.titleId, reason: "muted" });
      continue;
    }

    const identity = getCatalogIdentity(row);
    if (!identity) {
      skipped.push({ titleId: row.titleId, reason: "missing-catalog-id" });
      continue;
    }

    const groupKey = `${identity.source}:${identity.catalogId}`;
    const group = grouped.get(groupKey) ?? [];
    group.push(row);
    grouped.set(groupKey, group);
  }

  const planned: ReleaseReconciliationCandidate[] = [];
  const budget = RECONCILIATION_TRIGGER_BUDGETS[input.trigger];
  const sortedGroups = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [, rows] of sortedGroups) {
    const first = rows[0];
    if (!first) continue;
    const identity = getCatalogIdentity(first);
    if (!identity) continue;

    const highest = pickHighestEpisodeCursor(rows);
    if (!highest || typeof highest.episode !== "number") {
      skipped.push({ titleId: first.titleId, reason: "no-normal-episode" });
      continue;
    }

    const dueProjection = input.existingProjections.get(first.titleId);
    if (dueProjection && dueProjection.nextCheckAt > input.now) {
      skipped.push({ titleId: first.titleId, reason: "not-due" });
      continue;
    }

    if (planned.length >= budget) {
      skipped.push({ titleId: first.titleId, reason: "budget-exhausted" });
      continue;
    }

    const rowForTitle = pickHighestRow(rows);
    planned.push({
      titleId: first.titleId,
      mediaKind: first.mediaKind === "anime" ? "anime" : "series",
      source: identity.source,
      catalogId: identity.catalogId,
      title: rowForTitle?.title ?? first.title,
      season: highest.season,
      episode: highest.episode,
      absoluteEpisode: highest.absoluteEpisode,
      anchorSeason: highest.season,
      anchorEpisode: highest.episode,
    });
  }

  return { candidates: planned, skipped };
}

function pickHighestRow(
  rows: readonly ReleaseReconciliationHistoryRow[],
): ReleaseReconciliationHistoryRow | undefined {
  return [...rows].sort((left, right) => {
    const leftCursor = toEpisodeCursor(left);
    const rightCursor = toEpisodeCursor(right);
    if (leftCursor && rightCursor) return compareEpisodeCursors(rightCursor, leftCursor);
    if (leftCursor) return -1;
    if (rightCursor) return 1;
    return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
  })[0];
}

function getCatalogIdentity(
  row: ReleaseReconciliationHistoryRow,
): { source: "anilist" | "tmdb"; catalogId: string } | undefined {
  if (row.externalIds?.anilistId) {
    return { source: "anilist", catalogId: row.externalIds.anilistId };
  }
  if (row.externalIds?.tmdbId) {
    return { source: "tmdb", catalogId: row.externalIds.tmdbId };
  }
  if (row.titleId.startsWith("anilist:")) {
    return { source: "anilist", catalogId: row.titleId.slice("anilist:".length) };
  }
  if (row.titleId.startsWith("tmdb:")) {
    return { source: "tmdb", catalogId: row.titleId.slice("tmdb:".length) };
  }
  return undefined;
}
