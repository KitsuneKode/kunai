import type { QueueEntry, QueuePlaybackFailureRecord } from "@kunai/storage";
import type { ProviderExternalIds } from "@kunai/types";

/** CLI alias for the storage failure record carried through pre-start rollback. */
export type QueuePlaybackFailureContext = QueuePlaybackFailureRecord;

export interface QueuePlaybackIntent {
  readonly queueEntryId: string;
  readonly titleId: string;
  readonly mediaKind: "movie" | "series" | "anime";
  readonly contentType?: "movie" | "series";
  readonly externalIds?: ProviderExternalIds;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly source: "queue" | "auto-next" | "post-play";
}

function normalizeMediaKind(mediaKind: string): QueuePlaybackIntent["mediaKind"] {
  if (mediaKind === "movie" || mediaKind === "anime") return mediaKind;
  return "series";
}

export function queuePlaybackIntentFromEntry(
  entry: QueueEntry,
  source: QueuePlaybackIntent["source"],
): QueuePlaybackIntent {
  return {
    queueEntryId: entry.id,
    titleId: entry.titleId,
    mediaKind: normalizeMediaKind(entry.mediaKind),
    contentType: entry.contentType,
    externalIds: entry.externalIds,
    season: entry.season,
    episode: entry.episode,
    absoluteEpisode: entry.absoluteEpisode,
    source,
  };
}
