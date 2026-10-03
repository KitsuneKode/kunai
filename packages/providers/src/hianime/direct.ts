import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  providerCycleCandidateTimeoutMs,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderArtworkInfo,
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderResolveInput,
  ProviderRuntimeContext,
  ProviderSearchResult,
  ProviderSelectionDecision,
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
  fetchHianimeEpisodeCatalog,
  resolveHianimeEpisodeStreams,
  resolveHianimeShow,
  searchHianime,
  type HianimeAudioMode,
  type HianimeServerKind,
  type HianimeServerResolution,
  type HianimeStreamFailure,
  type HianimeStreamFailureCode,
  type HianimeStreamLink,
} from "./client";
import {
  HIANIME_MEGAPLAY_SERVERS,
  HIANIME_PROVIDER_ID,
  HIANIME_SUPPORTED_SERVER,
  hianimeManifest,
} from "./manifest";

export { HIANIME_PROVIDER_ID, HIANIME_SUPPORTED_SERVER, HIANIME_MEGAPLAY_SERVERS };
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
  cloudflareBlockMessage,
  fetchHianimeEpisodeCatalog,
  fetchHianimeServers,
  hianimeFetchText,
  hianimeCurlFailureMessage,
  hianimeUrlLabel,
  hianimeEmbedReferer,
  hianimeMalIdFromEmbedUrl,
  hianimeServerKind,
  HianimeEmbedDecodeError,
  decodeHianimeEmbedPage,
  resolveHianimeEpisodeStreams,
  resolveHianimeShow,
  searchHianime,
  setHianimeCurlEnvironmentForTests,
  splitCurlHttpTrailer,
  type HianimeAudioMode,
  type HianimeEmbedPayload,
  type HianimeEpisodeEntry,
  type HianimeResolvedLane,
  type HianimeSearchResult,
  type HianimeServerEntry,
  type HianimeServerKind,
  type HianimeServerResolution,
  type HianimeShow,
  type HianimeStreamFailureCode,
} from "./client";

function sourceIdFor(mode: HianimeAudioMode, serverIndex: number): string {
  return `source:${HIANIME_PROVIDER_ID}:${mode}:${serverIndex}`;
}

/**
 * `source:hianime:<mode>` (any lane — legacy pin shape kept parseable) or
 * `source:hianime:<mode>:<n>` (pinned lane).
 */
function parseExplicitSource(
  preferredSourceId: string | undefined,
): { mode: HianimeAudioMode; serverIndex?: number } | undefined {
  const match = /^source:hianime:(sub|dub)(?::(\d+))?$/.exec(preferredSourceId ?? "");
  if (!match) return undefined;
  // SAFETY: the regex alternative is literally (sub|dub) — both HianimeAudioMode members.
  const mode = match[1] as HianimeAudioMode;
  const serverIndex = match[2] !== undefined ? Number.parseInt(match[2], 10) : undefined;
  return { mode, ...(serverIndex !== undefined && { serverIndex }) };
}

function buildHianimeSourceInventory(
  resolution: {
    readonly availableModes: readonly HianimeAudioMode[];
    readonly laneNames: Readonly<Record<HianimeAudioMode, readonly string[]>>;
  },
  selectedMode: HianimeAudioMode,
  resolvedSourceId: string | undefined,
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): readonly ProviderSourceCandidate[] {
  // One source row per mode+server lane so Tracks can offer both sub/dub and
  // in-provider server switching. The resolved lane starts "probing"
  // (finalize promotes it); the rest start "available".
  const modes = resolution.availableModes.length > 0 ? resolution.availableModes : [selectedMode];
  const sources: ProviderSourceCandidate[] = [];
  for (const audioMode of modes) {
    // A mode in availableModes has at least one lane by construction — no
    // phantom fallback row.
    const names = resolution.laneNames[audioMode] ?? [];
    names.forEach((serverName, index) => {
      const sourceId = sourceIdFor(audioMode, index);
      sources.push({
        id: sourceId,
        providerId: HIANIME_PROVIDER_ID,
        kind: "provider-api" as const,
        label: formatAnimeSourceLabel({
          audio: audioMode,
          serverLabel: serverName,
          subtitleMode: "soft",
        }),
        host: "hianime.at",
        status: sourceId === resolvedSourceId ? "probing" : "available",
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
            serverId: serverName,
            nativeLabel: serverName,
            host: "hianime.at",
            confidence: 0.85,
            metadata: { audioMode, serverIndex: index },
          },
        ],
      });
    });
  }
  return sources;
}

