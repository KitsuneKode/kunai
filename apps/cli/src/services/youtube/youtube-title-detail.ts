import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { ContentType, TitleInfo, VideoMeta } from "@/domain/types";
import {
  getCachedYoutubeVideoMetadata,
  mapYtDlpLiveStatus,
  parseYoutubeCatalogId,
} from "@kunai/providers/youtube";

/**
 * Optional metadata for a stream already resolved by YouTube. Only that
 * successful handoff may use a YouTube hint on a mixed catalog identity.
 * A cache failure cannot block playback; an aborted handoff must still stop.
 */
export function readResolvedYoutubeTitleDetail(
  title: Pick<TitleInfo, "id" | "type" | "externalIds">,
  signal?: AbortSignal,
): TitleDetail | undefined {
  signal?.throwIfAborted();
  let detail: TitleDetail | undefined;
  try {
    detail = peekYoutubeTitleDetail(title.id, title.type, title.externalIds?.youtubeId);
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
  signal?.throwIfAborted();
  return detail;
}

/** Read only metadata already fetched by the provider; never resolve another video. */
export function peekYoutubeTitleDetail(
  id: string,
  type: ContentType,
  videoIdHint?: string,
): TitleDetail | undefined {
  const parsed = parseYoutubeCatalogId(id);
  const videoId = parsed.kind === "video" ? parsed.nativeId : videoIdHint;
  if (!videoId) return undefined;
  const metadata = getCachedYoutubeVideoMetadata(videoId);
  if (!metadata || metadata.videoId !== videoId) return undefined;
  const videoMeta: VideoMeta = {
    channelTitle: metadata.uploader || undefined,
    channelId: metadata.channelId || undefined,
    publishedAt: metadata.publishedAt || undefined,
    durationSeconds: metadata.durationSeconds,
    viewCount: metadata.viewCount,
    liveStatus:
      metadata.isLive !== undefined || metadata.liveStatus !== undefined
        ? mapYtDlpLiveStatus(metadata.isLive, metadata.liveStatus)
        : undefined,
  };
  // Missing provider fields must not erase richer search facts during adoption.
  for (const [key, value] of Object.entries(videoMeta)) {
    if (value === undefined) Reflect.deleteProperty(videoMeta, key);
  }
  return {
    id,
    type,
    title: metadata.title?.trim() ?? "",
    artwork: metadata.thumbnail
      ? { poster: metadata.thumbnail, contributingSources: ["provider"] }
      : undefined,
    externalIds: { youtubeId: videoId, youtubeChannelId: metadata.channelId },
    sources: ["provider"],
    videoMeta,
  };
}
