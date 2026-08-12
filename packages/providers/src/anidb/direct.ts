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
  ProviderSearchResult,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
} from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import {
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
} from "../shared/anime-source-presentation";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { finalizeCycleSourceInventory } from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import {
  ANIDB_REFERER,
  ANIDB_USER_AGENT,
  chooseAnidbSearchMatch,
  fetchAnidbEpisodes,
  fetchAnidbMalId,
  looksLikeAnidbShowId,
  resolveAnidbEpisodeStreams,
  searchAnidb,
  type AnidbStreamLink,
} from "./client";
import { anidbManifest, ANIDB_PROVIDER_ID } from "./manifest";

export { ANIDB_PROVIDER_ID };
export {
  anidbNumericId,
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  searchAnidb,
  type AnidbSearchResult,
  type AnidbSeasonEvidence,
} from "./client";

function resolveAnidbShowIdFromInput(input: {
  readonly title: {
    readonly id: string;
    readonly title?: string;
    readonly externalIds?: {
      readonly providerNativeIds?: Record<string, string | undefined>;
    };
  };
}): string | null {
  const native = input.title.externalIds?.providerNativeIds?.[ANIDB_PROVIDER_ID];
  if (looksLikeAnidbShowId(native)) return native;
  if (looksLikeAnidbShowId(input.title.id)) return input.title.id;
  return null;
}

async function resolveAnidbShowId(
  input: { readonly title: ProviderResolveInput["title"] },
  signal?: AbortSignal,
): Promise<string | null> {
  const direct = resolveAnidbShowIdFromInput(input);
  if (direct) return direct;

  const query = input.title.title?.trim() ?? "";
  if (!query) return null;
  return chooseAnidbSearchMatch(query, await searchAnidb(query, signal))?.id ?? null;
}

function buildStreamHeaders(referer: string): Record<string, string> {
  return {
    Referer: referer || ANIDB_REFERER,
    "User-Agent": ANIDB_USER_AGENT,
  };
}

function buildAnidbSourceInventory(
  audioMode: "sub" | "dub",
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): readonly ProviderSourceCandidate[] {
  const sourceId = `source:${ANIDB_PROVIDER_ID}:${audioMode}`;
  return [
    {
      id: sourceId,
      providerId: ANIDB_PROVIDER_ID,
      kind: "provider-api",
      label: audioMode === "dub" ? "AniDB Dub" : "AniDB Sub",
      host: "anidb.app",
      status: "probing",
      confidence: 0.85,
      requiresRuntime: "direct-http",
      cachePolicy,
      languageEvidence: [
        {
          role: "audio",
          normalizedLanguage: audioMode === "dub" ? "en" : "ja",
          nativeLabel: audioMode,
          sourceId,
          confidence: 0.85,
        },
      ],
      sourceEvidence: [
        {
          sourceId,
          serverId: audioMode,
          nativeLabel: audioMode === "dub" ? "English" : "Japanese",
          host: "anidb.app",
          confidence: 0.85,
        },
      ],
    },
  ];
}

