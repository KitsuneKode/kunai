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
  YouTubeContentShape,
} from "@kunai/types";

import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { formatDurationSeconds } from "./format-duration";
import {
  buildYoutubeWatchUrl,
  parseYoutubeCatalogId,
  toYoutubeVideoCatalogId,
  youtubeThumbnailUrl,
} from "./ids";
import {
  invidiousGetChannelVideos,
  invidiousGetPlaylist,
  invidiousSearch,
} from "./invidious-client";
import { YOUTUBE_PROVIDER_ID, youtubeManifest } from "./manifest";
import { mapInvidiousSearchResults, mapPipedSearchResults } from "./map-search-result";
import { classifyYoutubeMetadataFailure } from "./metadata-failure";
import { parseUploadDate } from "./metadata-normalize";
import { pipedSearch } from "./piped-client";
import { selectYoutubeQuality, youtubeQualityHeight } from "./quality-selection";
import { spawnYtDlpWithTimeout } from "./spawn-ytdlp";
import { boundYoutubeSubtitleTracks } from "./subtitle-language";
import type {
  YoutubeMetadataCachePort,
  YoutubeMetadataService,
  YoutubeVideoMetadata,
} from "./youtube-metadata";
import { createYoutubeMetadataService } from "./youtube-metadata-service";
import { buildYtdlFormatSelector, defaultYtdlPlaybackFormat } from "./yt-dlp-metadata";
import { parseYoutubePlayerClients, withYoutubePlayerClient } from "./ytdl-options";

export { YOUTUBE_PROVIDER_ID, youtubeManifest };

type YoutubeProviderConfig = {
  readonly invidiousInstanceUrl?: string;
  readonly pipedApiUrl?: string;
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly poToken?: string;
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
      poToken: config.poToken,
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

  // Invidious does not consistently identify Shorts. Prefer a provider path
  // that carries an explicit shape signal when the caller asks for them, and
  // never return regular videos under a `type:short` filter.
  if (input.preferredContentShape === "short") {
    // yt-dlp reads YouTube's own Shorts filter, so when it answers at all its
    // answer is authoritative -- including an empty one. Falling through to a
    // backend that cannot filter by shape would either invent non-Shorts results
    // or, when that backend is down, report "search failed" for a query that
    // simply has no Shorts.
    const ytsearch = await searchYoutubeViaYtsearch(query, context, "short");
    if (ytsearch) return ytsearch;
    if (globalYoutubeConfig.pipedApiUrl?.trim()) {
      try {
        const piped = await pipedSearch(query, {
          apiBaseUrl: globalYoutubeConfig.pipedApiUrl,
          signal: context.signal,
        });
        const mapped = mapPipedSearchResults(piped.items).filter(
          (result) => result.contentShape === "short",
        );
        if (mapped.length > 0) return mapped;
      } catch {
        // fall through to Invidious for forks that expose Shorts there
      }
    }
  }

  try {
    const items = await invidiousSearch(query, {
      preferredInstanceUrl: globalYoutubeConfig.invidiousInstanceUrl,
      signal: context.signal,
    });
    return filterYoutubeContentShape(mapInvidiousSearchResults(items), input.preferredContentShape);
  } catch (invidiousError) {
    if (globalYoutubeConfig.pipedApiUrl?.trim()) {
      try {
        const piped = await pipedSearch(query, {
          apiBaseUrl: globalYoutubeConfig.pipedApiUrl,
          signal: context.signal,
        });
        const mapped = filterYoutubeContentShape(
          mapPipedSearchResults(piped.items),
          input.preferredContentShape,
        );
        if (mapped.length > 0) return mapped;
      } catch {
        // fall through
      }
    }

    if (context.signal?.aborted) return null;

    const ytsearchResults = await searchYoutubeViaYtsearch(
      query,
      context,
      input.preferredContentShape,
    );
    // Last-resort lane: an empty answer here should surface the original backend
    // error rather than a bare "no results", so only a non-empty list short-circuits.
    if (ytsearchResults?.length) return ytsearchResults;

    throw invidiousError;
  }
}

function filterYoutubeContentShape(
  results: readonly ProviderSearchResult[],
  shape: YouTubeContentShape | undefined,
): readonly ProviderSearchResult[] {
  return shape ? results.filter((result) => result.contentShape === shape) : results;
}

const YTSEARCH_RESULT_LIMIT = 12;

/**
 * YouTube's own "Shorts" search filter.
 *
 * `ytsearch:` runs the ordinary search, which excludes Shorts entirely -- a probe
 * of `ytsearch12:cooking` returned 12 entries and not one carried a Shorts signal,
 * so a `type:short` query could only ever filter its way down to nothing and then
 * fall through to a provider that was never asked for Shorts either. The results
 * page with `sp=EgIYAQ%3D%3D` is the filter YouTube itself uses, and yt-dlp reads
 * it as an ordinary playlist.
 */
