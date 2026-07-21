import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import { queuePlaybackIntentFromEntry } from "@/domain/queue/queue-playback-intent";
import type { EpisodeInfo, SearchResult, TitleInfo } from "@/domain/types";
import { historyContentType } from "@/services/continuation/history-progress";
import type { HistoryProgress, QueueEntry } from "@kunai/storage";

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

export function titleInfoFromMediaItemIdentity(item: MediaItemIdentity): TitleInfo {
  return {
    id: item.titleId,
    type: item.mediaKind === "movie" ? "movie" : "series",
    name: item.title,
  };
}

export function episodeInfoFromMediaItemIdentity(item: MediaItemIdentity): EpisodeInfo | undefined {
  if (item.mediaKind === "movie") return undefined;
  if (
    item.season === undefined &&
    item.episode === undefined &&
    item.absoluteEpisode === undefined
  ) {
    return undefined;
  }
  return {
    season: item.season ?? 1,
    episode: item.episode ?? item.absoluteEpisode ?? 1,
    absoluteEpisode: item.absoluteEpisode,
  };
}

export function titleInfoFromQueueEntry(
  entry: QueueEntry,
  sourceOrIntent: QueuePlaybackIntent["source"] | QueuePlaybackIntent = "queue",
): TitleInfo {
  const queuePlaybackIntent =
    typeof sourceOrIntent === "string"
      ? queuePlaybackIntentFromEntry(entry, sourceOrIntent)
      : sourceOrIntent;
  return {
    id: entry.titleId,
    type: entry.mediaKind === "movie" ? "movie" : "series",
    name: entry.title,
    queuePlaybackIntent,
  };
}

export function episodeInfoFromQueueEntry(entry: QueueEntry): EpisodeInfo | undefined {
  if (entry.mediaKind === "movie") return undefined;
  if (
    entry.season === undefined &&
    entry.episode === undefined &&
    entry.absoluteEpisode === undefined
  ) {
    return undefined;
  }
  return {
    season: entry.season ?? 1,
    episode: entry.episode ?? entry.absoluteEpisode ?? 1,
    absoluteEpisode: entry.absoluteEpisode,
  };
}
