import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderFailure,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import {
  loadAvailableEpisodesDetail,
  resolveAnimeEpisodeString,
  resolveEpisodeSources,
  buildStreamHeaders,
} from "./api-client";
import { allanimeManifest, ALLANIME_PROVIDER_ID } from "./manifest";

export { ALLANIME_PROVIDER_ID };

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";
const ALLANIME_API_URL = "https://api.allanime.day/api";
const ALLANIME_REFERER = "https://youtu-chan.com";

export const allmangaProviderModule: CoreProviderModule = {
  providerId: ALLANIME_PROVIDER_ID,
  manifest: allanimeManifest,
  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AllManga only supports anime",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
        code: "runtime-missing",
        message: "AllManga resolver requires direct-http runtime",
        retryable: false,
      });
    }

    // We expect the core to map to the internal allanime _id. If it's missing, we fail.
    // But actually, AllAnime search returned `id`. Let's assume input.title.id is the allanime internal ID.
    const showId = input.title.id.replace("allanime:", "");
    if (!showId) {
      return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AllManga requires an internal show ID",
        retryable: false,
      });
    }

    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];
    const cachePolicy = createProviderCachePolicy({
      providerId: ALLANIME_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: ALLANIME_PROVIDER_ID,
      message: "Started AllManga 0-RAM resolution",
    });

    try {
      const mode =
        input.preferredAudioLanguage === "ja" || input.preferredAudioLanguage === "original"
          ? "sub"
          : "dub";
      const episodeNum = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;

      // Load the catalog to find the exact episode string (e.g. "01" or "1.5")
      const detail = await loadAvailableEpisodesDetail(
        ALLANIME_API_URL,
        ALLANIME_REFERER,
        DEFAULT_UA,
        showId,
      );
      const episodes = (detail[mode] ?? []) as string[];

      if (episodes.length === 0) {
        throw new Error(`No ${mode} episodes found for show ${showId}`);
      }

      const epStr = resolveAnimeEpisodeString(episodes, episodeNum);

      // Fetch the sources (Decodes Hex and AES)
      const links = await resolveEpisodeSources({
        apiUrl: ALLANIME_API_URL,
        referer: ALLANIME_REFERER,
        ua: DEFAULT_UA,
        showId,
        epStr,
        mode,
      });

      if (links.length === 0) {
        throw new Error(`No streams extracted from AllManga for episode ${epStr}`);
      }

      const streams: StreamCandidate[] = [];
      const variants: ProviderVariantCandidate[] = [];
      const subtitles: SubtitleCandidate[] = [];

      // Map the links to our strict format
      for (const link of links) {
        if (!link.url) continue;

        const qualityStr = link.quality || "auto";
        const sourceName = qualityStr.includes("HLS") ? "FM-HLS" : "VID-MP4";
        const sourceId = `source:${ALLANIME_PROVIDER_ID}:${sourceName.toLowerCase()}`;

        const streamId = `stream:${ALLANIME_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
        const variantId = `variant:${ALLANIME_PROVIDER_ID}:${sourceId}:${qualityStr}`;

        const protocol = link.url.includes(".m3u8") ? "hls" : "mp4";

        const headers = buildStreamHeaders(link.referer, ALLANIME_REFERER, DEFAULT_UA);

        streams.push({
          id: streamId,
          providerId: ALLANIME_PROVIDER_ID,
          sourceId,
          variantId,
          url: link.url,
          protocol,
          container: protocol === "hls" ? "m3u8" : "mp4",
          audioLanguages: [mode],
          hardSubLanguage: mode === "sub" ? "en" : undefined,
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          headers,
          confidence: protocol === "hls" ? 0.95 : 0.85,
          cachePolicy,
        });

        variants.push({
          id: variantId,
          providerId: ALLANIME_PROVIDER_ID,
          sourceId,
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          protocol,
          container: protocol === "hls" ? "m3u8" : "mp4",
          audioLanguages: [mode],
          streamIds: [streamId],
          confidence: protocol === "hls" ? 0.95 : 0.85,
        });

        if (link.subtitle) {
          const subId = `subtitle:${ALLANIME_PROVIDER_ID}:${Bun.hash(link.subtitle).toString(36)}`;
          subtitles.push({
            id: subId,
            providerId: ALLANIME_PROVIDER_ID,
            sourceId,
            url: link.subtitle,
            language: "en",
            label: "English",
            format: "vtt",
            source: "embedded",
            confidence: 0.9,
            cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
          });
        }
      }

      // Sort streams so HLS/1080p is at the top
      streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
      variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      const selectedStream =
        streams.find(
          (s) => s.qualityLabel?.includes(input.qualityPreference || "") || s.protocol === "hls",
        ) || streams[0];
      if (!selectedStream) {
        throw new Error("No selectable AllManga streams were mapped.");
      }
      const sourceCandidates = buildAllmangaSourceCandidates(
        streams,
        selectedStream.sourceId,
        cachePolicy,
      );

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: ALLANIME_PROVIDER_ID,
        message: `Successfully resolved AllManga for ID ${showId}`,
      });

      const endedAt = context.now();

      return {
        providerId: ALLANIME_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: sourceCandidates,
        streams,
        variants,
        subtitles,
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: ALLANIME_PROVIDER_ID,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved AllManga through GraphQL payload", {
              providerId: ALLANIME_PROVIDER_ID,
              attributes: { streams: streams.length },
            }),
          ],
          events,
          failures,
        }),
        failures,
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
          code: "cancelled",
          message: "AllManga resolution was cancelled",
          retryable: false,
        });
      }

      const failure: ProviderFailure = {
        providerId: ALLANIME_PROVIDER_ID,
        code: "network-error",
        message: error instanceof Error ? error.message : "AllManga API failed",
        retryable: true,
        at: context.now(),
      };
      failures.push(failure);

      return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, failure);
    }
  },
};

export function buildAllmangaSourceCandidates(
  streams: readonly StreamCandidate[],
  selectedSourceId: string | undefined,
  cachePolicy: StreamCandidate["cachePolicy"],
): ProviderSourceCandidate[] {
  const streamsBySource = new Map<string, StreamCandidate[]>();
  for (const stream of streams) {
    if (!stream.sourceId) continue;
    streamsBySource.set(stream.sourceId, [...(streamsBySource.get(stream.sourceId) ?? []), stream]);
  }

  return [...streamsBySource.entries()].map(([sourceId, sourceStreams]) => ({
    id: sourceId,
    providerId: ALLANIME_PROVIDER_ID,
    kind: "provider-api",
    label: formatAllmangaSourceLabel(sourceId),
    host: "api.allanime.day",
    status: sourceId === selectedSourceId ? "selected" : "available",
    confidence: Math.max(...sourceStreams.map((stream) => stream.confidence)),
    requiresRuntime: "direct-http",
    cachePolicy,
    metadata: {
      sourceFamily: sourceId.split(":").at(-1) ?? sourceId,
      streamIds: sourceStreams.map((stream) => stream.id).join(","),
    },
  }));
}

function formatAllmangaSourceLabel(sourceId: string): string {
  const family = sourceId.split(":").at(-1) ?? sourceId;
  return family
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}
