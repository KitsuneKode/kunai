import {
    createProviderCachePolicy,
    createResolveTrace,
    createTraceStep,
    type CoreProviderModule,
    allanimeManifest,
  } from "@kunai/core";
  import type {
    ProviderResolveInput,
    ProviderResolveResult,
    ProviderRuntimeContext,
    ProviderTraceEvent,
    ProviderVariantCandidate,
    StreamCandidate,
    ProviderFailure,
    SubtitleCandidate,
  } from "@kunai/types";
  import {
    loadAvailableEpisodesDetail,
    resolveAnimeEpisodeString,
    resolveEpisodeSources,
    buildStreamHeaders,
  } from "./api-client";
  
  export const ALLANIME_PROVIDER_ID = allanimeManifest.id;
  
  const DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";
  const ALLANIME_API_URL = "https://api.allanime.day/api";
  const ALLANIME_REFERER = "https://youtu-chan.com";
  
  export const allmangaProviderModule: CoreProviderModule = {
    providerId: ALLANIME_PROVIDER_ID,
    manifest: allanimeManifest,
    async resolve(input, context) {
      if (input.mediaKind !== "anime") {
        return createExhaustedResult(input, context, {
          code: "unsupported-title",
          message: "AllManga only supports anime",
          retryable: false,
        });
      }
  
      if (!input.allowedRuntimes.includes("node-fetch")) {
        return createExhaustedResult(input, context, {
          code: "runtime-missing",
          message: "AllManga resolver requires node-fetch runtime",
          retryable: false,
        });
      }
  
      // We expect the core to map to the internal allanime _id. If it's missing, we fail.
      // But actually, AllAnime search returned `id`. Let's assume input.title.id is the allanime internal ID.
      const showId = input.title.id.replace("allanime:", "");
      if (!showId) {
        return createExhaustedResult(input, context, {
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
  
      emit(events, context, {
        type: "provider:start",
        providerId: ALLANIME_PROVIDER_ID,
        message: "Started AllManga 0-RAM resolution",
      });
  
      try {
        const mode = input.preferredAudioLanguage === "dub" ? "dub" : "sub";
        const episodeNum = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;
        
        // Load the catalog to find the exact episode string (e.g. "01" or "1.5")
        const detail = await loadAvailableEpisodesDetail(ALLANIME_API_URL, ALLANIME_REFERER, DEFAULT_UA, showId);
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
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
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
                audioLanguage: mode,
                isHardsubbed: mode === "sub", // AllAnime generally hardsubs its direct mp4s
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                headers,
                confidence: protocol === "hls" ? 0.95 : 0.85,
                cachePolicy
            });
  
            variants.push({
                id: variantId,
                providerId: ALLANIME_PROVIDER_ID,
                sourceId,
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                audioLanguage: mode,
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
                    cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" }
                });
            }
        }
  
        // Sort streams so HLS/1080p is at the top
        streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
        variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  
        const selectedStream = streams.find(s => s.qualityLabel?.includes(input.qualityPreference || "") || s.protocol === "hls") || streams[0];
  
        emit(events, context, {
          type: "provider:success",
          providerId: ALLANIME_PROVIDER_ID,
          message: `Successfully resolved AllManga for ID ${showId}`,
        });
  
        const endedAt = context.now();
  
        return {
          providerId: ALLANIME_PROVIDER_ID,
          selectedStreamId: selectedStream!.id,
          sources: [
            {
              id: `source:${ALLANIME_PROVIDER_ID}:allmanga`,
              providerId: ALLANIME_PROVIDER_ID,
              kind: "provider-api",
              label: "AllManga",
              host: "api.allanime.day",
              status: "selected",
              confidence: 0.95,
              requiresRuntime: "node-fetch",
              cachePolicy
            }
          ],
          streams,
          variants,
          subtitles,
          cachePolicy,
          trace: createResolveTrace({
            title: input.title,
            episode: input.episode,
            providerId: ALLANIME_PROVIDER_ID,
            streamId: selectedStream!.id,
            cacheHit: false,
            runtime: "node-fetch",
            startedAt,
            endedAt,
            steps: [
              createTraceStep("provider", "Resolved AllManga through GraphQL payload", {
                providerId: ALLANIME_PROVIDER_ID,
                attributes: { streams: streams.length }
              }),
            ],
            events,
            failures,
          }),
          failures,
        };
  
      } catch (error) {
        if (context.signal?.aborted) {
            return createExhaustedResult(input, context, {
              code: "cancelled",
              message: "AllManga resolution was cancelled",
              retryable: false,
            });
        }
  
        failures.push({
            providerId: ALLANIME_PROVIDER_ID,
            code: "network-error",
            message: error instanceof Error ? error.message : "AllManga API failed",
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
      providerId: ALLANIME_PROVIDER_ID,
      at,
      ...failure,
    };
  
    const event: ProviderTraceEvent = {
      type: "provider:exhausted",
      at,
      providerId: ALLANIME_PROVIDER_ID,
      message: providerFailure.message,
    };
    context.emit?.(event);
  
    return {
      providerId: ALLANIME_PROVIDER_ID,
      streams: [],
      subtitles: [],
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: ALLANIME_PROVIDER_ID,
        cacheHit: false,
        runtime: "node-fetch",
        startedAt: at,
        endedAt: at,
        steps: [
          createTraceStep("provider", providerFailure.message, {
            providerId: ALLANIME_PROVIDER_ID,
            attributes: { code: providerFailure.code },
          }),
        ],
        events: [event],
        failures: [providerFailure],
      }),
      failures: [providerFailure],
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