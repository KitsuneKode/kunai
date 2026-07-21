/**
 * YouTube-native recommendation builder for post-play and discover rails.
 * Sources: Invidious related videos, same-channel uploads, history channel affinity.
 * Does not resolve streams — metadata SearchResult rows only.
 */

import type { SearchResult, TitleInfo } from "@/domain/types";
import {
  getYoutubeProviderConfig,
  invidiousGetChannelVideos,
  invidiousGetTrending,
  invidiousGetVideo,
  mapInvidiousRecommendedVideos,
  mapInvidiousSearchItem,
  mapInvidiousTrendingVideos,
  parseYoutubeCatalogId,
  toYoutubeVideoCatalogId,
} from "@kunai/providers/youtube";
import type { HistoryProgress } from "@kunai/storage";
import type { ProviderSearchResult } from "@kunai/types";

const MAX_ITEMS = 8;
const MAX_CHANNEL_UPLOADS = 4;
const MAX_HISTORY_CHANNELS = 3;

export type YoutubeRecommendationHistorySeed = {
  readonly titleId: string;
  readonly externalIds?: HistoryProgress["externalIds"];
  readonly mediaKind?: HistoryProgress["mediaKind"];
  readonly providerId?: HistoryProgress["providerId"];
  readonly completed?: boolean;
};

function providerResultToSearchResult(result: ProviderSearchResult): SearchResult {
  return {
    id: result.id,
    type: result.type,
    title: result.title,
    year: result.year ?? "",
    overview: result.overview ?? "",
    posterPath: result.posterPath ?? null,
    metadataSource: result.metadataSource,
    episodeCount: result.episodeCount,
    externalIds: result.externalIds,
    release: result.release,
    artwork: result.artwork,
    durationSeconds: result.durationSeconds,
    channelTitle: result.channelTitle,
    channelId: result.channelId,
    viewCount: result.viewCount,
    publishedAt: result.publishedAt,
    liveStatus: result.liveStatus,
    premium: result.premium,
    paid: result.paid,
    contentShape: result.contentShape,
  };
}

function resolveVideoId(title: TitleInfo): string | null {
  const fromExternal = title.externalIds?.youtubeId?.trim();
  if (fromExternal) return fromExternal;
  const parsed = parseYoutubeCatalogId(title.id);
  return parsed.kind === "video" ? parsed.nativeId : null;
}

function resolveChannelId(title: TitleInfo, videoAuthorId?: string): string | null {
  const fromTitle = title.externalIds?.youtubeChannelId?.trim();
  if (fromTitle) return fromTitle;
  if (videoAuthorId?.trim()) return videoAuthorId.trim();
  // Never fall back to an unrelated history channel — that pollutes "same channel"
  // and incorrectly excludes that channel from affinity.
  return null;
}

function channelIdsFromHistory(
  seeds: readonly YoutubeRecommendationHistorySeed[],
  excludeChannelId: string | null,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seed of seeds) {
    const isYoutube =
      seed.mediaKind === "video" ||
      seed.providerId === "youtube" ||
      Boolean(seed.externalIds?.youtubeId);
    if (!isYoutube) continue;
    const channelId = seed.externalIds?.youtubeChannelId?.trim();
    if (!channelId || channelId === excludeChannelId || seen.has(channelId)) continue;
    seen.add(channelId);
    out.push(channelId);
    if (out.length >= MAX_HISTORY_CHANNELS) break;
  }
  return out;
}

async function loadChannelUploadResults(
  channelId: string,
  preferredInstanceUrl: string | undefined,
  signal: AbortSignal | undefined,
  excludeVideoId: string | null,
): Promise<readonly ProviderSearchResult[]> {
  const channel = await invidiousGetChannelVideos(channelId, {
    preferredInstanceUrl,
    signal,
  }).catch(() => null);
  if (!channel) return [];
  const videos = channel.latestVideos ?? channel.videos ?? [];
  const out: ProviderSearchResult[] = [];
  for (const video of videos) {
    const videoId = video.videoId?.trim();
    if (!videoId || videoId === excludeVideoId) continue;
    const mapped = mapInvidiousSearchItem({
      type: "video",
      title: video.title ?? `Video ${videoId}`,
      videoId,
      author: channel.author ?? "",
      authorId: channel.authorId ?? channelId,
      lengthSeconds: video.lengthSeconds,
    });
    if (mapped) out.push(mapped);
    if (out.length >= MAX_CHANNEL_UPLOADS) break;
  }
  return out;
}

