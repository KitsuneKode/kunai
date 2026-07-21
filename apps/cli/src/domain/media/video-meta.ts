// =============================================================================
// video-meta.ts — derive a VideoMeta snapshot from a SearchResult
//
// YouTube/video fields (channel, views, published, duration, …) live on
// SearchResult but NOT on TitleInfo, and video titles never populate a
// TitleDetail. This single pure helper captures that snapshot so the session
// (and the `video` media-panel kind) has a real data source. Keeping it in
// domain/ lets both the reducer and the bootstrap launch path share one
// implementation instead of duplicating the field-by-field copy.
// =============================================================================

import type { SearchResult, VideoMeta } from "@/domain/types";
import type { ProviderExternalIds } from "@kunai/types";

/**
 * Extract a {@link VideoMeta} snapshot from a search result when it carries any
 * video-shaped metadata, else `null`.
 */
export function videoMetaFromSearchResult(result: SearchResult): VideoMeta | null {
  const hasVideoFields =
    result.channelTitle !== undefined ||
    result.channelId !== undefined ||
    result.viewCount !== undefined ||
    result.publishedAt !== undefined ||
    result.durationSeconds !== undefined ||
    result.contentShape !== undefined ||
    result.liveStatus !== undefined ||
    result.premium !== undefined ||
    result.paid !== undefined;
  if (!hasVideoFields) return null;
  return {
    channelTitle: result.channelTitle,
    channelId: result.channelId,
    viewCount: result.viewCount,
    publishedAt: result.publishedAt,
    durationSeconds: result.durationSeconds,
    contentShape: result.contentShape,
    liveStatus: result.liveStatus,
    premium: result.premium,
    paid: result.paid,
  };
}

/**
 * Fold session VideoMeta channel id into history externalIds so affinity seeds
 * survive after watch (TitleInfo alone often lacks youtubeChannelId).
 */
export function enrichExternalIdsWithVideoMeta(
  externalIds: ProviderExternalIds | undefined,
  videoMeta: VideoMeta | null | undefined,
): ProviderExternalIds | undefined {
  const channelId = videoMeta?.channelId?.trim();
  if (!channelId) return externalIds;
  if (externalIds?.youtubeChannelId === channelId) return externalIds;
  return {
    ...externalIds,
    youtubeChannelId: externalIds?.youtubeChannelId ?? channelId,
  };
}
