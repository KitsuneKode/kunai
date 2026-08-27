import type { ProviderSearchResult, YouTubeLiveStatus } from "@kunai/types";

import {
  toYoutubeChannelCatalogId,
  toYoutubePlaylistCatalogId,
  toYoutubeVideoCatalogId,
  youtubeThumbnailUrl,
} from "./ids";
import type {
  InvidiousRecommendedVideo,
  InvidiousSearchItem,
  InvidiousSearchVideo,
} from "./invidious-client";
import { extractPipedVideoId, type PipedSearchItem } from "./piped-client";

function pickInvidiousThumbnail(
  thumbnails: InvidiousSearchVideo["videoThumbnails"] | undefined,
): string | null {
  if (!thumbnails?.length) return null;
  const preferred =
    thumbnails.find((thumb) => thumb.quality === "medium") ??
    thumbnails.find((thumb) => thumb.quality === "high") ??
    thumbnails[thumbnails.length - 1];
  return preferred?.url ?? null;
}

export { pickInvidiousThumbnail };

function publishedYearFromEpochSeconds(epochSeconds?: number): string | undefined {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return undefined;
  return String(new Date(epochSeconds * 1000).getUTCFullYear());
}

function publishedAtFromEpochSeconds(epochSeconds?: number): string | undefined {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return undefined;
  return new Date(epochSeconds * 1000).toISOString();
}

type LiveStatusSource = {
  readonly liveNow?: boolean;
  readonly liveStatus?: string;
  readonly publishedText?: string;
};

function mapLiveStatus(item: LiveStatusSource): YouTubeLiveStatus {
  if (item.liveNow) return "live";
  const status = item.liveStatus?.trim().toLowerCase();
  if (status === "live" || status === "is_live") return "live";
  if (status === "upcoming" || status === "is_upcoming") return "upcoming";
  if (status === "post_live" || status === "was_live") return "post_live";
  const publishedText = item.publishedText?.toLowerCase() ?? "";
  if (
    publishedText.includes("scheduled") ||
    // "premiere" already matches "premieres".
    publishedText.includes("premiere") ||
    publishedText.includes("upcoming")
  ) {
    return "upcoming";
  }
  if (publishedText.includes("streamed") || publishedText.includes("was live")) {
    return "post_live";
  }
  return "none";
}

export function mapInvidiousSearchItem(item: InvidiousSearchItem): ProviderSearchResult | null {
  if (item.type === "video") {
    const poster =
      pickInvidiousThumbnail(item.videoThumbnails) ?? youtubeThumbnailUrl(item.videoId);
    return {
      id: toYoutubeVideoCatalogId(item.videoId),
      type: "movie",
      title: item.title,
      year: publishedYearFromEpochSeconds(item.published),
      overview: item.description ?? "",
      posterPath: poster,
      metadataSource: "Invidious",
      durationSeconds: item.lengthSeconds,
      channelTitle: item.author,
      channelId: item.authorId,
      viewCount: item.viewCount,
      publishedAt: publishedAtFromEpochSeconds(item.published),
      liveStatus: mapLiveStatus(item),
      premium: item.premium,
      paid: item.paid,
      contentShape: item.isShort === true || /\/shorts\//i.test(item.url ?? "") ? "short" : "video",
      externalIds: {
        youtubeId: item.videoId,
        youtubeChannelId: item.authorId,
      },
      artwork: {
        thumbnailUrl: poster,
        posterUrl: poster,
      },
    };
  }

  if (item.type === "playlist") {
    return {
      id: toYoutubePlaylistCatalogId(item.playlistId),
      type: "series",
      title: item.title,
      overview: "",
      posterPath: item.playlistThumbnail ?? null,
      metadataSource: "Invidious",
      episodeCount: item.videoCount,
      channelTitle: item.author,
      channelId: item.authorId,
      contentShape: "playlist",
      externalIds: {
        youtubePlaylistId: item.playlistId,
        youtubeChannelId: item.authorId,
      },
      artwork: {
        posterUrl: item.playlistThumbnail,
        thumbnailUrl: item.playlistThumbnail,
      },
    };
  }

  if (item.type === "channel") {
    const channelPoster = pickInvidiousThumbnail(item.authorThumbnails);
    return {
      id: toYoutubeChannelCatalogId(item.authorId),
      type: "series",
      title: item.author,
      overview: item.description ?? "",
      posterPath: channelPoster,
      metadataSource: "Invidious",
      episodeCount: item.videoCount,
      channelTitle: item.author,
      channelId: item.authorId,
      contentShape: "channel",
      externalIds: {
        youtubeChannelId: item.authorId,
      },
      artwork: channelPoster
        ? {
            posterUrl: channelPoster,
            thumbnailUrl: channelPoster,
          }
        : undefined,
    };
  }

  return null;
}