const YOUTUBE_SHORTS_SEARCH_FILTER = "EgIYAQ%3D%3D";

function youtubeSearchTarget(
  query: string,
  requestedShape: YouTubeContentShape | undefined,
): string {
  if (requestedShape !== "short") return `ytsearch${YTSEARCH_RESULT_LIMIT}:${query}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${YOUTUBE_SHORTS_SEARCH_FILTER}`;
}

async function searchYoutubeViaYtsearch(
  query: string,
  context: ProviderRuntimeContext,
  requestedShape?: YouTubeContentShape,
): Promise<readonly ProviderSearchResult[] | null> {
  if (!Bun.which("yt-dlp")) return null;

  const args = [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--playlist-end",
    String(YTSEARCH_RESULT_LIMIT),
    youtubeSearchTarget(query, requestedShape),
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
          upload_date?: string;
          timestamp?: number;
          release_timestamp?: number;
          thumbnail?: string;
          // `--flat-playlist` emits `url`; the full-extraction fields are absent.
          // Reading only those meant a `/shorts/` result was still labelled a video.
          url?: string;
          webpage_url?: string;
          original_url?: string;
          is_short?: boolean;
          is_live?: boolean;
          live_status?: string;
        };
        if (!entry.id || !entry.title) continue;
        // `--flat-playlist` returns `thumbnail: null` on every entry (the images live
        // in a `thumbnails[]` array it does not flatten), so without this fallback the
        // whole yt-dlp search lane renders with empty posters.
        const poster = entry.thumbnail ?? youtubeThumbnailUrl(entry.id);
        results.push({
          id: toYoutubeVideoCatalogId(entry.id),
          type: "movie",
          title: entry.title,
          overview: "",
          posterPath: poster,
          metadataSource: "yt-dlp",
          durationSeconds: entry.duration,
          channelTitle: entry.uploader,
          channelId: entry.channel_id,
          viewCount: entry.view_count,
          publishedAt: parseUploadDate(entry),
          liveStatus: mapYtDlpLiveStatus(entry.is_live, entry.live_status),
          contentShape:
            entry.is_short === true ||
            [entry.url, entry.webpage_url, entry.original_url].some((url) =>
              /\/shorts\//i.test(url ?? ""),
            )
              ? "short"
              : "video",
          externalIds: { youtubeId: entry.id, youtubeChannelId: entry.channel_id },
          artwork: {
            thumbnailUrl: poster,
            posterUrl: poster,
          },
        });
      } catch {
        // skip malformed line
      }
    }
    // An empty array means "this search ran and found nothing"; `null` is reserved
    // for "the search could not run". The Shorts caller relies on that distinction
    // so a genuine no-Shorts answer is not mistaken for a dead lane.
    return filterYoutubeContentShape(results, requestedShape);
  } catch {
    return null;
  }
}

