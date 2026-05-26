import {
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  runProviderCycle,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderCycleCandidate,
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderResolveInput,
  ProviderSourceCandidate,
  ProviderSearchResult,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import {
  findLastCycleFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { normalizeProviderDisplayLabel } from "../shared/source-inventory";
import { normalizeIsoLanguageCode, subtitleLanguageDisplayName } from "../shared/subtitle-helpers";
import {
  loadAvailableEpisodesDetail,
  resolveAnimeEpisodeString,
  resolveEpisodeSources,
  buildStreamHeaders,
  fetchAllMangaEpisodeCatalog,
  searchAllManga,
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
  async search(input, context): Promise<readonly ProviderSearchResult[] | null> {
    const animeLang =
      input.preferredAudioLanguage === "dub" || input.preferredAudioLanguage === "en"
        ? ("dub" as const)
        : ("sub" as const);
    const results = await searchAllManga(
      ALLANIME_API_URL,
      ALLANIME_REFERER,
      DEFAULT_UA,
      input.query,
      animeLang,
      context.signal,
    );
    return results.map((result) => ({
      id: result.id,
      type: result.type,
      title: result.title,
      year: result.year,
      overview: result.description,
      posterPath: result.posterUrl ?? null,
      metadataSource: result.aniListId ? "AniList" : "AllManga",
      rating: result.averageScore ?? result.score ?? null,
      popularity: result.popularity ?? null,
      episodeCount: result.epCount,
      availableAudioModes: result.availableAudioModes,
      subtitleAvailability: result.availableAudioModes?.includes("sub") ? "hardsub" : "unknown",
      englishTitle: result.englishTitle,
      nativeTitle: result.nativeTitle,
      altNames: result.altNames,
      externalIds: {
        anilistId: result.aniListId ? String(result.aniListId) : undefined,
        malId: result.malId ? String(result.malId) : undefined,
      },
      artwork: {
        posterUrl: result.posterUrl,
        backdropUrl: result.bannerUrl,
        thumbnailUrl: result.posterUrl,
      },
      languageEvidence: result.availableAudioModes?.flatMap((mode) =>
        mode === "sub"
          ? [
              {
                role: "audio" as const,
                normalizedLanguage: "ja",
                nativeLabel: "sub",
                confidence: 0.85,
                metadata: { translationType: "sub" },
              },
              {
                role: "hardsub" as const,
                normalizedLanguage: "en",
                nativeLabel: "sub",
                confidence: 0.75,
                metadata: { translationType: "sub" },
              },
            ]
          : [
              {
                role: "audio" as const,
                normalizedLanguage: "en",
                nativeLabel: "dub",
                confidence: 0.85,
                metadata: { translationType: "dub" },
              },
            ],
      ),
    }));
  },
  async listEpisodes(input, context): Promise<readonly ProviderEpisodeOption[] | null> {
    const mode =
      input.preferredAudioLanguage === "dub" || input.preferredAudioLanguage === "en"
        ? ("dub" as const)
        : ("sub" as const);
    return fetchAllMangaEpisodeCatalog({
      apiUrl: ALLANIME_API_URL,
      referer: ALLANIME_REFERER,
      ua: DEFAULT_UA,
      showId: input.title.id.replace("allanime:", ""),
      mode,
      signal: context.signal,
    });
  },
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
      startupPriority: input.startupPriority,
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

      // Same GQL catalog as listEpisodes (showCatalogCache, 45s TTL in api-client).
      const detail = await loadAvailableEpisodesDetail(
        ALLANIME_API_URL,
        ALLANIME_REFERER,
        DEFAULT_UA,
        showId,
        context.signal,
      );
      const episodes = (detail[mode] ?? []) as string[];

      if (episodes.length === 0) {
        throw new Error(`No ${mode} episodes found for show ${showId}`);
      }

      const epStr = resolveAnimeEpisodeString(episodes, episodeNum);

      const explicitAk = isExplicitAkSelection(input);
      let triedAk = explicitAk;
      let links = await resolveEpisodeSources({
        apiUrl: ALLANIME_API_URL,
        referer: ALLANIME_REFERER,
        ua: DEFAULT_UA,
        showId,
        epStr,
        mode,
        sourceLane: explicitAk ? "ak-only" : "baseline",
        signal: context.signal,
      });

      if (links.length === 0 && !explicitAk) {
        links = await resolveEpisodeSources({
          apiUrl: ALLANIME_API_URL,
          referer: ALLANIME_REFERER,
          ua: DEFAULT_UA,
          showId,
          epStr,
          mode,
          sourceLane: "ak-only",
          signal: context.signal,
        });
        triedAk = true;
      }

      if (links.length === 0) {
        throw new Error(`No streams extracted from AllManga for episode ${epStr}`);
      }

      const streams: StreamCandidate[] = [];
      const variants: ProviderVariantCandidate[] = [];
      const subtitles: SubtitleCandidate[] = [];

      // Map the links to our strict format
      const mapLinks = (sourceLinks: typeof links) => {
        for (const link of sourceLinks) {
          if (!link.url) continue;

          const qualityStr = link.quality || "auto";
          const protocol = link.protocol ?? (link.url.includes(".m3u8") ? "hls" : "mp4");
          const sourceName =
            protocol === "dash"
              ? "Ak"
              : qualityStr.includes("HLS") || protocol === "hls"
                ? "FM-HLS"
                : "VID-MP4";
          const sourceLabel = normalizeProviderDisplayLabel(sourceName) ?? sourceName;
          const sourceId = `source:${ALLANIME_PROVIDER_ID}:${sourceName.toLowerCase()}`;

          const streamId = `stream:${ALLANIME_PROVIDER_ID}:${Bun.hash(link.url).toString(36)}`;
          const variantId = `variant:${ALLANIME_PROVIDER_ID}:${sourceId}:${qualityStr}`;

          const headers = buildStreamHeaders(link.referer, ALLANIME_REFERER, DEFAULT_UA);

          streams.push({
            id: streamId,
            providerId: ALLANIME_PROVIDER_ID,
            sourceId,
            variantId,
            ...(link.deferredLocator
              ? { deferredLocator: link.deferredLocator }
              : { url: link.url }),
            protocol,
            container:
              link.container ?? (protocol === "hls" ? "m3u8" : protocol === "dash" ? "mpd" : "mp4"),
            audioLanguages: mode === "sub" ? ["ja"] : mode === "dub" ? ["en"] : [],
            presentation: mode,
            hardSubLanguage: mode === "sub" ? "en" : undefined,
            subtitleDelivery: mode === "sub" ? "hardcoded" : undefined,
            subtitleLanguages: mode === "sub" ? ["en"] : undefined,
            qualityLabel: qualityStr,
            qualityRank: parseInt(qualityStr) || 0,
            languageEvidence: [
              {
                role: "audio",
                normalizedLanguage: mode === "sub" ? "ja" : "en",
                nativeLabel: mode,
                sourceId,
                confidence: 0.85,
                metadata: { translationType: mode },
              },
              ...(mode === "sub"
                ? [
                    {
                      role: "hardsub" as const,
                      normalizedLanguage: "en",
                      nativeLabel: mode,
                      sourceId,
                      confidence: 0.75,
                      metadata: { translationType: mode },
                    },
                  ]
                : []),
            ],
            sourceEvidence: [
              {
                sourceId,
                nativeLabel: sourceLabel,
                host: link.deferredLocator ? "allanime.day" : new URL(link.url).hostname,
                confidence: protocol === "hls" ? 0.95 : 0.85,
                metadata: { translationType: mode },
              },
            ],
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
            container:
              link.container ?? (protocol === "hls" ? "m3u8" : protocol === "dash" ? "mpd" : "mp4"),
            audioLanguages: mode === "sub" ? ["ja"] : ["en"],
            presentation: mode,
            hardSubLanguage: mode === "sub" ? "en" : undefined,
            subtitleDelivery: mode === "sub" ? "hardcoded" : undefined,
            streamIds: [streamId],
            confidence: protocol === "hls" ? 0.95 : 0.85,
            languageEvidence: [
              {
                role: "audio",
                normalizedLanguage: mode === "sub" ? "ja" : "en",
                nativeLabel: mode,
                sourceId,
                confidence: 0.85,
                metadata: { translationType: mode },
              },
            ],
          });

          if (link.subtitle) {
            const subSrc = link.subtitles?.find((s) => s.src === link.subtitle);
            const subLang = subSrc?.lang ?? "en";
            const normalizedLang = normalizeIsoLanguageCode(subLang);
            const subId = `subtitle:${ALLANIME_PROVIDER_ID}:${Bun.hash(link.subtitle).toString(36)}`;
            subtitles.push({
              id: subId,
              providerId: ALLANIME_PROVIDER_ID,
              sourceId,
              url: link.subtitle,
              language: normalizedLang,
              label: normalizedLang
                ? (subtitleLanguageDisplayName(normalizedLang) ?? subLang)
                : subLang,
              format: subtitleFormatFromUrl(link.subtitle),
              source: "embedded",
              confidence: 0.9,
              cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
            });
          }

          // Add any additional subtitles that weren't the primary picked one
          if (link.subtitles) {
            for (const extra of link.subtitles) {
              if (extra.src === link.subtitle) continue;
              if (!extra.src) continue;
              const normLang = normalizeIsoLanguageCode(extra.lang);
              const extraId = `subtitle:${ALLANIME_PROVIDER_ID}:${Bun.hash(extra.src).toString(36)}`;
              subtitles.push({
                id: extraId,
                providerId: ALLANIME_PROVIDER_ID,
                sourceId,
                url: extra.src,
                language: normLang,
                label: normLang
                  ? (subtitleLanguageDisplayName(normLang) ?? extra.lang)
                  : extra.lang,
                format: subtitleFormatFromUrl(extra.src),
                source: "embedded",
                confidence: 0.85,
                cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
              });
            }
          }
        }
      };

      mapLinks(links);

      if (streams.length === 0 && !explicitAk) {
        links = await resolveEpisodeSources({
          apiUrl: ALLANIME_API_URL,
          referer: ALLANIME_REFERER,
          ua: DEFAULT_UA,
          showId,
          epStr,
          mode,
          sourceLane: "ak-only",
          signal: context.signal,
        });
        triedAk = true;
        mapLinks(links);
      }

      // Sort streams so HLS/1080p is at the top
      streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
      variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      const runAllmangaCycle = () =>
        runProviderCycle({
          providerId: ALLANIME_PROVIDER_ID,
          candidates: buildAllmangaCycleCandidates(streams, input.qualityPreference, {
            preferredSourceId: input.preferredSourceId,
            preferredStreamId: input.preferredStreamId,
          }),
          signal: context.signal,
          now: context.now,
          maxAttemptsPerCandidate: 1,
          candidateTimeoutMs: 2_500,
          resolveCandidate: async (candidate, cycleContext) => {
            const stream = streams.find((item) => item.id === candidate.streamId);
            if (!stream?.url && !stream?.deferredLocator) {
              throw createProviderCycleFailureError(candidate, {
                failureClass: "candidate-empty",
                message: `AllManga candidate ${candidate.id} did not contain a playable URL`,
                retryable: false,
                at: context.now(),
              });
            }
            cycleContext.emit({
              type: "variant:selected",
              at: context.now(),
              providerId: ALLANIME_PROVIDER_ID,
              sourceId: stream.sourceId,
              variantId: stream.variantId,
              streamId: stream.id,
              attempt: cycleContext.attempt,
              message: stream.qualityLabel ?? candidate.label ?? candidate.id,
              attributes: {
                candidateId: candidate.id,
                presentation: stream.presentation ?? null,
                qualityRank: stream.qualityRank ?? null,
              },
            });
            return stream;
          },
        });

      let cycleResult = await runAllmangaCycle();
      events.push(...cycleResult.events);
      if (cycleResult.cancelled) {
        return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
          code: "cancelled",
          message: "AllManga source cycling was cancelled",
          retryable: false,
        });
      }
      let selectedStream = cycleResult.selected;
      if (!selectedStream && !triedAk) {
        links = await resolveEpisodeSources({
          apiUrl: ALLANIME_API_URL,
          referer: ALLANIME_REFERER,
          ua: DEFAULT_UA,
          showId,
          epStr,
          mode,
          sourceLane: "ak-only",
          signal: context.signal,
        });
        triedAk = true;
        mapLinks(links);
        streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
        variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
        cycleResult = await runAllmangaCycle();
        events.push(...cycleResult.events);
        if (cycleResult.cancelled) {
          return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, {
            code: "cancelled",
            message: "AllManga source cycling was cancelled",
            retryable: false,
          });
        }
        selectedStream = cycleResult.selected;
      }
      if (!selectedStream) {
        const cycleFailure = findLastCycleFailure(cycleResult.attempts);
        const failure: ProviderFailure = cycleFailure
          ? {
              providerId: ALLANIME_PROVIDER_ID,
              code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
              message: cycleFailure.message,
              retryable: cycleFailure.retryable,
              at: cycleFailure.at,
            }
          : {
              providerId: ALLANIME_PROVIDER_ID,
              code: "not-found",
              message: "No selectable AllManga streams were mapped.",
              retryable: true,
              at: context.now(),
            };
        failures.push(failure);
        return createExhaustedResult(input, context, ALLANIME_PROVIDER_ID, failure);
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
        status: "resolved",
        providerId: ALLANIME_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: sourceCandidates,
        streams,
        variants,
        subtitles,
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId: input.title.externalIds?.malId ?? input.title.malId,
        },
        artwork: input.episode?.artwork,
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
              attributes: {
                streams: streams.length,
                sourceCycleAttempts: cycleResult.attempts.length,
                selectedCandidateId: cycleResult.selectedCandidate?.id ?? null,
              },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: ALLANIME_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
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

