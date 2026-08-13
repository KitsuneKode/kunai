import type { HistoryTitleAliasRepository, OfflineAssetsRepository } from "@kunai/storage";

export type OfflineAssetIdentityBackfillStats = {
  readonly titlesScanned: number;
  readonly titlesRelocated: number;
  readonly assetsRelocated: number;
};

/**
 * Move offline assets filed under a non-canonical title id onto the canonical
 * one the alias index knows.
 *
 * This runs on every bootstrap rather than once behind a migration marker. An
 * asset can be written under a raw id at a moment when nothing yet knows the
 * title's catalog ids, and only become relocatable later when history or
 * another download registers them — a one-shot pass would strand exactly those
 * rows. The scan is one `SELECT DISTINCT` over a table with tens of rows plus
 * one indexed point lookup each.
 */
export function runOfflineAssetIdentityBackfill(
  assets: Pick<OfflineAssetsRepository, "listDistinctTitleIds" | "relocateTitleId">,
  aliases: Pick<HistoryTitleAliasRepository, "lookupTitleIdByAliasId">,
): OfflineAssetIdentityBackfillStats {
  const titleIds = assets.listDistinctTitleIds();
  let titlesRelocated = 0;
  let assetsRelocated = 0;
  for (const titleId of titleIds) {
    const canonical = aliases.lookupTitleIdByAliasId(titleId);
    if (!canonical || canonical === titleId) continue;
    const moved = assets.relocateTitleId(titleId, canonical);
    if (moved === 0) continue;
    titlesRelocated += 1;
    assetsRelocated += moved;
  }
  return { titlesScanned: titleIds.length, titlesRelocated, assetsRelocated };
}