function mapYtDlpLiveStatus(isLive?: boolean, liveStatus?: string): YouTubeLiveStatus {
  const normalized = liveStatus?.trim().toLowerCase();
  if (normalized === "is_upcoming" || normalized === "upcoming") return "upcoming";
  if (normalized === "was_live" || normalized === "post_live") return "post_live";
  if (isLive || normalized === "is_live" || normalized === "live") return "live";
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
    let metadataUnavailable = false;
    try {
      ytInfo = await loadYtDlpVideoInfo(videoId, watchUrl, context);
      // A null result (no metadata service configured, or nothing cached and no
      // fetch) is not a failure, but the quality ladder, duration and subtitles
      // are still unverified — mark it so the streams do not claim otherwise.
      if (!ytInfo) metadataUnavailable = true;
    } catch (error) {
      const classified = classifyYoutubeMetadataFailure(error);
      const failure: ProviderFailure = {
        providerId: YOUTUBE_PROVIDER_ID,
        code: classified.code,
        message: classified.message,
        retryable: !classified.terminal,
        at: context.now(),
      };
      failures.push(failure);
      emitTraceEvent(events, context, {
        type: "source:failed",
        providerId: YOUTUBE_PROVIDER_ID,
        sourceId: `source:${YOUTUBE_PROVIDER_ID}:metadata`,
        message: classified.message,
        attributes: { code: classified.code, terminal: classified.terminal },
      });
      // YouTube said no. Returning a "resolved" watch URL here is what sent
      // private, deleted, members-only and geo-blocked videos into mpv to die
      // with no diagnosis; fail closed so the reason reaches the shell.
      if (classified.terminal) {
        return createExhaustedResult(input, context, YOUTUBE_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }
      metadataUnavailable = true;
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
    // Without metadata the ladder is unknown, but the ceiling is still known.
    // Falling back to a bare "best" here dropped the user's cap entirely and
    // asked yt-dlp for the highest rendition available.
    const fallbackLabel =
      input.qualityPreference && input.qualityPreference !== "best"
        ? input.qualityPreference
        : "best";
    const qualityLabels =
      mappedFormats.length > 0
        ? mappedFormats
        : [
            {
              label: fallbackLabel,
              rank: youtubeQualityHeight(fallbackLabel) ?? 0,
              formatId: fallbackLabel,
            },
          ];
    const selectedQuality = selectYoutubeQuality(qualityLabels, input.qualityPreference);

    // One source per player client. Clients fail independently — one answers 403 on
    // media URLs while another plays the same video — and which one works rotates
    // without notice. Naming them separately lets the existing startup source
    // failover walk them, so a 403 retries the next client instead of ending
    // playback. A single configured client stays a single source.
    const playerClients = parseYoutubePlayerClients(globalYoutubeConfig.extractorArgs);
    const lanes =
      playerClients.length > 0
        ? playerClients.map((client) => ({
            client,
            sourceId: `source:${YOUTUBE_PROVIDER_ID}:${client}`,
            label: `YouTube · ${client}`,
            extractorArgs: withYoutubePlayerClient(globalYoutubeConfig.extractorArgs, client),
          }))
        : [
            {
              client: null,
              sourceId: `source:${YOUTUBE_PROVIDER_ID}:youtube`,
              label: "YouTube",
              extractorArgs: globalYoutubeConfig.extractorArgs,
            },
          ];

    const streamId = (label: string, client: string | null) =>
      client
        ? `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:${client}:${label}`
        : `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:${label}`;

    const streams: StreamCandidate[] = lanes.flatMap((lane, laneIndex) =>
      qualityLabels.map((entry) => ({
        id: streamId(entry.label, lane.client),
        providerId: YOUTUBE_PROVIDER_ID,
        sourceId: lane.sourceId,
        variantId: `variant:${YOUTUBE_PROVIDER_ID}:${entry.label}`,
        url: watchUrl,
        protocol: "youtube" as const,
        container: "unknown" as const,
        qualityLabel: entry.label,
        qualityRank: entry.rank,
        requiresYtdl: true,
        headers: {},
        // Later lanes are fallbacks, so rank them below the first.
        confidence: (ytInfo ? 0.95 : 0.85) - laneIndex * 0.05,
        cachePolicy,
        metadata: {
          ytdlFormat: isLive ? defaultYtdlPlaybackFormat() : buildYtdlFormatSelector(entry.label),
          // Read back by the player so each lane asks yt-dlp for its own client
          // rather than the global default.
          extractorArgs: lane.extractorArgs,
          playerClient: lane.client,
          videoId,
          durationSeconds: ytInfo?.durationSeconds,
          isLive,
          liveStatus,
          // Read back by diagnostics: a resolve that ran without metadata has an
          // unverified quality ladder, so a wrong rendition is explainable.
          metadataUnavailable,
        },
      })),
    );

    const primaryLane = lanes[0];
    const selectedStreamId = streamId(
      selectedQuality?.label ?? "best",
      primaryLane?.client ?? null,
    );

    // One variant per quality, listing that quality's stream in every lane so the
    // failover order is preserved when a viewer picks a specific quality.
    const variants: ProviderVariantCandidate[] = qualityLabels.map((entry) => ({
      id: `variant:${YOUTUBE_PROVIDER_ID}:${entry.label}`,
      providerId: YOUTUBE_PROVIDER_ID,
      sourceId: primaryLane?.sourceId ?? `source:${YOUTUBE_PROVIDER_ID}:youtube`,
      qualityLabel: entry.label,
      qualityRank: entry.rank,
      protocol: "youtube",
      streamIds: lanes.map((lane) => streamId(entry.label, lane.client)),
      confidence: 0.9,
    }));

    const subtitles: SubtitleCandidate[] = mapYoutubeMetadataSubtitles(
      ytInfo,
      cachePolicy,
      input.preferredSubtitleLanguage,
    );

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
      sources: lanes.map((lane, laneIndex) => ({
        id: lane.sourceId,
        providerId: YOUTUBE_PROVIDER_ID,
        kind: "provider-api" as const,
        label: lane.label,
        host: "youtube.com",
        status: laneIndex === 0 ? ("selected" as const) : ("available" as const),
        confidence: 0.95 - laneIndex * 0.05,
        requiresRuntime: "direct-http" as const,
        cachePolicy,
      })),
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
  subtitlePreference: string | undefined,
): SubtitleCandidate[] {
  if (!info) return [];
  const subtitles: SubtitleCandidate[] = [];
  // Bounded at resolve time, not in the cached metadata: the full inventory stays
  // cached so changing the language preference does not require a re-fetch.
  for (const track of boundYoutubeSubtitleTracks(info.subtitles, subtitlePreference)) {
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