function linksToCandidates(
  links: readonly AnidbStreamLink[],
  audioMode: "sub" | "dub",
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): {
  readonly streams: StreamCandidate[];
  readonly variants: ProviderVariantCandidate[];
  readonly sourceId: string;
} {
  const sourceId = `source:${ANIDB_PROVIDER_ID}:${audioMode}`;
  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const sourceDetail = formatAnimeSourceDetail({
    audio: audioMode,
    subtitleMode: audioMode === "sub" ? "hard" : "unknown",
  });
  const archetype = formatAnimeSourceArchetype({
    audio: audioMode,
    detail: audioMode === "dub" ? "Dub" : "Sub",
  });

  for (const link of links) {
    const quality = animeQualityFields(link.quality);
    const streamId = `stream:${ANIDB_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
    const variantId = `variant:${ANIDB_PROVIDER_ID}:${sourceId}:${link.quality}`;
    streams.push({
      id: streamId,
      providerId: ANIDB_PROVIDER_ID,
      sourceId,
      variantId,
      url: link.url,
      protocol: link.protocol,
      container: link.container,
      headers: buildStreamHeaders(link.referer),
      qualityLabel: quality.qualityLabel,
      qualityRank: quality.qualityRank,
      presentation: audioMode,
      audioLanguages: audioMode === "dub" ? ["en"] : ["ja"],
      hardSubLanguage: audioMode === "sub" ? "en" : undefined,
      subtitleDelivery: audioMode === "sub" ? "hardcoded" : undefined,
      flavorArchetype: archetype,
      flavorLabel: audioMode === "dub" ? "Dub" : "Sub",
      serverName: "anidb",
      confidence: 0.9,
      cachePolicy,
      metadata: {
        audioMode,
        sourceDetail,
      },
    });
    variants.push({
      id: variantId,
      providerId: ANIDB_PROVIDER_ID,
      sourceId,
      label: link.quality,
      qualityLabel: quality.qualityLabel,
      qualityRank: quality.qualityRank,
      protocol: link.protocol,
      container: link.container,
      presentation: audioMode,
      streamIds: [streamId],
      confidence: 0.9,
    });
  }

  return { streams, variants, sourceId };
}

export const anidbProviderModule: CoreProviderModule = {
  providerId: ANIDB_PROVIDER_ID,
  manifest: anidbManifest,

  async search(input, context) {
    const results = await searchAnidb(input.query, context.signal);
    const mapped: ProviderSearchResult[] = [];
    for (const result of results.slice(0, 40)) {
      mapped.push({
        id: result.id,
        type: "series",
        title: result.title,
        metadataSource: "AniDB",
        availableAudioModes: ["sub", "dub"],
        subtitleAvailability: "hardsub",
        externalIds: {
          providerNativeIds: { [ANIDB_PROVIDER_ID]: result.id },
        },
        languageEvidence: [
          {
            role: "audio",
            normalizedLanguage: "ja",
            nativeLabel: "sub",
            confidence: 0.8,
          },
        ],
      });
    }
    return mapped;
  },

  async listEpisodes(input, context) {
    const showId = await resolveAnidbShowId(input, context.signal);
    if (!showId) return null;
    const episodes = await fetchAnidbEpisodes(showId, context.signal);
    if (episodes.length === 0) return [];
    const malId = await fetchAnidbMalId(showId, context.signal);
    return episodes.map(
      (episode): ProviderEpisodeOption => ({
        index: episode.number,
        label: `Episode ${episode.number}`,
        detail: episode.filler ? "Filler" : undefined,
        totalEpisodeCount: episodes.length,
        externalIds: {
          malId: malId ? String(malId) : undefined,
        },
      }),
    );
  },

  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AniDB only supports anime",
        retryable: false,
      });
    }
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
        code: "runtime-missing",
        message: "AniDB resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const showId = await resolveAnidbShowId(input, context.signal);
    if (!showId) {
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AniDB requires a provider-native show id or searchable title",
        retryable: false,
      });
    }

    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];
    const cachePolicy = createProviderCachePolicy({
      providerId: ANIDB_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: ANIDB_PROVIDER_ID,
      message: `Started AniDB resolve for ${showId}`,
    });

    const audioMode = resolveAnimeAudioIntent(
      input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
    ).catalogMode;
    const episodeNumber = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;

    try {
      const links = await resolveAnidbEpisodeStreams({
        context,
        showId,
        episodeNumber,
        audioMode,
        signal: context.signal,
      });
      if (links.length === 0) {
        return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
          code: "not-found",
          message: `No AniDB streams for ${showId} episode ${episodeNumber} (${audioMode})`,
          retryable: true,
        });
      }

      const { streams, variants, sourceId } = linksToCandidates(links, audioMode, cachePolicy);
      const selection = selectReadyStream(streams, {
        startupPriority: input.startupPriority,
        qualityPreference: input.qualityPreference,
        preferredSourceId: input.preferredSourceId,
        preferredStreamId: input.preferredStreamId,
        favoriteSourceNames: input.favoriteSourceNames,
      });
      const sources = finalizeCycleSourceInventory({
        sources: buildAnidbSourceInventory(audioMode, cachePolicy),
        attempts: [],
        streams,
        selectedStreamId: selection.selected.id,
      });
      const endedAt = context.now();

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: ANIDB_PROVIDER_ID,
        message: `Resolved ${streams.length} AniDB stream(s)`,
        attributes: { sourceId, showId, episodeNumber: String(episodeNumber) },
      });

      return {
        status: "resolved",
        providerId: ANIDB_PROVIDER_ID,
        selectedStreamId: selection.selected.id,
        selectionDecision: selection.decision,
        sources,
        streams,
        variants,
        subtitles: [],
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId: input.title.externalIds?.malId ?? input.title.malId,
          providerNativeIds: { [ANIDB_PROVIDER_ID]: showId },
        },
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: ANIDB_PROVIDER_ID,
          streamId: selection.selected.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved AniDB HLS ladder", {
              providerId: ANIDB_PROVIDER_ID,
              attributes: { streams: streams.length, showId },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: ANIDB_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure: ProviderFailure = {
        providerId: ANIDB_PROVIDER_ID,
        code: /cloudflare/i.test(message) ? "blocked" : "network-error",
        message,
        retryable: true,
        at: context.now(),
      };
      failures.push(failure);
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, failure, {
        cachePolicy,
        events,
        failures,
        startedAt,
      });
    }
  },
};
