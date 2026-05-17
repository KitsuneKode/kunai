import type { SearchResult } from "@/domain/types";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

import type { MediaItemIdentity } from "./media-item-identity";

export function mediaItemFromHistoryEntry(titleId: string, entry: HistoryEntry): MediaItemIdentity {
  return {
    mediaKind: entry.type,
    titleId,
    title: entry.title,
    season: entry.season,
    episode: entry.episode,
    providerHints: [{ providerId: entry.provider }],
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
