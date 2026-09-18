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
  ProviderRuntimeContext,
  ProviderSearchResult,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import {
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
  formatAnimeSourceLabel,
} from "../shared/anime-source-presentation";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { finalizeCycleSourceInventory } from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { inferSubtitleFormat, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import {
  fetchHianimeEpisodeCatalog,
  HIANIME_SUPPORTED_SERVER,
  resolveHianimeEpisodeStreams,
  resolveHianimeShow,
  searchHianime,
  type HianimeAudioMode,
  type HianimeStreamFailureCode,
  type HianimeStreamLink,
} from "./client";
import { HIANIME_PROVIDER_ID, hianimeManifest } from "./manifest";

export { HIANIME_PROVIDER_ID, HIANIME_SUPPORTED_SERVER };
export {
  deobfuscateHianimeEmbedBlob,
  obfuscateHianimeEmbedPayload,
  extractHianimeEmbedBlob,
  parseHianimeEmbedPayload,
  HIANIME_EMBED_XOR_KEY,
} from "./embed";
export {
  chooseHianimeSearchMatch,
  hianimeNumericId,
  looksLikeHianimeShowId,
  parseHianimeEpisodesHtml,
  parseHianimeSearchHtml,
  parseHianimeServersHtml,
} from "./parsers";
export {
  clearHianimeCachesForTest,
  fetchHianimeEpisodeCatalog,
  fetchHianimeServers,
  hianimeCurlFailureMessage,
  hianimeEmbedReferer,
  hianimeMalIdFromEmbedUrl,
  HianimeEmbedDecodeError,
  decodeHianimeEmbedPage,
  resolveHianimeEpisodeStreams,
  resolveHianimeShow,
  searchHianime,
  splitCurlHttpTrailer,
  type HianimeAudioMode,
  type HianimeEmbedPayload,
  type HianimeEpisodeEntry,
  type HianimeSearchResult,
  type HianimeServerEntry,
  type HianimeShow,
  type HianimeStreamFailureCode,
} from "./client";

function buildHianimeSourceInventory(
  availableModes: readonly HianimeAudioMode[],
  selectedMode: HianimeAudioMode,
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): readonly ProviderSourceCandidate[] {
  // One source row per playable audio mode so Tracks can offer sub/dub
  // switching. The resolved mode starts "probing" (finalize promotes it); the
  // other starts "available".
  const modes = availableModes.length > 0 ? availableModes : [selectedMode];
  return modes.map((audioMode) => {
    const sourceId = `source:${HIANIME_PROVIDER_ID}:${audioMode}`;
    const label = formatAnimeSourceLabel({
      audio: audioMode,
      serverLabel: HIANIME_SUPPORTED_SERVER,
      subtitleMode: "soft",
    });
    return {
      id: sourceId,
      providerId: HIANIME_PROVIDER_ID,
      kind: "provider-api" as const,
      label,
      host: "hianime.at",
      status: (audioMode === selectedMode
        ? "probing"
        : "available") as ProviderSourceCandidate["status"],
      confidence: 0.85,
      requiresRuntime: "direct-http" as const,
      cachePolicy,
      languageEvidence: [
        {
          role: "audio" as const,
          normalizedLanguage: audioMode === "dub" ? "en" : "ja",
          nativeLabel: audioMode,
          sourceId,
          confidence: 0.85,
        },
      ],
      sourceEvidence: [
        {
          sourceId,
          serverId: HIANIME_SUPPORTED_SERVER,
          nativeLabel: HIANIME_SUPPORTED_SERVER,
          host: "hianime.at",
          confidence: 0.85,
          metadata: { audioMode },
        },
      ],
    };
  });
}

function linksToCandidates(
  links: readonly HianimeStreamLink[],
  input: {
    readonly audioMode: HianimeAudioMode;
    readonly subtitleLanguages?: readonly string[];
    readonly hasExternalSubtitles: boolean;
    readonly timing?: Record<string, { readonly start: number; readonly end: number }>;
  },
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): { readonly streams: StreamCandidate[]; readonly variants: ProviderVariantCandidate[] } {
  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const sourceId = `source:${HIANIME_PROVIDER_ID}:${input.audioMode}`;
  const audioLanguages = input.audioMode === "dub" ? ["en"] : ["ja"];
  const flavorLabel = formatAnimeSourceLabel({
    audio: input.audioMode,
    serverLabel: HIANIME_SUPPORTED_SERVER,
    subtitleMode: input.hasExternalSubtitles ? "soft" : "unknown",
  });
  const sourceDetail = formatAnimeSourceDetail({
    audio: input.audioMode,
    subtitleMode: input.hasExternalSubtitles ? "soft" : "unknown",
  });
  const archetype = formatAnimeSourceArchetype({ audio: input.audioMode, detail: flavorLabel });

  for (const link of links) {
    const quality = animeQualityFields(link.quality);
    const streamId = `stream:${HIANIME_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
    const variantId = `variant:${HIANIME_PROVIDER_ID}:${sourceId}:${quality.qualityLabel}`;
    const origin = (() => {
      try {
        return new URL(link.referer).origin;
      } catch {
        return "https://zokoanime.video";
      }
    })();
    streams.push({
      id: streamId,
      providerId: HIANIME_PROVIDER_ID,
      sourceId,
      variantId,
      url: link.url,
      protocol: "hls",
      container: "m3u8",
      headers: {
        Referer: link.referer,
        Origin: origin,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      qualityLabel: quality.qualityLabel,
      qualityRank: quality.qualityRank,
      presentation: input.audioMode,
      audioLanguages,
      subtitleDelivery: input.hasExternalSubtitles ? "external" : undefined,
      subtitleLanguages: input.subtitleLanguages,
      flavorArchetype: archetype,
      flavorLabel,
      serverName: HIANIME_SUPPORTED_SERVER,
      confidence: 0.9,
      cachePolicy,
      languageEvidence: [
        {
          role: "audio",
          normalizedLanguage: input.audioMode === "dub" ? "en" : "ja",
          nativeLabel: input.audioMode,
          sourceId,
          confidence: 0.85,
        },
      ],
      sourceEvidence: [
        {
          sourceId,
          serverId: HIANIME_SUPPORTED_SERVER,
          nativeLabel: HIANIME_SUPPORTED_SERVER,
          host: "hianime.at",
          confidence: 0.85,
          metadata: { audioMode: input.audioMode },
        },
      ],
      metadata: {
        audioMode: input.audioMode,
        sourceDetail,
        ...input.timing,
      },
    });
    variants.push({
      id: variantId,
      providerId: HIANIME_PROVIDER_ID,
      sourceId,
      label: quality.qualityLabel,
      qualityLabel: quality.qualityLabel,
      qualityRank: quality.qualityRank,
      protocol: "hls",
      container: "m3u8",
      audioLanguages,
      presentation: input.audioMode,
      subtitleDelivery: input.hasExternalSubtitles ? "external" : undefined,
      subtitleLanguages: input.subtitleLanguages,
      flavorArchetype: archetype,
      flavorLabel,
      streamIds: [streamId],
      confidence: 0.9,
    });
  }

  return { streams, variants };
}

function toSubtitleCandidates(
  subtitles: HianimeModeResolutionSubtitles,
  sourceId: string,
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): SubtitleCandidate[] {
  return subtitles.flatMap((subtitle) => {
    if (!subtitle.src) return [];
    const language =
      normalizeIsoLanguageCode(subtitle.lang ?? subtitle.label) ??
      normalizeIsoLanguageCode("en") ??
      "en";
    return [
      {
        id: `subtitle:${HIANIME_PROVIDER_ID}:${Bun.hash(subtitle.src).toString(36)}`,
        providerId: HIANIME_PROVIDER_ID,
        sourceId,
        url: subtitle.src,
        language,
        label: subtitle.label ?? subtitle.lang ?? language,
        format: inferSubtitleFormat(subtitle.src),
        source: "provider" as const,
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" as const },
      },
    ];
  });
}

type HianimeModeResolutionSubtitles = readonly {
  readonly lang?: string;
  readonly label?: string;
  readonly isDefault?: boolean;
  readonly src: string;
}[];

async function resolveShowId(
  input: { readonly title: ProviderResolveInput["title"] },
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<string | null> {
  return (await resolveHianimeShow(input, signal, context))?.id ?? null;
}

/**
 * Allowlist: a failure code added later must opt into retries explicitly
 * instead of inheriting them. Gone routes (not-found) and undecodable
 * payloads (parse-failed) never heal; transport errors and WAF blocks might.
 */
function isRetryableHianimeStreamFailure(code: HianimeStreamFailureCode): boolean {
  return code === "blocked" || code === "network-error";
}

export const hianimeProviderModule: CoreProviderModule = {
  providerId: HIANIME_PROVIDER_ID,
  manifest: hianimeManifest,

  async search(input, context): Promise<readonly ProviderSearchResult[] | null> {
    let results: Awaited<ReturnType<typeof searchHianime>>;
    try {
      results = await searchHianime(input.query, context.signal, context);
    } catch {
      // Null is the contract's transport-failure channel (mirrors AllManga):
      // unreachable provider, not "no results".
      return null;
    }
    return results.slice(0, 40).map((result) => ({
      id: result.id,
      type: "series",
      title: result.title,
      metadataSource: "HiAnime",
      externalIds: {
        providerNativeIds: { [HIANIME_PROVIDER_ID]: result.id },
      },
    }));
  },

  async listEpisodes(input, context): Promise<readonly ProviderEpisodeOption[] | null> {
    const showId = await resolveShowId(input, context.signal, context);
    if (!showId) return null;
    let catalog: Awaited<ReturnType<typeof fetchHianimeEpisodeCatalog>>;
    try {
      catalog = await fetchHianimeEpisodeCatalog(showId, context.signal, context);
    } catch {
      return null;
    }
    if (catalog.length === 0) return [];
    return catalog.map(
      (entry): ProviderEpisodeOption => ({
        index: entry.number,
        label: formatAnimeEpisodeLabel(entry.number, entry.title),
        ...(entry.title ? { name: entry.title } : {}),
        detail: `Episode ${entry.number}`,
        totalEpisodeCount: catalog.length,
        providerEpisodeIdentity: { providerId: HIANIME_PROVIDER_ID, value: entry.episodeId },
      }),
    );
  },

  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, HIANIME_PROVIDER_ID, {
        code: "unsupported-title",
        message: "HiAnime only supports anime",
        retryable: false,
      });
    }
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, HIANIME_PROVIDER_ID, {
        code: "runtime-missing",
        message: "HiAnime resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];
    const cachePolicy = createProviderCachePolicy({
      providerId: HIANIME_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: HIANIME_PROVIDER_ID,
      message: `Started HiAnime resolve for ${input.title.title || input.title.id}`,
    });

    try {
      const show = await resolveHianimeShow(input, context.signal, context);
      if (!show) {
        return createExhaustedResult(
          input,
          context,
          HIANIME_PROVIDER_ID,
          {
            code: "unsupported-title",
            message: "HiAnime requires a validated provider-native show id or searchable title",
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      const catalog = await fetchHianimeEpisodeCatalog(show.id, context.signal, context);
      if (catalog.length === 0) {
        return createExhaustedResult(
          input,
          context,
          HIANIME_PROVIDER_ID,
          {
            code: "not-found",
            message: `No HiAnime episode catalog for ${show.id}`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      // An explicit HiAnime episode identity wins, but only while it still
      // belongs to the active catalog — otherwise fail closed instead of
      // playing the wrong episode at the same UI index.
      const explicitEpisodeId =
        input.episode?.providerEpisodeIdentity?.providerId === HIANIME_PROVIDER_ID
          ? input.episode.providerEpisodeIdentity.value
          : undefined;
      const episodeNumber = selectProviderEpisodeNumber(input.episode);
      const entry = explicitEpisodeId
        ? catalog.find((candidate) => candidate.episodeId === explicitEpisodeId)
        : catalog.find((candidate) => candidate.number === episodeNumber);
      if (!entry) {
        return createExhaustedResult(
          input,
          context,
          HIANIME_PROVIDER_ID,
          {
            code: "not-found",
            message: explicitEpisodeId
              ? `HiAnime episode identity ${explicitEpisodeId} is no longer in the catalog for ${show.id}`
              : `No HiAnime episode ${episodeNumber} for ${show.id}`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      const explicitSourceMode =
        input.preferredSourceId === `source:${HIANIME_PROVIDER_ID}:dub`
          ? "dub"
          : input.preferredSourceId === `source:${HIANIME_PROVIDER_ID}:sub`
            ? "sub"
            : undefined;
      const audioMode: HianimeAudioMode =
        explicitSourceMode ??
        resolveAnimeAudioIntent(
          input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
        ).catalogMode;

      const resolution = await resolveHianimeEpisodeStreams({
        context,
        episodeId: entry.episodeId,
        requestedMode: audioMode,
        signal: context.signal,
      });

      if (resolution.availableModes.length > 0) {
        emitTraceEvent(events, context, {
          type: "inventory:audio-modes",
          providerId: HIANIME_PROVIDER_ID,
          message: `HiAnime episode exposes ${resolution.availableModes.join(" and ")} audio modes`,
          attributes: { modes: resolution.availableModes.join(",") },
        });
      }

      const sourceId = `source:${HIANIME_PROVIDER_ID}:${audioMode}`;
      const requested = resolution.requested;
      if (requested.status !== "resolved") {
        const failure =
          requested.status === "failed"
            ? {
                code: requested.failure.code,
                message: requested.failure.message,
                retryable: isRetryableHianimeStreamFailure(requested.failure.code),
              }
            : {
                code: "not-found" as const,
                message:
                  `No HiAnime ${audioMode} server for ${show.id} episode ${entry.number}` +
                  (resolution.observedServers.length > 0
                    ? ` (observed: ${resolution.observedServers.join(", ")})`
                    : ""),
                retryable: false,
              };
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId: HIANIME_PROVIDER_ID,
          sourceId,
          message: `HiAnime ${audioMode} source unavailable`,
          attributes: { mode: audioMode },
        });
        return createExhaustedResult(input, context, HIANIME_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }

      emitTraceEvent(events, context, {
        type: "source:success",
        providerId: HIANIME_PROVIDER_ID,
        sourceId,
        message: `HiAnime ${audioMode} source resolved via ${HIANIME_SUPPORTED_SERVER}`,
        attributes: { mode: audioMode, server: HIANIME_SUPPORTED_SERVER },
      });
      if (requested.ladderFallback === true) {
        emitTraceEvent(events, context, {
          type: "ladder:fallback",
          providerId: HIANIME_PROVIDER_ID,
          sourceId,
          message: "HiAnime ladder expansion fell back to a single auto row",
          attributes: { mode: audioMode },
        });
      }
      if (requested.subtitles.length > 0) {
        emitTraceEvent(events, context, {
          type: "subtitle:discovered",
          providerId: HIANIME_PROVIDER_ID,
          sourceId,
          message: `HiAnime exposed ${requested.subtitles.length} subtitle track(s)`,
        });
      }

      const timing: Record<string, { readonly start: number; readonly end: number }> = {};
      if (requested.intro) timing.intro = requested.intro;
      if (requested.outro) timing.outro = requested.outro;

      const subtitleLanguages = [
        ...new Set(
          requested.subtitles
            .map((subtitle) => normalizeIsoLanguageCode(subtitle.lang ?? subtitle.label))
            .filter((language): language is string => Boolean(language)),
        ),
      ];
      const subtitles = toSubtitleCandidates(requested.subtitles, sourceId, cachePolicy);
      const { streams, variants } = linksToCandidates(
        requested.links,
        {
          audioMode,
          subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
          hasExternalSubtitles: subtitles.length > 0,
          ...(Object.keys(timing).length > 0 ? { timing } : {}),
        },
        cachePolicy,
      );
      const selection = selectReadyStream(streams, {
        startupPriority: input.startupPriority,
        qualityPreference: input.qualityPreference,
        // User value only: every stream here shares `sourceId`, so defaulting
        // would match streams[0] as `explicit` and bypass favorites, quality
        // preference, and startup ordering. The mode switch already resolved
        // above via explicitSourceMode, so nothing is lost.
        preferredSourceId: input.preferredSourceId,
        preferredStreamId: input.preferredStreamId,
        favoriteSourceNames: input.favoriteSourceNames,
      });
      // Selection reads provider order first; the handed-back inventory stays
      // quality-sorted for the Tracks picker.
      streams.sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));
      variants.sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));
      const sources = finalizeCycleSourceInventory({
        sources: buildHianimeSourceInventory(resolution.availableModes, audioMode, cachePolicy),
        attempts: [],
        streams,
        selectedStreamId: selection.selected.id,
      });
      const endedAt = context.now();

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: HIANIME_PROVIDER_ID,
        message: `Resolved ${streams.length} HiAnime stream(s)`,
        attributes: {
          sourceId: selection.selected.sourceId ?? sourceId,
          showId: show.id,
          episodeId: entry.episodeId,
          episodeNumber: entry.number,
          mode: audioMode,
        },
      });

      return {
        status: "resolved",
        providerId: HIANIME_PROVIDER_ID,
        selectedStreamId: selection.selected.id,
        selectionDecision: selection.decision,
        sources,
        streams,
        variants,
        subtitles,
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId: requested.malId,
          providerNativeIds: { [HIANIME_PROVIDER_ID]: show.id },
        },
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: HIANIME_PROVIDER_ID,
          streamId: selection.selected.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved HiAnime ZokoAnime embed", {
              providerId: HIANIME_PROVIDER_ID,
              attributes: { streams: streams.length, showId: show.id },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: HIANIME_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(
          input,
          context,
          HIANIME_PROVIDER_ID,
          {
            code: "cancelled",
            message: "HiAnime resolution was cancelled",
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      const gone = /hianime fetch HTTP (404|410)\b/.test(message);
      let code: ProviderFailure["code"] = "network-error";
      if (gone) code = "not-found";
      else if (/cloudflare|just a moment/i.test(message)) code = "blocked";
      const failure: ProviderFailure = {
        providerId: HIANIME_PROVIDER_ID,
        code,
        message,
        retryable: !gone,
        at: context.now(),
      };
      failures.push(failure);
      return createExhaustedResult(input, context, HIANIME_PROVIDER_ID, failure, {
        cachePolicy,
        events,
        failures,
        startedAt,
      });
    }
  },
};
