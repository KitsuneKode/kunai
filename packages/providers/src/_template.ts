import {
    createProviderCachePolicy,
    createResolveTrace,
    createTraceStep,
    type CoreProviderModule,
    defineProviderManifest,
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
  
  // =====================================================================
  // 1. MANIFEST DEFINITION
  // Define your provider's capabilities, cache policies, and runtime needs.
  // =====================================================================
  
  export const TEMPLATE_PROVIDER_ID = "template-provider" as const;
  
  export const templateManifest = defineProviderManifest({
    id: TEMPLATE_PROVIDER_ID,
    displayName: "Template Provider",
    description: "A boilerplate template for building new Kunai providers",
    domain: "example.com",
    recommended: false,
    mediaKinds: ["anime", "movie", "series"], // What content do you support?
    capabilities: ["source-resolve", "multi-source", "quality-ranked"],
    runtimePorts: [
      {
        runtime: "node-fetch", // Change to "playwright-lease" if Cloudflare blocks you
        operations: ["resolve-stream", "health-check"],
        browserSafe: true, // Set false if you rely on Node.js specific modules (like crypto)
        relaySafe: true,
        localOnly: false,
      },
    ],
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [
        "provider",
        TEMPLATE_PROVIDER_ID,
        "media-kind",
        "title",
        "season",
        "episode",
        "subtitle",
      ],
      allowStale: true,
    },
    browserSafe: true,
    relaySafe: true,
    status: "experimental",
    notes: [
      "This is a community template. Copy and paste this file to start building."
    ],
  });
  
  // =====================================================================
  // 2. PROVIDER IMPLEMENTATION
  // The actual resolution logic. Must return a ProviderResolveResult.
  // =====================================================================
  
  export const templateProviderModule: CoreProviderModule = {
    providerId: TEMPLATE_PROVIDER_ID,
    manifest: templateManifest,
    async resolve(input, context) {
      // -------------------------------------------------------------
      // A. Input Validation
      // -------------------------------------------------------------
      if (!input.allowedRuntimes.includes("node-fetch")) {
        return createExhaustedResult(input, context, {
          code: "runtime-missing",
          message: "Template resolver requires node-fetch runtime",
          retryable: false,
        });
      }
  
      // Get the correct ID for your backend (AniList or TMDB)
      const targetId = input.title.anilistId ?? input.title.id; 
  
      const startedAt = context.now();
      const events: ProviderTraceEvent[] = [];
      const failures: ProviderFailure[] = [];
  
      const cachePolicy = createProviderCachePolicy({
        providerId: TEMPLATE_PROVIDER_ID,
        title: input.title,
        episode: input.episode,
        subtitleLanguage: input.preferredSubtitleLanguage,
        qualityPreference: input.qualityPreference,
      });
  
      emit(events, context, {
        type: "provider:start",
        providerId: TEMPLATE_PROVIDER_ID,
        message: "Started Template resolution",
      });
  
      // -------------------------------------------------------------
      // B. Fetch Logic (Wrap in try/catch and use context.signal!)
      // -------------------------------------------------------------
      try {
        /* 
         * YOUR API LOGIC GOES HERE 
         * Example:
         * const res = await fetch(`https://api.example.com/watch/${targetId}`, { signal: context.signal });
         * const data = await res.json();
         */
  
        // Dummy Data for Template
        const rawSources = [{ url: "https://example.com/video.mp4", quality: "1080p" }];
        
        if (rawSources.length === 0) {
            throw new Error("No streams found on backend.");
        }
  
        // -------------------------------------------------------------
        // C. Map to Kunai's Strict Types
        // -------------------------------------------------------------
        const streams: StreamCandidate[] = [];
        const variants: ProviderVariantCandidate[] = [];
        const subtitles: SubtitleCandidate[] = [];
  
        const sourceId = `source:${TEMPLATE_PROVIDER_ID}:server1`;
  
        rawSources.forEach((s) => {
            const qualityStr = s.quality || "auto";
            const streamId = `stream:${TEMPLATE_PROVIDER_ID}:${Bun.hash(s.url).toString(36)}`;
            const variantId = `variant:${TEMPLATE_PROVIDER_ID}:${sourceId}:${qualityStr}`;
            
            const protocol = s.url.includes(".m3u8") ? "hls" : "mp4";
            
            streams.push({
                id: streamId,
                providerId: TEMPLATE_PROVIDER_ID,
                sourceId,
                variantId,
                url: s.url,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                headers: { "Referer": "https://example.com/" }, // Add CDN required headers here
                confidence: 0.9,
                cachePolicy
            });
  
            variants.push({
                id: variantId,
                providerId: TEMPLATE_PROVIDER_ID,
                sourceId,
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                streamIds: [streamId],
                confidence: 0.9,
            });
        });
  
        // Sort best qualities to the top
        streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
        variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  
        const selectedStream = streams[0];
  
        // -------------------------------------------------------------
        // D. Return the Success Object
        // -------------------------------------------------------------
        emit(events, context, {
          type: "provider:success",
          providerId: TEMPLATE_PROVIDER_ID,
          message: `Successfully resolved stream`,
        });
  
        const endedAt = context.now();
  
        return {
          providerId: TEMPLATE_PROVIDER_ID,
          selectedStreamId: selectedStream!.id,
          sources: [
            {
              id: sourceId,
              providerId: TEMPLATE_PROVIDER_ID,
              kind: "provider-api",
              label: "ExampleServer",
              host: "example.com",
              status: "selected",
              confidence: 0.9,
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
            providerId: TEMPLATE_PROVIDER_ID,
            streamId: selectedStream!.id,
            cacheHit: false,
            runtime: "node-fetch",
            startedAt,
            endedAt,
            steps: [
              createTraceStep("provider", "Resolved via Template", {
                providerId: TEMPLATE_PROVIDER_ID,
                attributes: { streams: streams.length }
              }),
            ],
            events,
            failures,
          }),
          failures,
          healthDelta: {
            providerId: TEMPLATE_PROVIDER_ID,
            outcome: "success",
            at: endedAt,
          },
        };
  
      } catch (error) {
        // -------------------------------------------------------------
        // E. Catch Errors (Always handle user cancellation)
        // -------------------------------------------------------------
        if (context.signal?.aborted) {
            return createExhaustedResult(input, context, {
              code: "cancelled",
              message: "Resolution was cancelled by the user",
              retryable: false,
            });
        }
  
        failures.push({
            providerId: TEMPLATE_PROVIDER_ID,
            code: "network-error",
            message: error instanceof Error ? error.message : "API failed",
            retryable: true,
            at: context.now()
        });
  
        return createExhaustedResult(input, context, failures[0]);
      }
    },
  };
  
  // =====================================================================
  // 3. INTERNAL HELPERS
  // =====================================================================
  function createExhaustedResult(
    input: ProviderResolveInput,
    context: ProviderRuntimeContext,
    failure: Omit<ProviderFailure, "providerId" | "at">
  ): ProviderResolveResult {
    const at = context.now();
    const providerFailure: ProviderFailure = {
      providerId: TEMPLATE_PROVIDER_ID,
      at,
      ...failure,
    };
  
    const event: ProviderTraceEvent = {
      type: "provider:exhausted",
      at,
      providerId: TEMPLATE_PROVIDER_ID,
      message: providerFailure.message,
    };
    context.emit?.(event);
  
    return {
      providerId: TEMPLATE_PROVIDER_ID,
      streams: [],
      subtitles: [],
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: TEMPLATE_PROVIDER_ID,
        cacheHit: false,
        runtime: "node-fetch",
        startedAt: at,
        endedAt: at,
        steps: [
          createTraceStep("provider", providerFailure.message, {
            providerId: TEMPLATE_PROVIDER_ID,
            attributes: { code: providerFailure.code },
          }),
        ],
        events: [event],
        failures: [providerFailure],
      }),
      failures: [providerFailure],
      healthDelta: {
        providerId: TEMPLATE_PROVIDER_ID,
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