export function mapPipedSearchItem(item: PipedSearchItem): ProviderSearchResult | null {
  const videoId = extractPipedVideoId(item);
  if (!videoId || !item.title) return null;
  const uploadedMs = item.uploaded && item.uploaded > 0 ? item.uploaded : undefined;
  const channelId = extractPipedChannelId(item.uploaderUrl);
  const poster = item.thumbnail ?? youtubeThumbnailUrl(videoId);
  return {
    id: toYoutubeVideoCatalogId(videoId),
    type: "movie",
    title: item.title,
    year: uploadedMs ? String(new Date(uploadedMs).getUTCFullYear()) : undefined,
    overview: item.shortDescription ?? "",
    posterPath: poster,
    metadataSource: "Piped",
    durationSeconds: item.duration,
    channelTitle: item.uploaderName,
    channelId: channelId ?? undefined,
    viewCount: item.views,
    publishedAt: uploadedMs ? new Date(uploadedMs).toISOString() : undefined,
    liveStatus: mapPipedLiveStatus(item),
    contentShape: item.isShort || /\/shorts\//i.test(item.url ?? "") ? "short" : "video",
    externalIds: {
      youtubeId: videoId,
      ...(channelId ? { youtubeChannelId: channelId } : {}),
    },
    artwork: {
      posterUrl: poster,
      thumbnailUrl: poster,
    },
  };
}

function mapPipedLiveStatus(
  item: Pick<PipedSearchItem, "isLive" | "liveStatus">,
): YouTubeLiveStatus {
  const status = item.liveStatus?.trim().toLowerCase();
  if (item.isLive === true || status === "live" || status === "is_live") return "live";
  if (status === "upcoming" || status === "is_upcoming") return "upcoming";
  if (status === "post_live" || status === "was_live") return "post_live";
  return "none";
}

/** Extract a channel id from Piped `uploaderUrl` paths like `/channel/UCxxx`. */
export function extractPipedChannelId(uploaderUrl: string | undefined): string | null {
  if (!uploaderUrl?.trim()) return null;
  // Only canonical /channel/UC… ids — vanity /c/Name is not an Invidious channel id.
  const match = uploaderUrl.trim().match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

export function mapInvidiousSearchResults(
  items: readonly InvidiousSearchItem[],
): readonly ProviderSearchResult[] {
  return items
    .map((item) => mapInvidiousSearchItem(item))
    .filter((item): item is ProviderSearchResult => item !== null);
}

/** Map a related/recommended video stub from `/api/v1/videos/{id}`. */
export function mapInvidiousRecommendedVideo(
  item: InvidiousRecommendedVideo,
): ProviderSearchResult | null {
  const videoId = item.videoId?.trim();
  const title = item.title?.trim();
  if (!videoId || !title) return null;
  const poster = pickInvidiousThumbnail(item.videoThumbnails) ?? youtubeThumbnailUrl(videoId);
  return {
    id: toYoutubeVideoCatalogId(videoId),
    type: "movie",
    title,
    year: publishedYearFromEpochSeconds(item.published),
    overview: "",
    posterPath: poster,
    metadataSource: "Invidious",
    durationSeconds: item.lengthSeconds,
    channelTitle: item.author,
    channelId: item.authorId,
    viewCount: item.viewCount,
    publishedAt: publishedAtFromEpochSeconds(item.published),
    liveStatus: mapLiveStatus(item),
    contentShape: item.isShort === true || /\/shorts\//i.test(item.url ?? "") ? "short" : "video",
    externalIds: {
      youtubeId: videoId,
      ...(item.authorId ? { youtubeChannelId: item.authorId } : {}),
    },
    artwork: {
      posterUrl: poster,
      thumbnailUrl: poster,
    },
  };
}

export function mapInvidiousRecommendedVideos(
  items: readonly InvidiousRecommendedVideo[] | undefined,
): readonly ProviderSearchResult[] {
  return (items ?? [])
    .map((item) => mapInvidiousRecommendedVideo(item))
    .filter((item): item is ProviderSearchResult => item !== null);
}

/** Trending endpoint returns video objects (same shape as search videos). */
export function mapInvidiousTrendingVideos(
  items: readonly InvidiousSearchVideo[],
): readonly ProviderSearchResult[] {
  return items
    .map((item) => mapInvidiousSearchItem({ ...item, type: "video" }))
    .filter((item): item is ProviderSearchResult => item !== null);
}

export function mapPipedSearchResults(
  items: readonly PipedSearchItem[] | undefined,
): readonly ProviderSearchResult[] {
  return (items ?? [])
    .map((item) => mapPipedSearchItem(item))
    .filter((item): item is ProviderSearchResult => item !== null);
}
