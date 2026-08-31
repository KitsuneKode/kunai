import { mergeHistoryWatchState } from "@/domain/continuation/merge-history-progress";
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
  // One transaction for the whole pass: the per-row alias upserts and rekeys
  // otherwise each pay their own commit fsync, which turns a full-history scan
  // into seconds of synchronous SQLite work on the startup path.
  const consolidate = db.transaction(() => {
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

      // The newer row wins the *identity* — its key, title and ids are the ones
      // the user most recently touched. It does not automatically win the watch
      // state: a row opened a minute ago at 10s does not undo yesterday's 100s.
      const keepNewer = selectIdentitySurvivor(row, existing);
      const drop = keepNewer.key === row.key ? existing : row;
      const watchState = mergeHistoryWatchState(keepNewer, drop);

      log(
        `merge ${drop.key} into ${keepNewer.key} (keep newer updated_at, keep furthest progress)`,
      );
      if (!options.dryRun) {
        const mergedExternalIds = mergeBackfillExternalIds(keepNewer.externalIds, drop.externalIds);
        if (mergedExternalIds) {
          repo.updateProgressExternalIdsByKey(keepNewer.key, mergedExternalIds);
        }
        repo.updateProgressWatchStateByKey(keepNewer.key, watchState);
        // The survivor is the most recently touched row, which is often the one
        // that arrived with the least metadata. Title and external ids already
        // merge across; the poster did not, so it went out with the deleted row
        // and the entry lost its artwork in the library and continue-watching.
        if (drop.posterUrl) repo.fillMissingPosterByKey(keepNewer.key, drop.posterUrl);
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
  });
  consolidate();

  return stats;
}
/**
 * Which of two rows keeps the identity: the one touched most recently.
 *
 * A direct `Date.parse(a) >= Date.parse(b)` cannot express this, because every
 * comparison against `NaN` is false. A corrupt `updated_at` therefore won
 * whenever it happened to sit on the right-hand side and lost whenever it sat on
 * the left — the survivor depended on iteration order rather than on the data.
 * A row with a readable timestamp is always the better identity than one without.
 */
function selectIdentitySurvivor<T extends { readonly updatedAt: string }>(left: T, right: T): T {
  const leftAt = Date.parse(left.updatedAt);
  const rightAt = Date.parse(right.updatedAt);
  const leftOk = Number.isFinite(leftAt);
  const rightOk = Number.isFinite(rightAt);

  if (leftOk !== rightOk) return leftOk ? left : right;
  // Both unreadable: keep `right`, which is the already-stored row, so a merge
  // between two corrupt rows stays put instead of shuffling on every pass.
  if (!leftOk) return right;
  return leftAt >= rightAt ? left : right;
}
