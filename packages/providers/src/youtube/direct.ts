import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSearchInput,
  ProviderSearchResult,
  ProviderTraceEvent,
  StreamCandidate,
  SubtitleCandidate,
  ProviderVariantCandidate,
  YouTubeLiveStatus,
} from "@kunai/types";

import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { formatDurationSeconds } from "./format-duration";
import { buildYoutubeWatchUrl, parseYoutubeCatalogId, toYoutubeVideoCatalogId } from "./ids";
import {
  invidiousGetChannelVideos,
  invidiousGetPlaylist,
  invidiousSearch,
} from "./invidious-client";
import { YOUTUBE_PROVIDER_ID, youtubeManifest } from "./manifest";
import { mapInvidiousSearchResults, mapPipedSearchResults } from "./map-search-result";
import { pipedSearch } from "./piped-client";
import { spawnYtDlpWithTimeout } from "./spawn-ytdlp";
import type {
  YoutubeMetadataCachePort,
  YoutubeMetadataService,
  YoutubeVideoMetadata,
} from "./youtube-metadata";
import { createYoutubeMetadataService } from "./youtube-metadata-service";
import { buildYtdlFormatSelector, defaultYtdlPlaybackFormat } from "./yt-dlp-metadata";

export { YOUTUBE_PROVIDER_ID, youtubeManifest };

type YoutubeProviderConfig = {
  readonly invidiousInstanceUrl?: string;
  readonly pipedApiUrl?: string;
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly sponsorblockRemove?: string;
  readonly metadataService?: YoutubeMetadataService;
  /** @deprecated Prefer metadataService; kept for tests and lazy service bootstrap. */
  readonly metadataCache?: YoutubeMetadataCachePort;
};

function resolveMetadataService(config: YoutubeProviderConfig): YoutubeMetadataService | undefined {
  if (config.metadataService) return config.metadataService;
  if (!config.metadataCache) return undefined;
  return createYoutubeMetadataService({
    cache: config.metadataCache,
    extractOptions: {
      cookiesFromBrowser: config.cookiesFromBrowser,
      cookiesFile: config.cookiesFile,
      extractorArgs: config.extractorArgs,
    },
  });
}

export function getCachedYoutubeVideoMetadata(videoId: string): YoutubeVideoMetadata | null {
  return globalYoutubeConfig.metadataService?.get(videoId) ?? null;
}

export function getYoutubeProviderConfig(): Readonly<YoutubeProviderConfig> {
  return globalYoutubeConfig;
}

let globalYoutubeConfig: YoutubeProviderConfig & { metadataService?: YoutubeMetadataService } = {};

export function configureYoutubeProvider(config: YoutubeProviderConfig): void {
  const metadataService = resolveMetadataService(config);
  globalYoutubeConfig = { ...config, metadataService };
}

async function searchYoutube(
  input: ProviderSearchInput,
  context: ProviderRuntimeContext,
): Promise<readonly ProviderSearchResult[] | null> {
  const query = input.query.trim();
  if (!query) return [];

  try {
    const items = await invidiousSearch(query, {
      preferredInstanceUrl: globalYoutubeConfig.invidiousInstanceUrl,
      signal: context.signal,
    });
    return mapInvidiousSearchResults(items);
  } catch (invidiousError) {
    if (globalYoutubeConfig.pipedApiUrl?.trim()) {
      try {
        const piped = await pipedSearch(query, {
          apiBaseUrl: globalYoutubeConfig.pipedApiUrl,
          signal: context.signal,
        });
        const mapped = mapPipedSearchResults(piped.items);
        if (mapped.length > 0) return mapped;
      } catch {
        // fall through
      }
    }

    if (context.signal?.aborted) return null;

    const ytsearchResults = await searchYoutubeViaYtsearch(query, context);
    if (ytsearchResults) return ytsearchResults;

    throw invidiousError;
  }
}

const YTSEARCH_RESULT_LIMIT = 12;

