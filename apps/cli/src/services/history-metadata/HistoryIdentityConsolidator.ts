import { mergeBackfillExternalIds, resolveCanonicalCatalogTitleId } from "@kunai/core";
import {
  createHistoryKey,
  externalIdsToAliases,
  HistoryRepository,
  HistoryTitleAliasRepository,
} from "@kunai/storage";
import type { KunaiDatabase } from "@kunai/storage";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export type HistoryIdentityConsolidatorStats = {
  readonly scanned: number;
  readonly retitled: number;
  readonly merged: number;
  readonly skippedNoProof: number;
  readonly skippedAlreadyCanonical: number;
  readonly skippedAmbiguous: number;
};

export type HistoryIdentityConsolidatorOptions = {
  readonly dryRun?: boolean;
  readonly log?: (message: string) => void;
};

function hasCatalogProof(
  mediaKind: MediaKind,
  externalIds: ProviderExternalIds | undefined,
): boolean {
  if (!externalIds) return false;
  if (mediaKind === "anime") return Boolean(externalIds.anilistId);
  if (mediaKind === "movie" || mediaKind === "series") {
    // AniList/MAL only catalog anime, so their ids are proof of an anime-class
    // work even on rows persisted through the TMDB lane.
    return Boolean(externalIds.tmdbId || externalIds.anilistId || externalIds.malId);
  }
  return Boolean(externalIds.anilistId || externalIds.tmdbId);
}

/** Anime-class when any anime-catalog id exists (they only catalog anime). */
function contentClassOf(externalIds: ProviderExternalIds | undefined): "anime" | "general" {
  return externalIds?.anilistId || externalIds?.malId ? "anime" : "general";
}

function catalogIdsConflict(
  left: ProviderExternalIds | undefined,
  right: ProviderExternalIds | undefined,
): boolean {
  if (left?.anilistId && right?.anilistId && left.anilistId !== right.anilistId) return true;
  if (left?.tmdbId && right?.tmdbId && left.tmdbId !== right.tmdbId) return true;
  return false;
}

export function runHistoryIdentityConsolidator(
  db: KunaiDatabase,
  options: HistoryIdentityConsolidatorOptions = {},
): HistoryIdentityConsolidatorStats {
  const repo = new HistoryRepository(db);
  const aliases = new HistoryTitleAliasRepository(db);
  const log = options.log ?? (() => undefined);
  const stats = {
    scanned: 0,
    retitled: 0,
    merged: 0,
    skippedNoProof: 0,
    skippedAlreadyCanonical: 0,
    skippedAmbiguous: 0,
  } satisfies HistoryIdentityConsolidatorStats;

  const rows = repo.listAllProgress();
  for (const row of rows) {
    stats.scanned += 1;
    const externalIds = row.externalIds;
    if (!hasCatalogProof(row.mediaKind, externalIds)) {
      stats.skippedNoProof += 1;
      continue;
    }

    const canonicalId = resolveCanonicalCatalogTitleId(
      {
        id: row.titleId,
        kind: row.mediaKind,
        externalIds,
      },
      { contentClass: contentClassOf(externalIds) },
    );
    if (row.titleId === canonicalId) {
      if (!options.dryRun) {
        aliases.upsertAliases(canonicalId, externalIdsToAliases(externalIds));
      }
      stats.skippedAlreadyCanonical += 1;
      continue;
    }

    const canonicalTitle = {
      id: canonicalId,
      kind: row.mediaKind,
      title: row.title,
      externalIds,
    };
    const newKey = createHistoryKey(canonicalTitle, {
      season: row.season,
      episode: row.episode,
      absoluteEpisode: row.absoluteEpisode,
    });
    const existing = repo.getProgressByKey(newKey);

    if (!existing) {
      log(`retitle ${row.key} → title_id=${canonicalId} key=${newKey}`);
      if (!options.dryRun) {
        repo.rekeyProgressRow(row.key, canonicalId, newKey);
        aliases.reassignTitleId(row.titleId, canonicalId);
        aliases.upsertAliases(canonicalId, externalIdsToAliases(externalIds));
      }
      stats.retitled += 1;
      continue;
    }

    if (catalogIdsConflict(existing.externalIds, externalIds)) {
      log(`skip ambiguous merge for ${row.key} vs ${existing.key}`);
      stats.skippedAmbiguous += 1;
      continue;
    }

    const keepNewer = Date.parse(row.updatedAt) >= Date.parse(existing.updatedAt) ? row : existing;
    const drop = keepNewer.key === row.key ? existing : row;

    log(`merge ${drop.key} into ${keepNewer.key} (keep newer updated_at)`);
    if (!options.dryRun) {
      const mergedExternalIds = mergeBackfillExternalIds(keepNewer.externalIds, drop.externalIds);
      if (mergedExternalIds) {
        repo.updateProgressExternalIdsByKey(keepNewer.key, mergedExternalIds);
      }
      repo.deleteProgressByKey(drop.key);
      if (keepNewer.key !== newKey) {
        repo.rekeyProgressRow(keepNewer.key, canonicalId, newKey);
      }
      aliases.reassignTitleId(row.titleId, canonicalId);
      aliases.upsertAliases(
        canonicalId,
        externalIdsToAliases(mergeBackfillExternalIds(keepNewer.externalIds, drop.externalIds)),
      );
    }
    stats.merged += 1;
  }

  return stats;
}
