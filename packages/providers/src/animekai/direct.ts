import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  providerCycleCandidateTimeoutMs,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderSearchResult,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";
import { ProviderHttpError } from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import {
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
  formatAnimeSourceLabel,
} from "../shared/anime-source-presentation";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { resolveGateBudgetMs, selectVerifiedReadyStream } from "../shared/resolve-gate";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { finalizeCycleSourceInventory } from "../shared/source-inventory";
import { inferSubtitleFormat, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import {
  ANIMEKAI_USER_AGENT,
  fetchAnimekaiEpisodeCatalog,
  resolveAnimekaiEpisodeStreams,
  resolveAnimekaiShow,
  searchAnimekai,
  type AnimekaiAudioMode,
  type AnimekaiEpisodeEntry,
  type AnimekaiServerResolution,
  type AnimekaiStreamFailureCode,
  type AnimekaiStreamLink,
} from "./client";
import { ANIMEKAI_PROVIDER_ID, animekaiManifest } from "./manifest";

export { ANIMEKAI_PROVIDER_ID };
export { decryptAnimekaiSourcesBlob } from "./embed";
export {
  ANIMEKAI_BASE,
  ANIMEKAI_REFERER,
  ANIMEKAI_USER_AGENT,
  animekaiFilterResultsByQueryWords,
  animekaiLongestWordFallback,
  animekaiMalIdFromEmbedUrl,
  animekaiSourcesEndpoint,
  AnimekaiEmbedDecodeError,
  clearAnimekaiCachesForTest,
  chooseAnimekaiSearchMatch,
  fetchAnimekaiEpisodeCatalog,
  fetchAnimekaiServers,
  looksLikeAnimekaiShowId,
  parseAnimekaiEmbedDataId,
  parseAnimekaiEpisodesHtml,
  parseAnimekaiSearchHtml,
  parseAnimekaiServersJson,
  parseAnimekaiSourcesJson,
  resolveAnimekaiEpisodeStreams,
  resolveAnimekaiShow,
  searchAnimekai,
  splitAnimekaiCurlTrailer,
  type AnimekaiAudioMode,
  type AnimekaiEpisodeEntry,
  type AnimekaiResolvedLane,
  type AnimekaiSearchResult,
  type AnimekaiServerEntry,
  type AnimekaiServerResolution,
  type AnimekaiShow,
  type AnimekaiStreamLink,
} from "./client";
export type { AnimekaiSourcesPayload } from "./embed";

function sourceIdFor(mode: AnimekaiAudioMode, serverIndex: number): string {
  return `source:${ANIMEKAI_PROVIDER_ID}:${mode}:${serverIndex}`;
}

/** `source:animekai:<mode>` (any lane) or `source:animekai:<mode>:<n>` (pinned lane). */
function parseExplicitSource(
  preferredSourceId: string | undefined,
): { mode: AnimekaiAudioMode; serverIndex?: number } | undefined {
  const match = /^source:animekai:(sub|dub)(?::(\d+))?$/.exec(preferredSourceId ?? "");
  if (!match) return undefined;
  const mode = match[1] as AnimekaiAudioMode;
  const serverIndex = match[2] !== undefined ? Number.parseInt(match[2], 10) : undefined;
  return { mode, ...(serverIndex !== undefined && { serverIndex }) };
}

function buildAnimekaiSourceInventory(
  resolution: {
    readonly availableModes: readonly AnimekaiAudioMode[];
    readonly laneCounts: Readonly<Record<AnimekaiAudioMode, number>>;
  },
  resolvedSourceId: string,
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): readonly ProviderSourceCandidate[] {
  // One row per mode+server lane so Tracks offers audio-mode and server
  // switching; the resolved lane starts probing, the rest available.
  const sources: ProviderSourceCandidate[] = [];
  for (const mode of resolution.availableModes) {
    const lanes = resolution.laneCounts[mode] || 1;
    for (let index = 0; index < lanes; index++) {
      const sourceId = sourceIdFor(mode, index);
      const serverLabel = `Server ${index + 1}`;
      sources.push({
        id: sourceId,
        providerId: ANIMEKAI_PROVIDER_ID,
        kind: "provider-api" as const,
        label: formatAnimeSourceLabel({
          audio: mode,
          serverLabel,
          subtitleMode: "soft",
        }),
        host: "animekai.be",
        status: sourceId === resolvedSourceId ? "probing" : "available",
        confidence: 0.85,
        requiresRuntime: "direct-http" as const,
        cachePolicy,
        languageEvidence: [
          {
            role: "audio" as const,
            normalizedLanguage: mode === "dub" ? "en" : "ja",
            nativeLabel: mode,
            sourceId,
            confidence: 0.85,
          },
        ],
        sourceEvidence: [
          {
            sourceId,
            serverId: serverLabel,
            nativeLabel: serverLabel,
            host: "animekai.be",
            confidence: 0.85,
            metadata: { audioMode: mode, serverIndex: index },
          },
        ],
      });
    }
  }
  return sources;
}

type AnimekaiCandidateSet = {
  readonly streams: StreamCandidate[];
  readonly variants: ProviderVariantCandidate[];
};

function linksToCandidates(
  links: readonly AnimekaiStreamLink[],
  input: {
    readonly audioMode: AnimekaiAudioMode;
    readonly serverIndex: number;
    readonly serverName: string;
    readonly subtitleLanguages?: readonly string[];
    readonly hasExternalSubtitles: boolean;
    readonly timing?: Record<string, { readonly start: number; readonly end: number }>;
  },
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): AnimekaiCandidateSet {
  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const sourceId = sourceIdFor(input.audioMode, input.serverIndex);
  const audioLanguages = input.audioMode === "dub" ? ["en"] : ["ja"];
  const flavorLabel = formatAnimeSourceLabel({
    audio: input.audioMode,
    serverLabel: input.serverName,
    subtitleMode: input.hasExternalSubtitles ? "soft" : "unknown",
  });
  const sourceDetail = formatAnimeSourceDetail({
    audio: input.audioMode,
    subtitleMode: input.hasExternalSubtitles ? "soft" : "unknown",
  });
  const archetype = formatAnimeSourceArchetype({ audio: input.audioMode, detail: flavorLabel });

  for (const link of links) {
    const quality = animeQualityFields(link.quality);
    const streamId = `stream:${ANIMEKAI_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
    const variantId = `variant:${ANIMEKAI_PROVIDER_ID}:${sourceId}:${quality.qualityLabel}`;
    const origin = (() => {
      try {
        return new URL(link.referer).origin;
      } catch {
        return "https://megaplay.buzz";
      }
    })();
    streams.push({
      id: streamId,
      providerId: ANIMEKAI_PROVIDER_ID,
      sourceId,
      variantId,
      url: link.url,
      protocol: "hls",
      container: "m3u8",
      headers: {
        Referer: link.referer,
        Origin: origin,
        "User-Agent": ANIMEKAI_USER_AGENT,
      },
      qualityLabel: quality.qualityLabel,
      qualityRank: quality.qualityRank,
      presentation: input.audioMode,
      audioLanguages,
      subtitleDelivery: input.hasExternalSubtitles ? "external" : undefined,
      subtitleLanguages: input.subtitleLanguages,
      flavorArchetype: archetype,
      flavorLabel,
      serverName: input.serverName,
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
          serverId: input.serverName,
          nativeLabel: input.serverName,
          host: "animekai.be",
          confidence: 0.85,
          metadata: { audioMode: input.audioMode, serverIndex: input.serverIndex },
        },
      ],
      metadata: {
        audioMode: input.audioMode,
        sourceDetail,
        // Every AnimeKai lane resolves through MegaPlay-family CDNs that
        // rate-limit burst segment pulls — ask mpv for the capped-readahead
        // demuxer profile (see StreamInfo.demuxerProfile).
        demuxerProfile: "capped-readahead",
        ...input.timing,
      },
    });
    variants.push({
      id: variantId,
      providerId: ANIMEKAI_PROVIDER_ID,
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
  subtitles: readonly {
    readonly file: string;
    readonly label?: string;
    readonly isDefault?: boolean;
  }[],
  sourceId: string,
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): SubtitleCandidate[] {
  return subtitles.flatMap((subtitle) => {
    if (!subtitle.file) return [];
    const language = normalizeIsoLanguageCode(subtitle.label) ?? "en";
    return [
      {
        id: `subtitle:${ANIMEKAI_PROVIDER_ID}:${Bun.hash(subtitle.file).toString(36)}`,
        providerId: ANIMEKAI_PROVIDER_ID,
        sourceId,
        url: subtitle.file,
        language,
        label: subtitle.label ?? language,
        format: inferSubtitleFormat(subtitle.file),
        source: "provider" as const,
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" as const },
      },
    ];
  });
}

function isRetryableAnimekaiFailure(code: AnimekaiStreamFailureCode): boolean {
  return (
    code === "blocked" ||
    code === "network-error" ||
    code === "provider-unavailable" ||
    code === "timeout"
  );
}

export const animekaiProviderModule: CoreProviderModule = {
  providerId: ANIMEKAI_PROVIDER_ID,
  manifest: animekaiManifest,

  async search(input, context): Promise<readonly ProviderSearchResult[] | null> {
    let results: Awaited<ReturnType<typeof searchAnimekai>>;
    try {
      results = await searchAnimekai(input.query, context.signal, context);
    } catch {
      // Null is the contract's transport-failure channel (mirrors HiAnime):
      // unreachable provider, not "no results".
      return null;
    }
    return results.slice(0, 40).map((result) => ({
      id: result.id,
      type: "series",
      title: result.title,
      metadataSource: "AnimeKai",
      externalIds: {
        providerNativeIds: { [ANIMEKAI_PROVIDER_ID]: result.id },
      },
    }));
  },

  async listEpisodes(input, context): Promise<readonly ProviderEpisodeOption[] | null> {
    const show = await resolveAnimekaiShow(input, context.signal, context);
    if (!show) return null;
    let catalog: readonly AnimekaiEpisodeEntry[];
    try {
      catalog = await fetchAnimekaiEpisodeCatalog(show.id, context.signal, context);
    } catch {
      return null;
    }
    if (catalog.length === 0) return [];
    return catalog.map(
      (entry): ProviderEpisodeOption => ({
        index: entry.number,
        label: formatAnimeEpisodeLabel(entry.number, entry.title),
        ...(entry.title && { name: entry.title }),
        detail: `Episode ${entry.number}`,
        totalEpisodeCount: catalog.length,
        providerEpisodeIdentity: {
          providerId: ANIMEKAI_PROVIDER_ID,
          value: String(entry.number),
        },
      }),
    );
  },

  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, ANIMEKAI_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AnimeKai only supports anime",
        retryable: false,
      });
    }
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, ANIMEKAI_PROVIDER_ID, {
        code: "runtime-missing",
        message: "AnimeKai resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];
    const cachePolicy = createProviderCachePolicy({
      providerId: ANIMEKAI_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: ANIMEKAI_PROVIDER_ID,
      message: `Started AnimeKai resolve for ${input.title.title || input.title.id}`,
    });

    try {
      const show = await resolveAnimekaiShow(input, context.signal, context);
      if (!show) {
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "unsupported-title",
            message: "AnimeKai requires a validated provider-native show id or searchable title",
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      const catalog = await fetchAnimekaiEpisodeCatalog(show.id, context.signal, context);
      const episodeNumber = selectProviderEpisodeNumber(input.episode);
      const explicitEpisodeNumber =
        input.episode?.providerEpisodeIdentity?.providerId === ANIMEKAI_PROVIDER_ID
          ? Number(input.episode.providerEpisodeIdentity.value)
          : undefined;
      const entry = explicitEpisodeNumber
        ? catalog.find((candidate) => candidate.number === explicitEpisodeNumber)
        : catalog.find((candidate) => candidate.number === episodeNumber);
      if (!entry) {
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "not-found",
            message: explicitEpisodeNumber
              ? `AnimeKai episode identity ${explicitEpisodeNumber} is no longer in the catalog for ${show.id}`
              : `No AnimeKai episode ${episodeNumber} for ${show.id}`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      const explicitSource = parseExplicitSource(input.preferredSourceId);
      const audioMode: AnimekaiAudioMode =
        explicitSource?.mode ??
        resolveAnimeAudioIntent(
          input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
        ).catalogMode;

      // Fail closed on the watch page's own availability flags before burning
      // an embed round trip on a mode the episode never had.
      if (audioMode === "dub" && !entry.dub && entry.sub) {
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "not-found",
            message: `AnimeKai episode ${entry.number} of ${show.id} has no dub track (data-dub=0)`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }
      if (audioMode === "sub" && !entry.sub && entry.dub) {
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "not-found",
            message: `AnimeKai episode ${entry.number} of ${show.id} has no sub track (data-sub=0)`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      const resolution = await resolveAnimekaiEpisodeStreams({
        context,
        showId: show.id,
        episode: entry.number,
        requestedMode: audioMode,
        entry,
        ...(explicitSource?.serverIndex !== undefined && {
          onlyServerIndex: explicitSource.serverIndex,
        }),
      });

      if (resolution.availableModes.length > 0) {
        emitTraceEvent(events, context, {
          type: "inventory:audio-modes",
          providerId: ANIMEKAI_PROVIDER_ID,
          message: `AnimeKai episode exposes ${resolution.availableModes.join(" and ")} audio modes`,
          attributes: { modes: resolution.availableModes.join(",") },
        });
      }

      const resolved = resolution.requested.servers.find(
        (server): server is Extract<AnimekaiServerResolution, { status: "resolved" }> =>
          server.status === "resolved",
      );

      if (resolution.requested.status !== "resolved" || !resolved) {
        const failure =
          resolution.requested.status === "failed" && resolution.requested.failure
            ? {
                code: resolution.requested.failure.code,
                message: resolution.requested.failure.message,
                retryable: isRetryableAnimekaiFailure(resolution.requested.failure.code),
              }
            : {
                code: "not-found" as const,
                message:
                  `No AnimeKai ${audioMode} server for ${show.id} episode ${entry.number}` +
                  (resolution.observedServers.length > 0
                    ? ` (observed: ${resolution.observedServers.join(", ")})`
                    : ""),
                retryable: false,
              };
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId: ANIMEKAI_PROVIDER_ID,
          message: `AnimeKai ${audioMode} source unavailable`,
          attributes: { mode: audioMode },
        });
        return createExhaustedResult(input, context, ANIMEKAI_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }

      const sourceId = sourceIdFor(audioMode, resolved.serverIndex);
      emitTraceEvent(events, context, {
        type: "source:success",
        providerId: ANIMEKAI_PROVIDER_ID,
        sourceId,
        message: `AnimeKai ${audioMode} source resolved via ${resolved.serverName}`,
        attributes: { mode: audioMode, server: resolved.serverName },
      });
      if (resolved.ladderFallback === true) {
        emitTraceEvent(events, context, {
          type: "ladder:fallback",
          providerId: ANIMEKAI_PROVIDER_ID,
          sourceId,
          message: "AnimeKai ladder expansion fell back to a single auto row",
          attributes: { mode: audioMode },
        });
      }
      if (resolved.subtitles.length > 0) {
        emitTraceEvent(events, context, {
          type: "subtitle:discovered",
          providerId: ANIMEKAI_PROVIDER_ID,
          sourceId,
          message: `AnimeKai exposed ${resolved.subtitles.length} subtitle track(s)`,
        });
      }

      const timing: Record<string, { readonly start: number; readonly end: number }> = {};
      if (resolved.intro) timing.intro = resolved.intro;
      if (resolved.outro) timing.outro = resolved.outro;

      const subtitleLanguages = [
        ...new Set(
          resolved.subtitles
            .map((subtitle) => normalizeIsoLanguageCode(subtitle.label))
            .filter((language): language is string => Boolean(language)),
        ),
      ];
      const subtitles = toSubtitleCandidates(resolved.subtitles, sourceId, cachePolicy);
      const { streams, variants } = linksToCandidates(
        resolved.links,
        {
          audioMode,
          serverIndex: resolved.serverIndex,
          serverName: resolved.serverName,
          subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
          hasExternalSubtitles: subtitles.length > 0,
          ...(Object.keys(timing).length > 0 && { timing }),
        },
        cachePolicy,
      );
      // Resolve-gate the picked variant before reporting success: the ladder
      // fetch proves the master, but the shipped stream is a variant URL that
      // was never fetched. The walk keeps user preference order and drops
      // only the rungs the gate refused.
      const selection = await selectVerifiedReadyStream({
        streams,
        input: {
          startupPriority: input.startupPriority,
          qualityPreference: input.qualityPreference,
          // User value only: every stream here shares `sourceId`; the mode and
          // server switch already resolved via explicitSource.
          preferredSourceId: input.preferredSourceId,
          preferredStreamId: input.preferredStreamId,
          favoriteSourceNames: input.favoriteSourceNames,
        },
        context,
        timeoutMs: resolveGateBudgetMs(
          providerCycleCandidateTimeoutMs(input.startupPriority ?? "balanced"),
        ),
        // One server lane, several quality rungs on the same CDN: cap the
        // walk so serial refusals cannot spend the rest of the attempt
        // budget the embed chain already drew from.
        walkBudgetMs: 7_000,
      });
      if (!selection.accepted) {
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId: ANIMEKAI_PROVIDER_ID,
          sourceId,
          message: "AnimeKai stream gate refused every rung",
          attributes: { mode: audioMode, reason: selection.reason },
        });
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "blocked",
            message: `AnimeKai ${resolved.serverName} streams refused by resolve gate: ${selection.reason}`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }
      const gatedStreams = selection.streams;
      gatedStreams.sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));
      const gatedVariants = variants
        .filter((variant) => gatedStreams.some((stream) => stream.variantId === variant.id))
        .sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));

      const sources = finalizeCycleSourceInventory({
        sources: buildAnimekaiSourceInventory(
          {
            availableModes: resolution.availableModes,
            laneCounts: resolution.laneCounts,
          },
          sourceId,
          cachePolicy,
        ),
        attempts: [],
        streams: gatedStreams,
        selectedStreamId: selection.selected.id,
      });
      const endedAt = context.now();

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: ANIMEKAI_PROVIDER_ID,
        message: `Resolved ${gatedStreams.length} AnimeKai stream(s)`,
        attributes: {
          sourceId: selection.selected.sourceId ?? sourceId,
          showId: show.id,
          episodeNumber: entry.number,
          mode: audioMode,
          server: resolved.serverName,
        },
      });

      return {
        status: "resolved",
        providerId: ANIMEKAI_PROVIDER_ID,
        selectedStreamId: selection.selected.id,
        selectionDecision: selection.decision,
        sources,
        streams: gatedStreams,
        variants: gatedVariants,
        subtitles,
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId: resolved.malId,
          providerNativeIds: { [ANIMEKAI_PROVIDER_ID]: show.id },
        },
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: ANIMEKAI_PROVIDER_ID,
          streamId: selection.selected.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved AnimeKai embed", {
              providerId: ANIMEKAI_PROVIDER_ID,
              attributes: {
                streams: gatedStreams.length,
                showId: show.id,
                server: resolved.serverName,
              },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: ANIMEKAI_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(
          input,
          context,
          ANIMEKAI_PROVIDER_ID,
          {
            code: "cancelled",
            message: "AnimeKai resolution was cancelled",
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      const gone = /animekai fetch HTTP (404|410)\b/.test(message);
      const structured = error instanceof ProviderHttpError ? error : undefined;
      let code: ProviderFailure["code"] = structured && !gone ? structured.code : "network-error";
      if (gone) code = "not-found";
      else if (/cloudflare|just a moment/i.test(message)) code = "blocked";
      const failure: ProviderFailure = {
        providerId: ANIMEKAI_PROVIDER_ID,
        code,
        message,
        retryable: gone ? false : (structured?.retryable ?? true),
        at: context.now(),
      };
      failures.push(failure);
      return createExhaustedResult(input, context, ANIMEKAI_PROVIDER_ID, failure, {
        cachePolicy,
        events,
        failures,
        startedAt,
      });
    }
  },
};
