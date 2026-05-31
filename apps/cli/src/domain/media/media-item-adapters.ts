import type { SearchResult } from "@/domain/types";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

import type { MediaItemIdentity } from "./media-item-identity";

export function mediaItemFromHistoryEntry(
  titleId: string,
  entry: HistoryProgress,
): MediaItemIdentity {
  return {
    mediaKind: historyContentType(entry),
    titleId,
    title: entry.title,
    season: entry.season ?? 1,
    episode: entry.episode ?? entry.absoluteEpisode ?? 1,
    providerHints: [{ providerId: entry.providerId ?? "unknown" }],
  };
}

export function mediaItemFromSearchResult(result: SearchResult): MediaItemIdentity {
  return {
    mediaKind: result.type,
    sourceId: result.metadataSource,
    titleId: result.id,
    title: result.title,
  };
}