function mergeUnique(
  batches: readonly (readonly ProviderSearchResult[])[],
  excludeVideoId: string | null,
): SearchResult[] {
  const seen = new Set<string>();
  if (excludeVideoId) seen.add(toYoutubeVideoCatalogId(excludeVideoId));
  const out: SearchResult[] = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(providerResultToSearchResult(item));
      if (out.length >= MAX_ITEMS) return out;
    }
  }
  return out;
}

/**
 * Build YouTube post-play recommendations for the current title.
 * Order: related → same channel → other watched channels → trending fallback.
 */
export async function loadYoutubeRecommendations(input: {
  readonly title: TitleInfo;
  readonly historySeeds?: readonly YoutubeRecommendationHistorySeed[];
  readonly signal?: AbortSignal;
}): Promise<readonly SearchResult[]> {
  const preferredInstanceUrl = getYoutubeProviderConfig().invidiousInstanceUrl;
  const videoId = resolveVideoId(input.title);
  const excludeVideoId = videoId;

  let related: readonly ProviderSearchResult[] = [];
  let authorId: string | undefined;

  if (videoId) {
    const details = await invidiousGetVideo(videoId, {
      preferredInstanceUrl,
      signal: input.signal,
    }).catch(() => null);
    if (details) {
      authorId = details.authorId;
      related = mapInvidiousRecommendedVideos(details.recommendedVideos);
    }
  }

  // Prefer related first so a full related set does not pay channel fan-out under
  // the post-play auto-continue budget.
  let merged = mergeUnique([related], excludeVideoId);
  if (merged.length >= MAX_ITEMS) return merged;
  if (input.signal?.aborted) return merged;

  const channelId = resolveChannelId(input.title, authorId);
  const sameChannel =
    channelId && merged.length < MAX_ITEMS
      ? await loadChannelUploadResults(
          channelId,
          preferredInstanceUrl,
          input.signal,
          excludeVideoId,
        )
      : [];
  merged = mergeUnique([related, sameChannel], excludeVideoId);
  if (merged.length >= MAX_ITEMS) return merged;
  if (input.signal?.aborted) return merged;

  const historyChannelIds = channelIdsFromHistory(input.historySeeds ?? [], channelId);
  const historyChannelBatches =
    historyChannelIds.length > 0 && merged.length < MAX_ITEMS
      ? (
          await Promise.all(
            historyChannelIds.map((historyChannelId) =>
              loadChannelUploadResults(
                historyChannelId,
                preferredInstanceUrl,
                input.signal,
                excludeVideoId,
              ),
            ),
          )
        ).filter((batch) => batch.length > 0)
      : [];

  merged = mergeUnique([related, sameChannel, ...historyChannelBatches], excludeVideoId);
  if (merged.length > 0) return merged;

  const trending = await invidiousGetTrending({
    preferredInstanceUrl,
    signal: input.signal,
  })
    .then((items) => mapInvidiousTrendingVideos([...items]))
    .catch(() => [] as readonly ProviderSearchResult[]);
  return mergeUnique([trending], excludeVideoId);
}

/** YouTube trending for `/trending` in youtube shell mode. */
export async function loadYoutubeTrending(signal?: AbortSignal): Promise<readonly SearchResult[]> {
  const preferredInstanceUrl = getYoutubeProviderConfig().invidiousInstanceUrl;
  const items = await invidiousGetTrending({ preferredInstanceUrl, signal }).catch(() => []);
  return mapInvidiousTrendingVideos([...items]).map(providerResultToSearchResult);
}

export function isYoutubeCatalogId(id: string): boolean {
  const kind = parseYoutubeCatalogId(id).kind;
  return kind === "video" || kind === "playlist" || kind === "channel";
}
