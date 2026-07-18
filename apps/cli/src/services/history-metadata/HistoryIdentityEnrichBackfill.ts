// =============================================================================
// HistoryIdentityEnrichBackfill — one-shot/background crosswalk backfill.
//
// Scans latest-per-title history rows whose external id bag is missing a lane
// key, enriches them through CatalogIdentityService (ARM + cache, budgeted),
// merges the learned ids into every row of the title, then re-runs the
// identity consolidator so split anime/series units collapse. Only
// high-confidence graphs may rewrite anything; low confidence is a no-op.
// =============================================================================

import type { CatalogIdentityService } from "@/services/catalog/CatalogIdentityService";
import { runHistoryIdentityConsolidator } from "@/services/history-metadata/HistoryIdentityConsolidator";
import { HistoryRepository } from "@kunai/storage";
import type { HistoryProgress, KunaiDatabase } from "@kunai/storage";

export type HistoryIdentityEnrichBackfillStats = {
  readonly scanned: number;
  readonly enriched: number;
  readonly skippedComplete: number;
  readonly skippedLowConfidence: number;
  /** High-confidence enrichments that added no new ids (crosswalk has nothing more). */
  readonly skippedNoNewIds: number;
  readonly aborted: boolean;
};

export type HistoryIdentityEnrichBackfillOptions = {
  readonly db: KunaiDatabase;
  readonly identity: Pick<CatalogIdentityService, "enrich">;
  /** Max titles enriched per run (ARM budget). Cached hits do not refund it. */
  readonly budget?: number;
  readonly signal?: AbortSignal;
  readonly log?: (message: string) => void;
};

const DEFAULT_BUDGET = 10;

function isAnimeClass(row: HistoryProgress): boolean {
  return (
    row.mediaKind === "anime" ||
    Boolean(row.externalIds?.anilistId) ||
    Boolean(row.externalIds?.malId)
  );
}

function hasBothLaneIds(row: HistoryProgress): boolean {
  return Boolean(row.externalIds?.tmdbId) && Boolean(row.externalIds?.anilistId);
}

/** Anime rows missing TMDB first (series-lane unlock), then TMDB rows missing anime ids. */
function backfillPriority(row: HistoryProgress): number {
  return isAnimeClass(row) ? 0 : 1;
}

export async function runHistoryIdentityEnrichBackfill(
  options: HistoryIdentityEnrichBackfillOptions,
): Promise<HistoryIdentityEnrichBackfillStats> {
  const { db, identity, signal } = options;
  const budget = options.budget ?? DEFAULT_BUDGET;
  const log = options.log ?? (() => undefined);
  const repo = new HistoryRepository(db);

  const stats = {
    scanned: 0,
    enriched: 0,
    skippedComplete: 0,
    skippedLowConfidence: 0,
    skippedNoNewIds: 0,
    aborted: false,
  };

  const candidates: HistoryProgress[] = [];
  for (const row of repo.listLatestByTitle(500)) {
    stats.scanned += 1;
    if (row.mediaKind === "video") continue;
    if (hasBothLaneIds(row)) {
      stats.skippedComplete += 1;
      continue;
    }
    if (!row.externalIds?.anilistId && !row.externalIds?.malId && !row.externalIds?.tmdbId) {
      // Nothing to look up by; selection-time enrichment will handle it later.
      continue;
    }
    candidates.push(row);
  }
  candidates.sort((left, right) => backfillPriority(left) - backfillPriority(right));

  let mutated = false;
  for (const row of candidates.slice(0, budget)) {
    if (signal?.aborted) {
      stats.aborted = true;
      break;
    }

    const result = await identity.enrich(
      {
        id: row.titleId,
        kind: row.mediaKind,
        title: row.title,
        externalIds: row.externalIds,
      },
      { signal },
    );

    if (result.graph.confidence !== "high" || !result.externalIds) {
      stats.skippedLowConfidence += 1;
      continue;
    }

    // Only a real row change counts: re-confirming ids the rows already carry
    // must not re-trigger the whole-history consolidator on every startup.
    const changed = repo.backfillTitleMetadata(row.titleId, { externalIds: result.externalIds });
    if (!changed) {
      stats.skippedNoNewIds += 1;
      continue;
    }
    const gainedIds = Object.entries(result.externalIds)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    log(`identity backfill: ${row.titleId} now carries ${gainedIds.join(",")}`);
    stats.enriched += 1;
    mutated = true;
  }

  if (mutated) {
    runHistoryIdentityConsolidator(db, { log });
  }

  return stats;
}