async function searchYoutubeViaYtsearch(
  query: string,
  context: ProviderRuntimeContext,
): Promise<readonly ProviderSearchResult[] | null> {
  if (!Bun.which("yt-dlp")) return null;

  const args = [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    `ytsearch${YTSEARCH_RESULT_LIMIT}:${query}`,
  ];
  try {
    const proc = await spawnYtDlpWithTimeout({ args, signal: context.signal, timeoutMs: 30_000 });
    if (proc.exitCode !== 0 || !proc.stdout.trim()) return null;

    const lines = proc.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const results: ProviderSearchResult[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          id?: string;
          title?: string;
          duration?: number;
          uploader?: string;
          channel_id?: string;
          view_count?: number;
          thumbnail?: string;
          is_live?: boolean;
          live_status?: string;
        };
        if (!entry.id || !entry.title) continue;
        results.push({
          id: toYoutubeVideoCatalogId(entry.id),
          type: "movie",
          title: entry.title,
          overview: "",
          posterPath: entry.thumbnail ?? null,
          metadataSource: "yt-dlp",
          durationSeconds: entry.duration,
          channelTitle: entry.uploader,
          channelId: entry.channel_id,
          viewCount: entry.view_count,
          liveStatus: mapYtDlpLiveStatus(entry.is_live, entry.live_status),
          contentShape: "video",
          externalIds: { youtubeId: entry.id, youtubeChannelId: entry.channel_id },
          artwork: {
            thumbnailUrl: entry.thumbnail,
            posterUrl: entry.thumbnail,
          },
        });
      } catch {
        // skip malformed line
      }
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function mapYtDlpLiveStatus(isLive?: boolean, liveStatus?: string): YouTubeLiveStatus {
  const normalized = liveStatus?.trim().toLowerCase();
  if (normalized === "is_upcoming") return "upcoming";
  if (normalized === "was_live" || normalized === "post_live") return "post_live";
  if (isLive || normalized === "is_live") return "live";
  return "none";
}

async function listYoutubeEpisodes(
  input: Parameters<NonNullable<CoreProviderModule["listEpisodes"]>>[0],
  context: ProviderRuntimeContext,
): Promise<readonly ProviderEpisodeOption[] | null> {
  const parsed = parseYoutubeCatalogId(input.title.id);
  if (parsed.kind === "playlist") {
    const playlist = await invidiousGetPlaylist(parsed.nativeId, {
      preferredInstanceUrl: globalYoutubeConfig.invidiousInstanceUrl,
      signal: context.signal,
    });
    return (playlist.videos ?? []).map((video, index) => ({
      index: video.index ?? index + 1,
      label: `#${video.index ?? index + 1}${video.lengthSeconds ? ` · ${formatDurationSeconds(video.lengthSeconds)}` : ""}`,
      name: video.title,
      detail: video.title,
      totalEpisodeCount: playlist.videoCount ?? playlist.videos?.length,
      externalIds: video.videoId ? { youtubeId: video.videoId } : undefined,
    }));
  }

  if (parsed.kind === "channel") {
    const channel = await invidiousGetChannelVideos(parsed.nativeId, {
      preferredInstanceUrl: globalYoutubeConfig.invidiousInstanceUrl,
      signal: context.signal,
    });
    const channelVideos = channel.latestVideos ?? channel.videos ?? [];
    return channelVideos.map((video, index) => ({
      index: index + 1,
      label: `#${index + 1}${video.lengthSeconds ? ` · ${formatDurationSeconds(video.lengthSeconds)}` : ""}`,
      name: video.title,
      detail: video.title,
      externalIds: video.videoId ? { youtubeId: video.videoId } : undefined,
    }));
  }

  return null;
}

async function loadYtDlpVideoInfo(
  videoId: string,
  watchUrl: string,
  context: ProviderRuntimeContext,
): Promise<YoutubeVideoMetadata | null> {
  const service = globalYoutubeConfig.metadataService;
  if (!service) return null;

  if (!Bun.which("yt-dlp")) return null;

  return service.getOrFetch(videoId, watchUrl, { signal: context.signal });
}

async function resolveYoutube(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  if (input.mediaKind !== "video" && input.mediaKind !== "movie") {
    return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
      code: "unsupported-title",
      message: "YouTube provider only supports video playback",
      retryable: false,
    });
  }

  const parsed = parseYoutubeCatalogId(input.title.id);
  let videoId = parsed.kind === "video" ? parsed.nativeId : input.title.externalIds?.youtubeId;
  if (!videoId && input.episode?.episode !== undefined) {
    const episodeIndex = input.episode.episode;
    const episodes = await listYoutubeEpisodes(
      {
        title: input.title,
      },
      context,
    );
    const selected = episodes?.find((entry) => entry.index === episodeIndex);
    videoId = selected?.externalIds?.youtubeId;
  }

  if (!videoId) {
    return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
      code: "missing-input",
      message: "YouTube video id is missing",
      retryable: false,
    });
  }

  if (!Bun.which("yt-dlp")) {
    return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
      code: "yt-dlp-missing",
      message: "yt-dlp is required for YouTube playback. Install yt-dlp and retry.",
      retryable: false,
    });
  }

  const startedAt = context.now();
  const events: ProviderTraceEvent[] = [];
  const failures: ProviderFailure[] = [];
  const watchUrl = buildYoutubeWatchUrl(videoId);
  const cachePolicy = createProviderCachePolicy({
    providerId: YOUTUBE_PROVIDER_ID,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
  });

  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId: YOUTUBE_PROVIDER_ID,
    message: "Resolving YouTube watch URL",
  });

  try {
    let ytInfo: YoutubeVideoMetadata | null = null;
    try {
      ytInfo = await loadYtDlpVideoInfo(videoId, watchUrl, context);
    } catch (error) {
      failures.push({
        providerId: YOUTUBE_PROVIDER_ID,
        code: "parse-failed",
        message: error instanceof Error ? error.message : "yt-dlp metadata failed",
        retryable: true,
        at: context.now(),
      });
    }

    const liveStatus = mapYtDlpLiveStatus(ytInfo?.isLive, ytInfo?.liveStatus);
    if (liveStatus === "upcoming") {
      return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
        code: "unsupported-title",
        message: "This YouTube premiere has not started yet",
        retryable: false,
      });
    }

    const isLive = liveStatus === "live" || ytInfo?.isLive === true;

    const mappedFormats = ytInfo?.qualities ?? [];
    const qualityLabels =
      mappedFormats.length > 0 ? mappedFormats : [{ label: "best", rank: 0, formatId: "best" }];
    const selectedQuality =
      input.qualityPreference && input.qualityPreference !== "best"
        ? (qualityLabels.find((entry) => entry.label === input.qualityPreference) ??
          qualityLabels[0])
        : qualityLabels[0];

    const sourceId = `source:${YOUTUBE_PROVIDER_ID}:youtube`;

    const streams: StreamCandidate[] = qualityLabels.map((entry) => {
      const streamId = `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:${entry.label}`;
      const ytdlFormat = isLive
        ? defaultYtdlPlaybackFormat()
        : buildYtdlFormatSelector(entry.label);
      return {
        id: streamId,
        providerId: YOUTUBE_PROVIDER_ID,
        sourceId,
        variantId: `variant:${YOUTUBE_PROVIDER_ID}:${entry.label}`,
        url: watchUrl,
        protocol: "youtube",
        container: "unknown",
        qualityLabel: entry.label,
        qualityRank: entry.rank,
        requiresYtdl: true,
        headers: {},
        confidence: ytInfo ? 0.95 : 0.85,
        cachePolicy,
        metadata: {
          ytdlFormat,
          videoId,
          durationSeconds: ytInfo?.durationSeconds,
          isLive,
          liveStatus,
        },
      };
    });

    const selectedStreamId = `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:${selectedQuality?.label ?? "best"}`;

    const variants: ProviderVariantCandidate[] = qualityLabels.map((entry) => ({
      id: `variant:${YOUTUBE_PROVIDER_ID}:${entry.label}`,
      providerId: YOUTUBE_PROVIDER_ID,
      sourceId,
      qualityLabel: entry.label,
      qualityRank: entry.rank,
      protocol: "youtube",
      streamIds: [`stream:${YOUTUBE_PROVIDER_ID}:${videoId}:${entry.label}`],
      confidence: 0.9,
    }));

    const subtitles: SubtitleCandidate[] = mapYoutubeMetadataSubtitles(ytInfo, cachePolicy);

    const endedAt = context.now();
    emitTraceEvent(events, context, {
      type: "provider:success",
      providerId: YOUTUBE_PROVIDER_ID,
      message: "Resolved YouTube watch URL for mpv ytdl playback",
    });

    return {
      status: "resolved",
      providerId: YOUTUBE_PROVIDER_ID,
      selectedStreamId,
      sources: [
        {
          id: sourceId,
          providerId: YOUTUBE_PROVIDER_ID,
          kind: "provider-api",
          label: "YouTube",
          host: "youtube.com",
          status: "selected",
          confidence: 0.95,
          requiresRuntime: "direct-http",
          cachePolicy,
        },
      ],
      streams,
      variants: variants.length > 0 ? variants : undefined,
      subtitles,
      cachePolicy,
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: YOUTUBE_PROVIDER_ID,
        streamId: selectedStreamId,
        cacheHit: false,
        runtime: "direct-http",
        startedAt,
        endedAt,
        steps: [
          createTraceStep("provider", "Resolved YouTube watch URL", {
            providerId: YOUTUBE_PROVIDER_ID,
            attributes: {
              videoId,
              qualityCount: streams.length,
              selectedQuality: selectedQuality?.label ?? "best",
            },
          }),
        ],
        events,
        failures,
      }),
      failures,
      healthDelta: {
        providerId: YOUTUBE_PROVIDER_ID,
        outcome: "success",
        at: endedAt,
      },
    };
  } catch (error) {
    if (context.signal?.aborted) {
      return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
        code: "cancelled",
        message: "YouTube resolution cancelled",
        retryable: false,
      });
    }
    return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, {
      code: "network-error",
      message: error instanceof Error ? error.message : "YouTube resolve failed",
      retryable: true,
    });
  }
}

function mapYoutubeMetadataSubtitles(
  info: YoutubeVideoMetadata | null,
  cachePolicy: StreamCandidate["cachePolicy"],
): SubtitleCandidate[] {
  if (!info) return [];
  const subtitles: SubtitleCandidate[] = [];
  for (const track of info.subtitles) {
    if (!track.url) continue;
    subtitles.push({
      id: `subtitle:${YOUTUBE_PROVIDER_ID}:${track.language}:${track.ext ?? "vtt"}`,
      providerId: YOUTUBE_PROVIDER_ID,
      url: track.url,
      language: track.language,
      label: track.language,
      format: track.ext === "vtt" ? "vtt" : track.ext === "srt" ? "srt" : "unknown",
      source: track.source === "manual" ? "provider" : "embedded",
      confidence: 0.8,
      cachePolicy,
    });
  }
  return subtitles;
}

export const youtubeProviderModule: CoreProviderModule = {
  providerId: YOUTUBE_PROVIDER_ID,
  manifest: youtubeManifest,
  search: searchYoutube,
  listEpisodes: listYoutubeEpisodes,
  resolve: resolveYoutube,
};
