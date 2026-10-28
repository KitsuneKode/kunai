import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { ContentType, VideoMeta } from "@/domain/types";
import {
  getCachedYoutubeVideoMetadata,
  mapYtDlpLiveStatus,
  parseYoutubeCatalogId,
} from "@kunai/providers/youtube";

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