function isExplicitAkSelection(input: ProviderResolveInput): boolean {
  return input.preferredSourceId?.endsWith(":ak") === true;
}

export function buildAllmangaCycleCandidates(
  streams: readonly StreamCandidate[],
  qualityPreference: string | undefined,
  selection: {
    readonly preferredSourceId?: string;
    readonly preferredStreamId?: string;
  } = {},
): ProviderCycleCandidate[] {
  return streams.map((stream, index) => {
    const qualityRank = stream.qualityRank ?? (parseInt(stream.qualityLabel ?? "") || 0);
    const qualityBoost =
      qualityPreference && stream.qualityLabel?.includes(qualityPreference) ? -10_000 : 0;
    const hlsBoost = stream.protocol === "hls" ? -1_000 : 0;
    const selectedStreamBoost = stream.id === selection.preferredStreamId ? -20_000 : 0;
    const selectedSourceBoost = stream.sourceId === selection.preferredSourceId ? -10_000 : 0;
    return {
      id: `candidate:${stream.id}`,
      providerId: ALLANIME_PROVIDER_ID,
      sourceId: stream.sourceId,
      variantId: stream.variantId,
      streamId: stream.id,
      groupId: stream.presentation,
      label: stream.qualityLabel ?? stream.presentation ?? stream.id,
      nativeLabel: stream.sourceEvidence?.[0]?.nativeLabel ?? stream.qualityLabel,
      normalizedAudioLanguage: stream.audioLanguages?.[0],
      normalizedSubtitleLanguage: stream.hardSubLanguage ?? stream.subtitleLanguages?.[0],
      presentation: stream.presentation,
      qualityRank,
      priority:
        selectedStreamBoost +
        selectedSourceBoost +
        qualityBoost +
        hlsBoost -
        qualityRank +
        index / 1000,
      metadata: {
        protocol: stream.protocol,
        sourceHost: stream.sourceEvidence?.[0]?.host,
      },
    };
  });
}

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
  return normalizeProviderDisplayLabel(family) ?? family;
}

function subtitleFormatFromUrl(url: string): "srt" | "vtt" | "ass" | "unknown" {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".ass")) return "ass";
  if (path.endsWith(".srt")) return "srt";
  if (path.endsWith(".vtt")) return "vtt";
  return "unknown";
}
