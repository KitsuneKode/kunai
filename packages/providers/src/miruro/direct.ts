import {
    createProviderCachePolicy,
    createResolveTrace,
    createTraceStep,
    type CoreProviderModule,
    miruroManifest,
  } from "@kunai/core";
  import type {
    ProviderResolveInput,
    ProviderResolveResult,
    ProviderRuntimeContext,
    ProviderSourceCandidate,
    ProviderTraceEvent,
    ProviderVariantCandidate,
    StreamCandidate,
    ProviderFailure,
  } from "@kunai/types";
  
  export const MIRURO_PROVIDER_ID = miruroManifest.id;
  export const MIRURO_REFERER = "https://www.miruro.tv/";
  
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  
  export const miruroProviderModule: CoreProviderModule = {
    providerId: MIRURO_PROVIDER_ID,
    manifest: miruroManifest,
    async resolve(input, context) {
      if (input.mediaKind !== "anime") {
        return createExhaustedResult(input, context, {
          code: "unsupported-title",
          message: "Miruro direct resolver only supports anime",
          retryable: false,
        });
      }
  
      if (!input.allowedRuntimes.includes("node-fetch")) {
        return createExhaustedResult(input, context, {
          code: "runtime-missing",
          message: "Miruro direct resolver requires node-fetch runtime",
          retryable: false,
        });
      }
  
      // We must have an AniList ID for Miruro backend
      const anilistId = input.title.anilistId ?? input.title.id.replace("anilist:", "");
      if (!anilistId || Number.isNaN(Number(anilistId))) {
        return createExhaustedResult(input, context, {
          code: "unsupported-title",
          message: "Miruro direct resolver requires a numeric AniList ID",
          retryable: false,
        });
      }
  
      const absoluteEpisode = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;
      const startedAt = context.now();
      const events: ProviderTraceEvent[] = [];
      const failures: ProviderFailure[] = [];
  
      emit(events, context, {
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
        const mediaReq = await fetch(
          `https://theanimecommunity.com/api/v1/episodes/mediaItemID?AniList_ID=${anilistId}&mediaType=anime&episodeChapterNumber=${absoluteEpisode}`,
          {
            headers: { "User-Agent": USER_AGENT },
            signal: context.signal,
          }
        );
  
        if (!mediaReq.ok) {
          throw new Error(`MediaItem API failed with ${mediaReq.status}`);
        }
  
        const mediaData = await mediaReq.json() as any;
        const mediaItemId = mediaData?.mediaItemID;
        
        if (!mediaItemId) {
          throw new Error("No mediaItemID found for this episode.");
        }
  
        // 2. Fetch the Sources
        const sourceReq = await fetch(
          `https://theanimecommunity.com/api/v1/episodes/${mediaItemId}/${absoluteEpisode}`,
          {
            headers: { "User-Agent": USER_AGENT },
            signal: context.signal,
          }
        );
  
        if (!sourceReq.ok) {
          throw new Error(`Sources API failed with ${sourceReq.status}`);
        }
  
        const sourceData = await sourceReq.json() as any;
        const subDubObj = sourceData?.sources;
  
        if (!subDubObj) {
          throw new Error("No sources object returned.");
        }
  
        // Parse the sub/dub arrays
        const targetAudio = input.preferredAudioLanguage === "dub" ? "dub" : "sub";
        let rawStreams = subDubObj[targetAudio] || [];
  
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
  
        rawStreams.forEach((streamRaw: any) => {
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
                audioLanguage: targetAudio,
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                headers: {
                    referer: MIRURO_REFERER, // Required by pro.ultracloud.cc CDN
                    "user-agent": USER_AGENT
                },
                confidence: 0.95,
                cachePolicy
            });
  
            variants.push({
                id: variantId,
                providerId: MIRURO_PROVIDER_ID,
                sourceId,
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                audioLanguage: targetAudio,
                streamIds: [streamId],
                confidence: 0.95,
            });
        });
  
        // Sort streams by quality rank
        streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
        variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  
        const selectedStream = streams.find(s => s.qualityLabel?.includes(input.qualityPreference || "")) || streams[0];
  
        if (!selectedStream) {
            throw new Error("Failed to select a valid stream.");
        }
  
        emit(events, context, {
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
              requiresRuntime: "node-fetch",
              cachePolicy
            }
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
            runtime: "node-fetch",
            startedAt,
            endedAt,
            steps: [
              createTraceStep("provider", "Resolved Miruro through direct backend payload", {
                providerId: MIRURO_PROVIDER_ID,
                attributes: { streams: streams.length }
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
            return createExhaustedResult(input, context, {
              code: "cancelled",
              message: "Miruro resolution was cancelled",
              retryable: false,
            });
        }
  
        failures.push({
            providerId: MIRURO_PROVIDER_ID,
            code: "network-error",
            message: error instanceof Error ? error.message : "Failed to fetch from Miruro backend",
            retryable: true,
            at: context.now()
        });
  
        return createExhaustedResult(input, context, failures[0]);
      }
    },
  };
  
  function createExhaustedResult(
    input: ProviderResolveInput,
    context: ProviderRuntimeContext,
    failure: Omit<ProviderFailure, "providerId" | "at">
  ): ProviderResolveResult {
    const at = context.now();
    const providerFailure: ProviderFailure = {
      providerId: MIRURO_PROVIDER_ID,
      at,
      ...failure,
    };
  
    const event: ProviderTraceEvent = {
      type: "provider:exhausted",
      at,
      providerId: MIRURO_PROVIDER_ID,
      message: providerFailure.message,
    };
    context.emit?.(event);
  
    return {
      providerId: MIRURO_PROVIDER_ID,
      streams: [],
      subtitles: [],
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: MIRURO_PROVIDER_ID,
        cacheHit: false,
        runtime: "node-fetch",
        startedAt: at,
        endedAt: at,
        steps: [
          createTraceStep("provider", providerFailure.message, {
            providerId: MIRURO_PROVIDER_ID,
            attributes: { code: providerFailure.code },
          }),
        ],
        events: [event],
        failures: [providerFailure],
      }),
      failures: [providerFailure],
      healthDelta: {
        providerId: MIRURO_PROVIDER_ID,
        outcome: failure.code === "cancelled" ? "failure" : "failure",
        at,
      },
    };
  }
  
  function emit(
    events: ProviderTraceEvent[],
    context: ProviderRuntimeContext | undefined,
    event: Omit<ProviderTraceEvent, "at">,
  ): void {
    const fullEvent = {
      ...event,
      at: context?.now() ?? new Date().toISOString(),
    };
    events.push(fullEvent);
    context?.emit?.(fullEvent);
  }