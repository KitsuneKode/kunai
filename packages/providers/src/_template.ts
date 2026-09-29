import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  isAbortError,
  isOfflineNetworkFailure,
  type CoreProviderModule,
  defineProviderManifest,
} from "@kunai/core";
import type {
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  ProviderFailure,
  SubtitleCandidate,
} from "@kunai/types";

// When you add real fetching, also import providerJson from this module.
import { ProviderHttpError } from "./runtime/fetch";
import { createExhaustedResult, emitTraceEvent } from "./shared/resolve-helpers";

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
      runtime: "direct-http",
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
  // Keep "experimental" until the adapter is proven on real traffic; peers
  // promote to "candidate" before "production" (miruro/hianime/rivestream).
  status: "experimental",
  // List every host the resolver can hit — the relay refuses anything else,
  // and this list is what the deployed relay bakes in.
  relayProfile: {
    upstreamHosts: ["api.example.com"],
  },
  notes: ["This is a community template. Copy and paste this file to start building."],
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
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, TEMPLATE_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Template resolver requires direct-http runtime",
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

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: TEMPLATE_PROVIDER_ID,
      message: "Started Template resolution",
    });

    // -------------------------------------------------------------
    // B. Fetch Logic — always through the provider fetch port.
    //
    // `providerJson` goes through context.fetch (relay-aware transport),
    // throws ProviderHttpError with the status already classified
    // (408/504→timeout, 429→rate-limited, 401/403→blocked, 404→not-found,
    // 5xx→provider-unavailable), and marks JSON drift "parse-failed".
    // Never call bare fetch(): it bypasses the relay port and throws
    // unclassified errors that read as network noise downstream.
    // -------------------------------------------------------------
    try {
      /*
       * YOUR API LOGIC GOES HERE
       * Example:
       * const data = await providerJson<{ url: string; quality?: string }[]>(
       *   context,
       *   `https://api.example.com/watch/${targetId}`,
       *   {
       *     signal: context.signal,
       *     headers: { "User-Agent": "…" },
       *   },
       *   { providerId: TEMPLATE_PROVIDER_ID, stage: "source-fetch" },
       * );
       */

      // Multi-candidate providers should race options through
      // `runProviderCycle` instead of trying them inline — see the block at
      // the bottom of this file. One rule that must never regress:
      // `candidateTimeoutMs` goes through
      // `providerCycleCandidateTimeoutMs(startupPriority, preferred)`; a raw
      // constant silently never fires when it exceeds the attempt budget
      // (this bug has shipped three times and is now test-gated).

      // Dummy Data for Template
      const rawSources = [{ url: `https://example.com/${targetId}/video.mp4`, quality: "1080p" }];

      if (rawSources.length === 0) {
        // A real "the catalog has nothing" answer — NOT a transport failure.
        // Upstream empties are allowed to read as empty; only transport,
        // HTTP-status, and parse evidence must stay honest.
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
          headers: { Referer: "https://example.com/" }, // Add CDN required headers here
          confidence: 0.9,
          cachePolicy,
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
      if (!selectedStream) {
        throw new Error("No selectable streams were mapped.");
      }

      // -------------------------------------------------------------
      // D. Return the Success Object
      // -------------------------------------------------------------
      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: TEMPLATE_PROVIDER_ID,
        message: `Successfully resolved stream`,
      });

      const endedAt = context.now();

      return {
        status: "resolved",
        providerId: TEMPLATE_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: [
          {
            id: sourceId,
            providerId: TEMPLATE_PROVIDER_ID,
            kind: "provider-api",
            label: "ExampleServer",
            host: "example.com",
            status: "selected",
            confidence: 0.9,
            requiresRuntime: "direct-http",
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
          providerId: TEMPLATE_PROVIDER_ID,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved via Template", {
              providerId: TEMPLATE_PROVIDER_ID,
              attributes: { streams: streams.length },
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
      // E. Catch Errors — keep the classification honest.
      //
      // Order matters:
      // 1. User cancellation is the caller's decision, not a failure.
      // 2. ProviderHttpError already carries the classified code +
      //    retryability from the fetch port — never flatten it to
      //    "network-error" or, worse, "not-found".
      // 3. Raw transport errors are "network-error"; when the message
      //    carries an offline signature (ENOTFOUND, EAI_AGAIN, …) mark
      //    them non-retryable so the engine's offline budget caps this
      //    provider early instead of burning attempts on a dead link.
      //    An offline machine must never read as an empty catalog.
      // -------------------------------------------------------------
      if (context.signal?.aborted || isAbortError(error)) {
        return createExhaustedResult(input, context, TEMPLATE_PROVIDER_ID, {
          code: "cancelled",
          message: "Resolution was cancelled by the user",
          retryable: false,
        });
      }

      const message = error instanceof Error ? error.message : "API failed";
      const failure: ProviderFailure =
        error instanceof ProviderHttpError
          ? {
              providerId: TEMPLATE_PROVIDER_ID,
              code: error.code,
              message: error.message,
              retryable: error.retryable,
              at: context.now(),
            }
          : {
              providerId: TEMPLATE_PROVIDER_ID,
              code: "network-error",
              message,
              retryable: !isOfflineNetworkFailure({ code: "network-error", message }),
              at: context.now(),
            };
      failures.push(failure);

      return createExhaustedResult(input, context, TEMPLATE_PROVIDER_ID, failure);
    }
  },
};

// =====================================================================
// 3. MULTI-CANDIDATE PROVIDERS — runProviderCycle
//
// When your provider has several servers/lanes, do not try them inline.
// `runProviderCycle` gives you per-candidate timeouts, transient-retry
// backoff, hedging, offline early-exit, and ordered failure records for
// free. The production shape (see miruro/direct.ts):
//
//   const cycleResult = await runProviderCycle({
//     providerId: TEMPLATE_PROVIDER_ID,
//     candidates: cycleCandidates,
//     signal: context.signal,
//     now: context.now,
//     emit: context.emit,
//     maxAttemptsPerCandidate: 1,
//     candidateTimeoutMs: providerCycleCandidateTimeoutMs(
//       input.startupPriority ?? "balanced",
//       TEMPLATE_CANDIDATE_TIMEOUT_MS,
//     ),
//     // If every candidate traverses ONE host, a host-wide failure repeats
//     // identically for all of them — mirror miruro's early exit:
//     shouldStopAfterFailure: (failure) => failure.failureClass === "candidate-blocked",
//     resolveCandidate: async (candidate) => {
//       // throw createProviderCycleFailureError(candidate, {
//       //   failureClass: "candidate-empty" | "candidate-network" | …,
//       //   message, retryable, at: context.now(),
//       // });
//     },
//   });
//
// Candidate failure classes map onto resolve codes through
// `providerFailureCodeFromCycleFailure` (shared/provider-cycle.ts) — use it
// for the exhausted result instead of inventing a second mapping.
// =====================================================================
