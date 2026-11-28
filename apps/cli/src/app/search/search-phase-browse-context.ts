import { toBrowseResultOption } from "@/app/search/browse-option-mappers";
import type { PhaseContext } from "@/app/session/Phase";
import type { SearchResult } from "@/domain/types";
import {
  resultEnrichmentKey,
  type ResultEnrichment,
} from "@/services/catalog/ResultEnrichmentService";
import { readLatestHistoryByTitle } from "@/services/continuation/history-progress";
import type { FollowedTitlePreference, HistoryProgress } from "@kunai/storage";

export type BrowseDisplayContext = {
  readonly historyMap: Record<string, HistoryProgress>;
  readonly enrichments: ReadonlyMap<string, ResultEnrichment>;
  readonly queueTitleIds: ReadonlySet<string>;
  readonly followPreferenceByTitleId: ReadonlyMap<string, FollowedTitlePreference>;
};

export async function loadBrowseDisplayContext(
  container: PhaseContext["container"],
  results: readonly SearchResult[],
  options?: {
    readonly preloadedHistory?: Record<string, HistoryProgress>;
    readonly signal?: AbortSignal;
  },
): Promise<BrowseDisplayContext> {
  const historyMap =
    options?.preloadedHistory ??
    (() => {
      try {
        return readLatestHistoryByTitle(container.historyRepository);
      } catch {
        return {};
      }
    })();
  const enrichments = await container.resultEnrichmentService
    .enrichResults(results, { preloadedHistory: historyMap, signal: options?.signal })
    .catch((error: unknown) => {
      // A cancelled route must stay cancelled; only real enrichment failures
      // degrade to "no badges".
      if (error instanceof Error && error.name === "AbortError") throw error;
      return new Map<string, ResultEnrichment>();
    });
  const queueTitleIds = new Set(
    container.queueService
      .getAll()
      .filter((item) => !item.playedAt)
      .map((item) => item.titleId),
  );
  const followPreferenceByTitleId = new Map<string, FollowedTitlePreference>();
  for (const result of results) {
    const preference = container.followedTitleRepository.get(result.id)?.preference;
    if (preference && preference !== "implicit") {
      followPreferenceByTitleId.set(result.id, preference);
    }
  }

  return { historyMap, enrichments, queueTitleIds, followPreferenceByTitleId };
}

export function mapBrowseResultOption(
  container: PhaseContext["container"],
  context: BrowseDisplayContext,
  result: SearchResult,
): ReturnType<typeof toBrowseResultOption> {
  return toBrowseResultOption(
    result,
    context.historyMap[result.id] ?? null,
    container.config.animeTitlePreference,
    context.enrichments.get(resultEnrichmentKey(result)) ?? null,
    container.listService,
    {
      followPreference: context.followPreferenceByTitleId.get(result.id),
      inUpNextQueue: context.queueTitleIds.has(result.id),
    },
  );
}
