import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  defineProviderManifest,
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
  YouTubeResultKind,
} from "@kunai/types";

import { selectVerifiedStream } from "../shared/resolve-gate";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { formatDurationSeconds } from "./format-duration";
import { buildYoutubeWatchUrl, parseYoutubeCatalogId, youtubeThumbnailUrl } from "./ids";
import {
  invidiousGetChannelVideos,
  invidiousGetPlaylist,
  invidiousGetVideo,
  invidiousSearch,
} from "./invidious-client";
import { pickInvidiousInstance } from "./invidious-instance-pool";
import { mapInvidiousSearchResults } from "./map-search-result";

export const INVIDIOUS_PROVIDER_ID = "invidious" as const;

export const invidiousManifest = defineProviderManifest({
  id: INVIDIOUS_PROVIDER_ID,
  displayName: "Invidious",
  description: "Direct YouTube streaming and metadata via Invidious public instance network",
  domain: "invidious.io",
  recommended: true,
  mediaKinds: ["video"],
  catalogIdentity: "provider-native",
  capabilities: ["search", "episode-list", "source-resolve", "subtitle-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: [
        "search",
        "list-episodes",
        "resolve-stream",
        "resolve-subtitles",
        "health-check",
      ],
      browserSafe: true,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: {
    ttlClass: "provider-metadata",
    scope: "local",
    keyParts: [
      "provider",
      INVIDIOUS_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "audio",
      "subtitle",
      "quality",
      "startup",
      "source",
      "stream",
    ],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: false,
  notes: ["Streams via Invidious DASH/HLS manifests and proxied HTTP without requiring yt-dlp."],
});

function filterYoutubeResultKind(
  results: readonly ProviderSearchResult[],
  kind: YouTubeResultKind | undefined,
): readonly ProviderSearchResult[] {
  return kind ? results.filter((result) => result.resultKind === kind) : results;
}

async function searchInvidious(
  input: ProviderSearchInput,
  context: ProviderRuntimeContext,
): Promise<readonly ProviderSearchResult[] | null> {
  const query = input.query?.trim();
  if (!query) return [];

  try {
    const items = await invidiousSearch(query, {
      signal: context.signal,
    });
    const mapped = mapInvidiousSearchResults(items);
    return filterYoutubeResultKind(mapped, input.preferredResultKind);
  } catch {
    return null;
  }
}

async function listInvidiousEpisodes(
  input: Parameters<NonNullable<CoreProviderModule["listEpisodes"]>>[0],
  context: ProviderRuntimeContext,
): Promise<readonly ProviderEpisodeOption[] | null> {
  const parsed = parseYoutubeCatalogId(input.title.id);
  if (parsed.kind === "playlist") {
    try {
      const playlist = await invidiousGetPlaylist(parsed.nativeId, {
        signal: context.signal,
      });
      return (playlist.videos ?? []).map((video, index) => {
        const thumbUrl = video.videoId ? youtubeThumbnailUrl(video.videoId) : undefined;
        return {
          index: video.index ?? index + 1,
          label: `#${video.index ?? index + 1}${video.lengthSeconds ? ` · ${formatDurationSeconds(video.lengthSeconds)}` : ""}`,
          name: video.title,
          detail: video.title,
          externalIds: video.videoId ? { youtubeId: video.videoId } : undefined,
          artwork: thumbUrl ? { thumbnailUrl: thumbUrl, posterUrl: thumbUrl } : undefined,
        };
      });
    } catch {
      return null;
    }
  }

  if (parsed.kind === "channel") {
    try {
      const channel = await invidiousGetChannelVideos(parsed.nativeId, {
        signal: context.signal,
      });
      const videos = channel.latestVideos ?? channel.videos ?? [];
      return videos.map((video, index) => {
        const thumbUrl = video.videoId ? youtubeThumbnailUrl(video.videoId) : undefined;
        return {
          index: index + 1,
          label: `#${index + 1}${video.lengthSeconds ? ` · ${formatDurationSeconds(video.lengthSeconds)}` : ""}`,
          name: video.title,
          detail: video.title,
          externalIds: video.videoId ? { youtubeId: video.videoId } : undefined,
          artwork: thumbUrl ? { thumbnailUrl: thumbUrl, posterUrl: thumbUrl } : undefined,
        };
      });
    } catch {
      return null;
    }
  }

  return null;
}

export async function resolveInvidious(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  if (input.mediaKind !== "video" && input.mediaKind !== "movie") {
    return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
      code: "unsupported-title",
      message: "Invidious provider only supports video playback",
      retryable: false,
    });
  }

  const parsed = parseYoutubeCatalogId(input.title.id);
  let videoId = parsed.kind === "video" ? parsed.nativeId : input.title.externalIds?.youtubeId;
  if (!videoId && input.episode?.episode !== undefined) {
    const episodeIndex = input.episode.episode;
    const episodes = await listInvidiousEpisodes(
      {
        title: input.title,
      },
      context,
    );
    const selected = episodes?.find((entry) => entry.index === episodeIndex);
    videoId = selected?.externalIds?.youtubeId;
  }

  if (!videoId) {
    return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
      code: "missing-input",
      message: "YouTube video id is missing",
      retryable: false,
    });
  }

  const startedAt = context.now();
  const events: ProviderTraceEvent[] = [];
  const failures: ProviderFailure[] = [];
  const cachePolicy = createProviderCachePolicy({
    providerId: INVIDIOUS_PROVIDER_ID,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
  });

  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId: INVIDIOUS_PROVIDER_ID,
    message: "Resolving video via Invidious instance network",
  });

  try {
    const [instanceUrl, videoDetails] = await Promise.all([
      pickInvidiousInstance({ signal: context.signal }).catch(() => "https://inv.nadeko.net"),
      invidiousGetVideo(videoId, { signal: context.signal }),
    ]);

    if (!videoDetails) {
      return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
        code: "not-found",
        message: "Video details could not be retrieved from Invidious",
        retryable: true,
      });
    }

    if (videoDetails.liveNow === false && videoDetails.liveStatus === "upcoming") {
      return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
        code: "unsupported-title",
        message: "This YouTube premiere has not started yet",
        retryable: false,
      });
    }

    const streams: StreamCandidate[] = [];
    const sourceId = `source:${INVIDIOUS_PROVIDER_ID}:direct`;

    if (videoDetails.dashUrl) {
      streams.push({
        id: `stream:${INVIDIOUS_PROVIDER_ID}:${videoId}:dash`,
        providerId: INVIDIOUS_PROVIDER_ID,
        sourceId,
        variantId: `variant:${INVIDIOUS_PROVIDER_ID}:dash`,
        url: videoDetails.dashUrl,
        protocol: "dash",
        container: "mpd",
        qualityLabel: "1080p",
        qualityRank: 1080,
        serverName: "Invidious DASH",
        flavorLabel: "DASH Manifest",
        requiresYtdl: false,
        headers: {},
        confidence: 0.95,
        cachePolicy,
        metadata: {
          videoId,
          durationSeconds: videoDetails.lengthSeconds,
          isLive: videoDetails.liveNow === true,
          liveStatus: videoDetails.liveStatus ?? (videoDetails.liveNow ? "live" : "none"),
        },
      });
    }

    if (videoDetails.hlsUrl) {
      streams.push({
        id: `stream:${INVIDIOUS_PROVIDER_ID}:${videoId}:hls`,
        providerId: INVIDIOUS_PROVIDER_ID,
        sourceId,
        variantId: `variant:${INVIDIOUS_PROVIDER_ID}:hls`,
        url: videoDetails.hlsUrl,
        protocol: "hls",
        container: "m3u8",
        qualityLabel: "720p",
        qualityRank: 720,
        serverName: "Invidious HLS",
        flavorLabel: "HLS Stream",
        requiresYtdl: false,
        headers: {},
        confidence: 0.9,
        cachePolicy,
        metadata: {
          videoId,
          durationSeconds: videoDetails.lengthSeconds,
          isLive: videoDetails.liveNow === true,
        },
      });
    }

    const watchUrl = buildYoutubeWatchUrl(videoId);
    const hasYtDlp = Boolean(Bun.which("yt-dlp", { PATH: process.env.PATH }));
    if (hasYtDlp) {
      streams.push({
        id: `stream:${INVIDIOUS_PROVIDER_ID}:${videoId}:ytdl`,
        providerId: INVIDIOUS_PROVIDER_ID,
        sourceId: `source:${INVIDIOUS_PROVIDER_ID}:ytdl`,
        variantId: `variant:${INVIDIOUS_PROVIDER_ID}:ytdl`,
        url: watchUrl,
        protocol: "youtube",
        container: "unknown",
        qualityLabel: "best",
        qualityRank: 1080,
        serverName: "YouTube Watch",
        flavorLabel: "yt-dlp fallback",
        requiresYtdl: true,
        headers: {},
        confidence: 0.85,
        cachePolicy,
        metadata: {
          videoId,
          durationSeconds: videoDetails.lengthSeconds,
          isLive: videoDetails.liveNow === true,
        },
      });
    }

    if (streams.length === 0) {
      return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
        code: "not-found",
        message: "No playable stream URL could be generated from Invidious",
        retryable: true,
      });
    }

    const subtitles: SubtitleCandidate[] = [];
    for (const caption of videoDetails.captions ?? []) {
      const rawLang = caption.language_code ?? "en";
      const normalized = normalizeIsoLanguageCode(rawLang) ?? rawLang;
      const subUrl = caption.url
        ? caption.url.startsWith("http")
          ? caption.url
          : `${instanceUrl}${caption.url.startsWith("/") ? "" : "/"}${caption.url}`
        : "";
      if (!subUrl) continue;
      subtitles.push({
        id: `subtitle:${INVIDIOUS_PROVIDER_ID}:${videoId}:${normalized}`,
        providerId: INVIDIOUS_PROVIDER_ID,
        sourceId,
        url: subUrl,
        language: normalized,
        label: caption.label ?? normalized,
        format: "vtt",
        source: "provider",
        confidence: 0.9,
        cachePolicy,
      });
    }

    const primaryStream = streams[0];
    if (!primaryStream) {
      return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
        code: "not-found",
        message: "No stream available",
        retryable: true,
      });
    }

    const variants: ProviderVariantCandidate[] = streams.map((stream) => ({
      id: stream.variantId ?? `variant:${INVIDIOUS_PROVIDER_ID}:${stream.id}`,
      providerId: INVIDIOUS_PROVIDER_ID,
      sourceId: stream.sourceId ?? sourceId,
      qualityLabel: stream.qualityLabel ?? "best",
      qualityRank: stream.qualityRank ?? 0,
      protocol: stream.protocol,
      streamIds: [stream.id],
      confidence: stream.confidence,
    }));

    const gated = await selectVerifiedStream({
      streams: [primaryStream, ...streams.filter((stream) => stream.id !== primaryStream.id)].slice(
        0,
        3,
      ),
      context,
      signal: context.signal,
    });
    if (!gated.accepted) {
      return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
        code: "not-found",
        message: `Invidious stream is unreachable (${gated.reason})`,
        retryable: true,
      });
    }
    const endedAt = context.now();
    emitTraceEvent(events, context, {
      type: "provider:success",
      providerId: INVIDIOUS_PROVIDER_ID,
      message: `Resolved Invidious stream with ${streams.length} candidate(s)`,
    });

    return {
      status: "resolved",
      providerId: INVIDIOUS_PROVIDER_ID,
      selectedStreamId: gated.stream.id,
      sources: [
        {
          id: sourceId,
          providerId: INVIDIOUS_PROVIDER_ID,
          kind: "provider-api" as const,
          label: "Invidious Direct Streams",
          host: "invidious.io",
          status: "selected" as const,
          confidence: 0.95,
          requiresRuntime: "direct-http" as const,
          cachePolicy,
        },
      ],
      streams,
      variants,
      subtitles,
      cachePolicy,
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: INVIDIOUS_PROVIDER_ID,
        streamId: gated.stream.id,
        cacheHit: false,
        runtime: "direct-http",
        startedAt,
        endedAt,
        steps: [
          createTraceStep("provider", "Resolved Invidious stream", {
            providerId: INVIDIOUS_PROVIDER_ID,
            attributes: {
              videoId,
              streamCount: streams.length,
            },
          }),
        ],
        events,
        failures,
      }),
      failures,
      healthDelta: {
        providerId: INVIDIOUS_PROVIDER_ID,
        outcome: "success",
        at: endedAt,
      },
    };
  } catch (error) {
    return createExhaustedResult(input, context, INVIDIOUS_PROVIDER_ID, {
      code: "network-error",
      message: error instanceof Error ? error.message : "Invidious resolve failed",
      retryable: true,
    });
  }
}

export const invidiousProviderModule: CoreProviderModule = {
  providerId: INVIDIOUS_PROVIDER_ID,
  manifest: invidiousManifest,
  search: searchInvidious,
  listEpisodes: listInvidiousEpisodes,
  resolve: resolveInvidious,
};
