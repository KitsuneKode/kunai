import type {
  CatalogScheduleInput,
  CatalogSeriesReleaseProgress,
} from "@/services/catalog/CatalogScheduleService";

import type { CatalogProgressResult } from "./ReleaseReconciliationService";
import type { ReleaseReconciliationCandidate } from "./types";

const ANILIST_BATCH_SIZE = 50;
const ANILIST_BATCH_LIMIT = 2;
const TMDB_TITLE_LIMIT = 5;

export type CatalogProgressPort = {
  readonly prefetchAnimeReleaseProgressForTitles: (
    titleIds: readonly string[],
    signal: AbortSignal,
  ) => Promise<void>;
  readonly peekAnimeReleaseProgress: (titleId: string) => CatalogSeriesReleaseProgress | null;
  readonly getSeriesReleaseProgress: (
    input: CatalogScheduleInput,
    signal?: AbortSignal,
  ) => Promise<CatalogSeriesReleaseProgress | null>;
};

export async function loadCatalogProgress(
  catalog: CatalogProgressPort,
  candidates: readonly ReleaseReconciliationCandidate[],
  signal?: AbortSignal,
): Promise<readonly CatalogProgressResult[]> {
  if (signal?.aborted) return [];
  const workSignal = signal ?? new AbortController().signal;
  const anilist = candidates.filter((candidate) => candidate.source === "anilist");
  const tmdb = candidates
    .filter((candidate) => candidate.source === "tmdb")
    .slice(0, TMDB_TITLE_LIMIT);
  const allowedAniList = anilist.slice(0, ANILIST_BATCH_SIZE * ANILIST_BATCH_LIMIT);

  for (let offset = 0; offset < allowedAniList.length; offset += ANILIST_BATCH_SIZE) {
    if (workSignal.aborted) break;
    await catalog.prefetchAnimeReleaseProgressForTitles(
      allowedAniList
        .slice(offset, offset + ANILIST_BATCH_SIZE)
        .map((candidate) => candidate.catalogId),
      workSignal,
    );
  }

  const anilistProgress = allowedAniList.flatMap((candidate) => {
    const progress = catalog.peekAnimeReleaseProgress(candidate.catalogId);
    if (!progress) return [];
    return [
      {
        candidate,
        ...progress,
      },
    ];
  });

  const tmdbProgress: CatalogProgressResult[] = [];
  for (const candidate of tmdb) {
    if (workSignal.aborted || !candidate.anchorSeason) break;
    const result = await catalog.getSeriesReleaseProgress(
      {
        source: "tmdb",
        titleId: candidate.catalogId,
        titleName: candidate.title,
        type: "series",
        season: candidate.anchorSeason,
      },
      workSignal,
    );
    if (result) tmdbProgress.push({ candidate, ...result });
  }

  return [...anilistProgress, ...tmdbProgress];
}