type HianimeCandidateSet = {
  readonly streams: StreamCandidate[];
  readonly variants: ProviderVariantCandidate[];
};

function linksToCandidates(
  links: readonly HianimeStreamLink[],
  input: {
    readonly audioMode: HianimeAudioMode;
    readonly serverIndex: number;
    readonly serverName: string;
    readonly serverKind: HianimeServerKind;
    readonly subtitleLanguages?: readonly string[];
    readonly hasExternalSubtitles: boolean;
    readonly timing?: Record<string, { readonly start: number; readonly end: number }>;
    /** Episode poster and scrub-preview sprite from the embed payload. */
    readonly artwork?: ProviderArtworkInfo;
  },
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): HianimeCandidateSet {
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
    const streamId = `stream:${HIANIME_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
    const variantId = `variant:${HIANIME_PROVIDER_ID}:${sourceId}:${quality.qualityLabel}`;
    const origin = (() => {
      try {
        return new URL(link.referer).origin;
      } catch {
        return "https://megaplay.buzz";
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
      serverName: input.serverName,
      ...(input.artwork && { artwork: input.artwork }),
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
          host: "hianime.at",
          confidence: 0.85,
          metadata: { audioMode: input.audioMode, serverIndex: input.serverIndex },
        },
      ],
      metadata: {
        audioMode: input.audioMode,
        serverName: input.serverName,
        serverIndex: input.serverIndex,
        sourceDetail,
        // MegaPlay-family CDNs rate-limit burst segment pulls; ask mpv for the
        // capped-readahead demuxer profile (see StreamInfo.demuxerProfile).
        ...(input.serverKind === "megaplay" && { demuxerProfile: "capped-readahead" }),
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
      ...(input.artwork && { artwork: input.artwork }),
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
 * payloads (parse-failed) never heal; transport errors, WAF blocks, and
 * upstream 5xx maintenance windows might.
 */
function isRetryableHianimeStreamFailure(code: HianimeStreamFailureCode): boolean {
  return (
    code === "blocked" ||
    code === "network-error" ||
    code === "provider-unavailable" ||
    code === "timeout"
  );
}

/**
 * Gate refusal → lane failure. The probe reasons carry their evidence — an
 * `HTTP <status>` embeds the upstream's own answer, `blocked stream target`
 * is the SSRF guard, and a malformed playlist is a parse verdict — so the
 * code follows the reason instead of collapsing everything to `blocked`.
 */
function gateRefusalFailure(reason: string, serverName: string): HianimeStreamFailure {
  const message = `HiAnime stream gate refused every rung on ${serverName}: ${reason}`;
  const httpStatus = /HTTP (\d{3})/.exec(reason)?.[1];
  if (httpStatus !== undefined) {
    const status = Number(httpStatus);
    if (status === 401 || status === 403 || status === 429) return { code: "blocked", message };
    if (status === 404 || status === 410) return { code: "not-found", message };
    if (status === 408 || status === 504) return { code: "timeout", message };
    if (status >= 500) return { code: "provider-unavailable", message };
    return { code: "network-error", message };
  }
  if (/timed?\s*out/i.test(reason)) return { code: "timeout", message };
  if (/blocked/i.test(reason)) return { code: "blocked", message };
  if (/no variant|no segment|text\/html|malformed/i.test(reason)) {
    return { code: "parse-failed", message };
  }
  return { code: "network-error", message };
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
        ...(entry.title && { name: entry.title }),
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

      const explicitSource = parseExplicitSource(input.preferredSourceId);
      const audioMode: HianimeAudioMode =
        explicitSource?.mode ??
        resolveAnimeAudioIntent(
          input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
        ).catalogMode;

      // The resolve gate runs inside the lane walk: a resolved lane whose
      // rungs all fail the probe counts as a failed lane and the walk moves
      // on to the next server — otherwise a dead ZokoAnime takes the whole
      // episode down while HD-1 or Vidstream-2 still play.
      let gated:
        | {
            readonly selected: StreamCandidate;
            readonly decision: ProviderSelectionDecision;
            readonly streams: StreamCandidate[];
            readonly variants: readonly ProviderVariantCandidate[];
            readonly subtitles: readonly SubtitleCandidate[];
          }
        | undefined;

      const resolution = await resolveHianimeEpisodeStreams({
        context,
        episodeId: entry.episodeId,
        requestedMode: audioMode,
        ...(explicitSource?.serverIndex !== undefined && {
          onlyServerIndex: explicitSource.serverIndex,
        }),
        signal: context.signal,
        verifyLane: async (lane) => {
          const laneSourceId = sourceIdFor(audioMode, lane.serverIndex);
          const laneTiming: Record<string, { readonly start: number; readonly end: number }> = {};
          if (lane.intro) laneTiming.intro = lane.intro;
          if (lane.outro) laneTiming.outro = lane.outro;
          const laneSubtitleLanguages = [
            ...new Set(
              lane.subtitles
                .map((subtitle) => normalizeIsoLanguageCode(subtitle.lang ?? subtitle.label))
                .filter((language): language is string => Boolean(language)),
            ),
          ];
          const laneSubtitles = toSubtitleCandidates(lane.subtitles, laneSourceId, cachePolicy);
          const laneArtwork: ProviderArtworkInfo | undefined =
            lane.poster || lane.spriteVtt
              ? {
                  ...(lane.poster && { posterUrl: lane.poster, thumbnailUrl: lane.poster }),
                  ...(lane.spriteVtt && { seekBarVttUrl: lane.spriteVtt }),
                }
              : undefined;
          const { streams: laneStreams, variants: laneVariants } = linksToCandidates(
            lane.links,
            {
              audioMode,
              serverIndex: lane.serverIndex,
              serverName: lane.serverName,
              serverKind: lane.serverKind,
              subtitleLanguages:
                laneSubtitleLanguages.length > 0 ? laneSubtitleLanguages : undefined,
              hasExternalSubtitles: laneSubtitles.length > 0,
              ...(Object.keys(laneTiming).length > 0 && { timing: laneTiming }),
              ...(laneArtwork && { artwork: laneArtwork }),
            },
            cachePolicy,
          );
          const laneSelection = await selectVerifiedReadyStream({
            streams: laneStreams,
            input: {
              startupPriority: input.startupPriority,
              qualityPreference: input.qualityPreference,
              // User value only: every stream here shares `sourceId`, so
              // defaulting would match streams[0] as `explicit` and bypass
              // favorites, quality preference, and startup ordering. The mode
              // switch already resolved above via explicitSourceMode, so
              // nothing is lost.
              preferredSourceId: input.preferredSourceId,
              preferredStreamId: input.preferredStreamId,
              favoriteSourceNames: input.favoriteSourceNames,
            },
            context,
            timeoutMs: resolveGateBudgetMs(
              providerCycleCandidateTimeoutMs(input.startupPriority ?? "balanced"),
            ),
            // One server, several quality rungs on the same CDN: cap the walk
            // so serial refusals cannot spend the rest of the attempt budget
            // the ladder fetch already drew from.
            walkBudgetMs: 7_000,
          });
          if (!laneSelection.accepted) {
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId: HIANIME_PROVIDER_ID,
              sourceId: laneSourceId,
              message: `HiAnime stream gate refused every rung`,
              attributes: { mode: audioMode, reason: laneSelection.reason },
            });
            return gateRefusalFailure(laneSelection.reason, lane.serverName);
          }
          emitTraceEvent(events, context, {
            type: "source:success",
            providerId: HIANIME_PROVIDER_ID,
            sourceId: laneSourceId,
            message: `HiAnime ${audioMode} source resolved via ${lane.serverName}`,
            attributes: { mode: audioMode, server: lane.serverName },
          });
          if (lane.ladderFallback === true) {
            emitTraceEvent(events, context, {
              type: "ladder:fallback",
              providerId: HIANIME_PROVIDER_ID,
              sourceId: laneSourceId,
              message: `HiAnime ladder expansion fell back to a single auto row`,
              attributes: { mode: audioMode },
            });
          }
          if (laneSubtitles.length > 0) {
            emitTraceEvent(events, context, {
              type: "subtitle:discovered",
              providerId: HIANIME_PROVIDER_ID,
              sourceId: laneSourceId,
              message: `HiAnime exposed ${laneSubtitles.length} subtitle track(s)`,
            });
          }
          gated = {
            selected: laneSelection.selected,
            decision: laneSelection.decision,
            streams: laneSelection.streams,
            variants: laneVariants.filter((variant) =>
              laneSelection.streams.some((stream) => stream.variantId === variant.id),
            ),
            subtitles: laneSubtitles,
          };
          return undefined;
        },
      });

      // The stream probe reports a caller abort as a non-definitive timeout —
      // which the gate accepts — so an abort that lands inside the last lane
      // check would otherwise ship a resolved result after the caller hung up.
      if (context.signal?.aborted === true) {
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

      if (resolution.availableModes.length > 0) {
        emitTraceEvent(events, context, {
          type: "inventory:audio-modes",
          providerId: HIANIME_PROVIDER_ID,
          message: `HiAnime episode exposes ${resolution.availableModes.join(" and ")} audio modes`,
          attributes: { modes: resolution.availableModes.join(",") },
        });
      }

      const requested = resolution.requested;
      const resolvedLane = requested.servers.find(
        (server): server is Extract<HianimeServerResolution, { status: "resolved" }> =>
          server.status === "resolved",
      );
      if (requested.status !== "resolved" || !resolvedLane) {
        const failure =
          requested.status === "failed" && requested.failure
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
          sourceId: sourceIdFor(audioMode, explicitSource?.serverIndex ?? 0),
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

      const sourceId = sourceIdFor(audioMode, resolvedLane.serverIndex);
      if (!gated) {
        // The walk only marks a lane resolved after verifyLane accepted it, so
        // a missing stash means the invariant broke — fail loud rather than
        // ship an inventory the gate never probed.
        throw new Error("hianime resolved a lane the stream gate never saw");
      }
      // Selection reads provider order first; the handed-back inventory stays
      // quality-sorted for the Tracks picker, minus the rungs the gate refused.
      const gatedStreams = gated.streams;
      gatedStreams.sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));
      const gatedVariants = [...gated.variants].sort(
        (a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0),
      );
      const sources = finalizeCycleSourceInventory({
        sources: buildHianimeSourceInventory(resolution, audioMode, sourceId, cachePolicy),
        attempts: [],
        streams: gatedStreams,
        selectedStreamId: gated.selected.id,
      });
      const endedAt = context.now();

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: HIANIME_PROVIDER_ID,
        message: `Resolved ${gatedStreams.length} HiAnime stream(s)`,
        attributes: {
          sourceId: gated.selected.sourceId ?? sourceId,
          showId: show.id,
          episodeId: entry.episodeId,
          episodeNumber: entry.number,
          mode: audioMode,
        },
      });

      return {
        status: "resolved",
        providerId: HIANIME_PROVIDER_ID,
        selectedStreamId: gated.selected.id,
        selectionDecision: gated.decision,
        sources,
        streams: gatedStreams,
        variants: gatedVariants,
        subtitles: gated.subtitles,
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId: resolvedLane.malId,
          providerNativeIds: { [HIANIME_PROVIDER_ID]: show.id },
        },
        cachePolicy,
        trace: createResolveTrace({
          title: input.title,
          episode: input.episode,
          providerId: HIANIME_PROVIDER_ID,
          streamId: gated.selected.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", `Resolved HiAnime ${resolvedLane.serverName} embed`, {
              providerId: HIANIME_PROVIDER_ID,
              attributes: { streams: gatedStreams.length, showId: show.id },
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
      /* A status-bearing error carries its own verdict — a bare 403 whose body
       * never said "cloudflare" is still blocked, and a 429 is a rate limit,
       * not a retryable network blip (#458). */
      const structured = error instanceof ProviderHttpError ? error : undefined;
      let code: ProviderFailure["code"] = structured && !gone ? structured.code : "network-error";
      if (gone) code = "not-found";
      else if (/cloudflare|just a moment/i.test(message)) code = "blocked";
      const failure: ProviderFailure = {
        providerId: HIANIME_PROVIDER_ID,
        code,
        message,
        retryable: gone ? false : (structured?.retryable ?? true),
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
