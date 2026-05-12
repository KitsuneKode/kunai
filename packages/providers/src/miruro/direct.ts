import type {
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
} from "@kunai/types";
import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import { miruroManifest, MIRURO_PROVIDER_ID } from "./manifest";
import { ProviderHttpError, providerJson } from "../runtime/fetch";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";

export { MIRURO_PROVIDER_ID };
export const MIRURO_REFERER = "https://www.miruro.tv/";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type MiruroMediaItemResponse = {
  readonly mediaItemID?: string | number;
};

type MiruroRawStream = {
  readonly url?: string;
  readonly quality?: string;
};

type MiruroSourcesResponse = {
  readonly sources?: {
    readonly sub?: readonly MiruroRawStream[];
    readonly dub?: readonly MiruroRawStream[];
  };
};

export const miruroProviderModule: CoreProviderModule = {
  providerId: MIRURO_PROVIDER_ID,
  manifest: miruroManifest,
  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro direct resolver only supports anime",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Miruro direct resolver requires direct-http runtime",
        retryable: false,
      });
    }

    // We must have an AniList ID for Miruro backend
    const anilistId = input.title.anilistId ?? input.title.id.replace("anilist:", "");
    if (!anilistId || Number.isNaN(Number(anilistId))) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro direct resolver requires a numeric AniList ID",
        retryable: false,
      });
    }

    const absoluteEpisode = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: MIRURO_PROVIDER_ID,
      message: "Started Miruro direct backend resolution",
    });

    const sourceId = `source:${MIRURO_PROVIDER_ID}:theanimecommunity`;
    const cachePolicy = createProviderCachePolicy({
      providerId: MIRURO_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
    });

    try {
      // 1. Fetch MediaItemID from AniList ID
      const mediaData = await providerJson<MiruroMediaItemResponse>(
        context,
        `https://theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID=${anilistId}&mediaType=anime&episodeChapterNumber=${absoluteEpisode}`,
        {
          headers: { "User-Agent": USER_AGENT },
          signal: context.signal,
        },
        { providerId: MIRURO_PROVIDER_ID, stage: "source:start" },
      );
      const mediaItemId = mediaData?.mediaItemID;

      if (!mediaItemId) {
        throw new Error("No mediaItemID found for this episode.");
      }

      // 2. Fetch the Sources
      const sourceData = await providerJson<MiruroSourcesResponse>(
        context,
        `https://theanimecommunity.com/api/v1/episodes/${mediaItemId}/${absoluteEpisode}`,
        {
          headers: { "User-Agent": USER_AGENT },
          signal: context.signal,
        },
        { providerId: MIRURO_PROVIDER_ID, stage: "source:start" },
      );
      const subDubObj = sourceData?.sources;

      if (!subDubObj) {
        throw new Error("No sources object returned.");
      }

      // Parse the sub/dub arrays
      const targetAudio = input.preferredAudioLanguage === "dub" ? "dub" : "sub";
      let rawStreams: readonly MiruroRawStream[] = subDubObj[targetAudio] || [];

      if (rawStreams.length === 0) {
        // Fallback to the other if the preferred is missing
        const fallbackAudio = targetAudio === "dub" ? "sub" : "dub";
        rawStreams = subDubObj[fallbackAudio] || [];
        if (rawStreams.length === 0) {
          throw new Error("No streams available for sub or dub.");
        }
      }

      const streams: StreamCandidate[] = [];
      const variants: ProviderVariantCandidate[] = [];

      rawStreams.forEach((streamRaw) => {
        if (!streamRaw.url) return;
        const qualityStr = streamRaw.quality || "auto";
        const streamId = `stream:${MIRURO_PROVIDER_ID}:${Bun.hash(streamRaw.url).toString(36)}`;
        const variantId = `variant:${MIRURO_PROVIDER_ID}:${sourceId}:${qualityStr}`;

        const protocol = streamRaw.url.includes(".m3u8") ? "hls" : "mp4";

        streams.push({
          id: streamId,
          providerId: MIRURO_PROVIDER_ID,
          sourceId,
          variantId,
          url: streamRaw.url,
          protocol,
          container: protocol === "hls" ? "m3u8" : "mp4",
          audioLanguages: [targetAudio],
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          headers: {
            referer: MIRURO_REFERER, // Required by pro.ultracloud.cc CDN
            "user-agent": USER_AGENT,
          },
          confidence: 0.95,
          cachePolicy,
        });

        variants.push({
          id: variantId,
          providerId: MIRURO_PROVIDER_ID,
          sourceId,
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          protocol,
          container: protocol === "hls" ? "m3u8" : "mp4",
          audioLanguages: [targetAudio],
          streamIds: [streamId],
          confidence: 0.95,
        });
      });

      // Sort streams by quality rank
      streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
      variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      const selectedStream =
        streams.find((s) => s.qualityLabel?.includes(input.qualityPreference || "")) || streams[0];

      if (!selectedStream) {
        throw new Error("Failed to select a valid stream.");
      }

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: MIRURO_PROVIDER_ID,
        message: `Successfully resolved Miruro 0-RAM stream for AniList ID ${anilistId}`,
      });

      const endedAt = context.now();

      return {
        providerId: MIRURO_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: [
          {
            id: sourceId,
            providerId: MIRURO_PROVIDER_ID,
            kind: "provider-api",
            label: "theanimecommunity.com",
            host: "theanimecommunity.com",
            status: "selected",
            confidence: 0.95,
            requiresRuntime: "direct-http",
            cachePolicy,
          },
        ],
        streams,
        variants,
        subtitles: [], // Native HLS often has embedded softsubs
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: MIRURO_PROVIDER_ID,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved Miruro through direct backend payload", {
              providerId: MIRURO_PROVIDER_ID,
              attributes: { streams: streams.length },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: MIRURO_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "cancelled",
          message: "Miruro resolution was cancelled",
          retryable: false,
        });
      }

      const failure: ProviderFailure = {
        providerId: MIRURO_PROVIDER_ID,
        code: error instanceof ProviderHttpError ? error.code : "network-error",
        message: error instanceof Error ? error.message : "Failed to fetch from Miruro backend",
        retryable: error instanceof ProviderHttpError ? error.retryable : true,
        at: context.now(),
      };
      failures.push(failure);

      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, failure);
    }
  },
};


