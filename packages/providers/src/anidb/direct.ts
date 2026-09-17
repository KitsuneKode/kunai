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
} from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import {
  anidbEpisodeMetadataCacheKey,
  enrichEpisodeOptionsWithAnimeMetadata,
  fetchAnimeEpisodeMetadataByNumber,
  mergeExternalEpisodeMetadataInto,
  mergeSeededEpisodeMetadataInto,
  seedEpisodeMetadataFromProvider,
  shouldSkipExternalEpisodeMetadataEnrichment,
  type AnimeEpisodeMetadata,
} from "../shared/anime-metadata";
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
  anidbNumericId,
  chooseAnidbSearchMatch,
  fetchAnidbEpisodeCatalog,
  type AnidbEpisodeCatalog,
  fetchAnidbEpisodes,
  fetchAnidbExternalIds,
  fetchAnidbOfficialEpisodeMetadata,
  fetchAnidbMalId,
  looksLikeAnidbShowId,
  parseAnidbSeasonEvidence,
  resolveAnidbEpisodeStreams,
  searchAnidb,
  type AnidbModeOutcome,
  type AnidbSearchResult,
  type AnidbStreamLink,
} from "./client";
import { anidbManifest, ANIDB_PROVIDER_ID } from "./manifest";
import { routeAnidbSeason } from "./season-routing";

export { ANIDB_PROVIDER_ID };
export {
  anidbNumericId,
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  collectAnidbAvailableAudioModes,
  fetchAnidbEpisodeCatalog,
  fetchAnidbExternalIds,
  fetchAnidbOfficialEpisodeMetadata,
  fetchAnidbMalId,
  isAnidbMaintenanceText,
  looksLikeAnidbShowId,
  parseAnidbBrowseHtml,
  parseAnidbSeasonEvidence,
  anidbCipherArgs,
  resolveAnidbCurl,
  runAnidbCurlWithRetry,
  resolveAnidbEpisodeStreams,
  searchAnidb,
  type AnidbEpisodeCatalog,
  type AnidbSearchResult,
  type AnidbSeasonEvidence,
} from "./client";

function directAnidbShowFromInput(input: {
  readonly title: ProviderResolveInput["title"];
}): AnidbSearchResult | null {
  const native = input.title.externalIds?.providerNativeIds?.[ANIDB_PROVIDER_ID];
  const id = looksLikeAnidbShowId(native)
    ? native
    : looksLikeAnidbShowId(input.title.id)
      ? input.title.id
      : null;
  if (!id) return null;
  const numericId = anidbNumericId(id);
  if (numericId === null) return null;
  const title = input.title.title || id;
  return { id, title, numericId, seasonEvidence: parseAnidbSeasonEvidence(title) };
}

async function resolveAnidbShow(
  input: { readonly title: ProviderResolveInput["title"] },
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<AnidbSearchResult | null> {
  const direct = directAnidbShowFromInput(input);
  if (direct) {
    // A persisted `providerNativeIds.anidb` can point at a reindexed slug
    // (Solo Leveling 19413 → 4883), which 404s permanently. Re-search so a
    // history entry does not strand — but only on evidence that the id is
    // actually gone.
    const query = input.title.title?.trim() ?? "";
    if (!query) return direct;

    let catalog: AnidbEpisodeCatalog;
    try {
      catalog = await fetchAnidbEpisodeCatalog(direct.id, signal, context);
    } catch (error) {
      // The caller cancelling is a decision, not an anidb condition: returning
      // a result nobody awaits hides it. An internal timeout is different and
      // stays below, where keeping the id is right.
      if (signal?.aborted === true) throw error;
      // Cloudflare or a transient fault says nothing about whether the id is
      // valid, so keep it and let the caller surface something retryable.
      return direct;
    }

    // Only a 404 means the id is gone. An empty-but-present catalogue is a
    // season that exists with no episodes listed yet; re-searching that would
    // trade a correct id for whatever the browse page happens to rank first.
    if (!catalog.missing) return direct;

    const searched = await searchAnidb(query, signal, context);
    return (
      chooseAnidbSearchMatch(query, searched, { requireTitleEvidence: true }) ??
      // No titled match: the dead id is more honest than a guess. Resolve
      // surfaces `catalog-unavailable` from here.
      direct
    );
  }

  const query = input.title.title?.trim() ?? "";
  if (!query) return null;
  return chooseAnidbSearchMatch(query, await searchAnidb(query, signal, context));
}

function buildStreamHeaders(referer: string): Record<string, string> {
  return {
    Referer: referer || ANIDB_REFERER,
    "User-Agent": ANIDB_USER_AGENT,
  };
}

function buildAnidbSourceInventory(
  availableModes: readonly ("sub" | "dub")[],
  selectedMode: "sub" | "dub",
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): readonly ProviderSourceCandidate[] {
  // Build one source entry per available audio mode so the inventory advertises
  // every language the AniDB episode API reports.  The selected mode starts as
  // "probing" (finalizeCycleSourceInventory will promote it); the rest start as
  // "available" so the user can switch to them from the Tracks picker.
  const modes = availableModes.length > 0 ? availableModes : [selectedMode];
  return modes.map((audioMode) => {
    const sourceId = `source:${ANIDB_PROVIDER_ID}:${audioMode}`;
    return {
      id: sourceId,
      providerId: ANIDB_PROVIDER_ID,
      kind: "provider-api" as const,
      label: audioMode === "dub" ? "AniDB Dub" : "AniDB Sub",
      host: "anidb.app",
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
          serverId: audioMode,
          nativeLabel: audioMode === "dub" ? "English" : "Japanese",
          host: "anidb.app",
          confidence: 0.85,
        },
      ],
    };
  });
}

function linksToCandidates(
  links: readonly AnidbStreamLink[],
  cachePolicy: ReturnType<typeof createProviderCachePolicy>,
): {
  readonly streams: StreamCandidate[];
  readonly variants: ProviderVariantCandidate[];
} {
  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];

  for (const link of links) {
    const audioMode = link.audioMode;
    const sourceId = `source:${ANIDB_PROVIDER_ID}:${audioMode}`;
    const sourceDetail = formatAnimeSourceDetail({
      audio: audioMode,
      subtitleMode: "unknown",
    });
    const archetype = formatAnimeSourceArchetype({
      audio: audioMode,
      detail: audioMode === "dub" ? "Dub" : "Sub",
    });

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
      flavorArchetype: archetype,
      flavorLabel: audioMode === "dub" ? "Dub" : "Sub",
      serverName: "anidb",
      confidence: 0.9,
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

  return { streams, variants };
}

export const anidbProviderModule: CoreProviderModule = {
  providerId: ANIDB_PROVIDER_ID,
  manifest: anidbManifest,

  async search(input, context): Promise<readonly ProviderSearchResult[] | null> {
    try {
      const results = await searchAnidb(input.query, context.signal, context);
      const mapped: ProviderSearchResult[] = [];
      for (const result of results.slice(0, 40)) {
        mapped.push({
          id: result.id,
          type: result.kind === "movie" ? "movie" : "series",
          title: result.title,
          metadataSource: "AniDB",
          ...(result.posterUrl
            ? {
                posterPath: result.posterUrl,
                artwork: { posterUrl: result.posterUrl, thumbnailUrl: result.posterUrl },
              }
            : {}),
          ...(result.rating !== undefined ? { rating: result.rating } : {}),
          externalIds: {
            providerNativeIds: { [ANIDB_PROVIDER_ID]: result.id },
          },
        });
      }
      return mapped;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return null;
    }
  },

  async listEpisodes(input, context) {
    const showId = (await resolveAnidbShow(input, context.signal, context))?.id;
    if (!showId) return null;
    const episodes = await fetchAnidbEpisodes(showId, context.signal, context);
    if (episodes.length === 0) return [];

    const suppliedMalId = input.title.externalIds?.malId ?? input.title.malId;
    const suppliedAnilistId = input.title.externalIds?.anilistId ?? input.title.anilistId;
    const pageIds = await fetchAnidbExternalIds(showId, context.signal, context);
    const malId = suppliedMalId?.trim() ? suppliedMalId : pageIds?.malId;
    const anilistId = suppliedAnilistId ?? pageIds?.anilistId;
    const metadataMalId = malId === undefined ? undefined : String(malId);

    // Official AniDB is the title/synopsis/air-date authority for this provider
    // and answers in one request for the whole series, so it runs first and its
    // values win. Seeded so a second listing (or the same show under another
    // surface) does not pay for it again.
    const metadataCacheKey = anidbEpisodeMetadataCacheKey(showId);
    const metadata = new Map<number, AnimeEpisodeMetadata>();
    mergeSeededEpisodeMetadataInto(metadata, metadataCacheKey);
    if (metadata.size === 0 && pageIds?.officialAid) {
      const official = await fetchAnidbOfficialEpisodeMetadata(pageIds.officialAid, context.signal);
      for (const [number, meta] of official) metadata.set(number, meta);
      seedEpisodeMetadataFromProvider(metadataCacheKey, [...official.values()]);
    }

    // AniDB publishes no episode stills, so AniList still runs for artwork even
    // when every title is already known — but the paginated, rate-limited Jikan
    // pass is skipped, which is the slow half.
    if (anilistId || metadataMalId) {
      const pass = shouldSkipExternalEpisodeMetadataEnrichment(metadata, episodes.length)
        ? "artwork"
        : "full";
      const externalMetadata = await fetchAnimeEpisodeMetadataByNumber(
        { anilistId, malId: metadataMalId },
        context.signal,
        pass,
      );
      mergeExternalEpisodeMetadataInto(metadata, externalMetadata);
    }

    const baseEpisodes = episodes.map(
      (episode): ProviderEpisodeOption => ({
        index: episode.number,
        label: `Episode ${episode.number}`,
        detail: episode.filler ? "Filler" : undefined,
        totalEpisodeCount: episodes.length,
        // Series poster as the still fallback: an empty art slot reads as a
        // broken row, and AniDB has no per-episode image of its own.
        artwork: pageIds?.posterUrl ? { thumbnailUrl: pageIds.posterUrl } : undefined,
        externalIds: {
          anilistId,
          malId: malId ? String(malId) : undefined,
        },
      }),
    );
    return metadata.size > 0
      ? enrichEpisodeOptionsWithAnimeMetadata(baseEpisodes, metadata)
      : baseEpisodes;
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

    const baseShow = await resolveAnidbShow(input, context.signal, context);
    if (!baseShow) {
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
        code: "unsupported-title",
        message: "AniDB requires a validated provider-native show id or searchable title",
        retryable: false,
      });
    }

    const route = await routeAnidbSeason({
      base: baseShow,
      episode: input.episode,
      search: (query, signal) => searchAnidb(query, signal, context),
      episodes: (showId, signal) => fetchAnidbEpisodes(showId, signal, context),
      signal: context.signal,
    });
    if (!route) {
      return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, {
        code: "not-found",
        message: `No unambiguous AniDB season route for ${baseShow.id} season ${input.episode?.season ?? 1}`,
        retryable: false,
      });
    }

    const showId = route.routedShowId;
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

    // Overlap the MAL scrape with stream resolution so it never adds a serial
    // request to the resolve hot path. TTL-cached per show; a cache hit settles
    // immediately. If resolve bails out early, the fetch just warms the cache.
    const existingMalId = input.title.externalIds?.malId ?? input.title.malId;
    const malIdPromise =
      existingMalId !== undefined && existingMalId !== ""
        ? Promise.resolve(String(existingMalId))
        : fetchAnidbMalId(showId, context.signal, context).then(
            (id) => (id !== undefined ? String(id) : undefined),
            () => undefined,
          );

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: ANIDB_PROVIDER_ID,
      message: `Started AniDB resolve for ${showId}`,
    });

    const explicitSourceMode =
      input.preferredSourceId === `source:${ANIDB_PROVIDER_ID}:dub`
        ? "dub"
        : input.preferredSourceId === `source:${ANIDB_PROVIDER_ID}:sub`
          ? "sub"
          : undefined;
    const audioMode =
      explicitSourceMode ??
      resolveAnimeAudioIntent(
        input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
      ).catalogMode;
    // Numbering is decided by routeAnidbSeason, which only uses absoluteEpisode
    // when the routed title's own episode catalog confirms it.
    const episodeNumber = route.episodeNumber;
    const routeAttributes: Record<string, string | number | boolean | null> = {
      requestedSeason: route.requestedSeason,
      baseShowId: route.baseShowId,
      routedShowId: route.routedShowId,
      routeEvidence: route.evidence.kind,
      numberingEvidence: route.numberingEvidence.kind,
      numberingEvidenceReason:
        route.numberingEvidence.kind === "cour" ? route.numberingEvidence.reason : null,
      episodeNumber: route.episodeNumber,
      usedAbsoluteEpisode: route.usedAbsoluteEpisode,
    };

    try {
      const resolution = await resolveAnidbEpisodeStreams({
        context,
        showId,
        episodeNumber,
        requestedMode: audioMode,
        startupPriority: input.startupPriority,
        signal: context.signal,
      });
      if (resolution.availableModes.length > 0) {
        emitTraceEvent(events, context, {
          type: "inventory:audio-modes",
          providerId: ANIDB_PROVIDER_ID,
          message: `AniDB episode exposes ${resolution.availableModes.join(" and ")} audio modes`,
          attributes: { modes: resolution.availableModes.join(",") },
        });
      }

      emitAnidbModeOutcome(events, context, resolution.requested);
      if (resolution.alternate) emitAnidbModeOutcome(events, context, resolution.alternate);

      if (resolution.requested.status !== "resolved") {
        const failure =
          "failure" in resolution.requested
            ? resolution.requested.failure
            : {
                code: "not-found" as const,
                message: `No AniDB streams for ${showId} episode ${episodeNumber} (${audioMode})`,
                retryable: false,
              };
        return createExhaustedResult(input, context, ANIDB_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }

      const resolvedOutcomes = [resolution.requested, resolution.alternate].filter(
        (outcome): outcome is Extract<AnidbModeOutcome, { status: "resolved" }> =>
          outcome?.status === "resolved",
      );
      const links = resolvedOutcomes.flatMap((outcome) => outcome.links);
      const resolvedModes = resolvedOutcomes.map((outcome) => outcome.mode);
      const { streams, variants } = linksToCandidates(links, cachePolicy);
      const targetSourceId = input.preferredSourceId ?? `source:${ANIDB_PROVIDER_ID}:${audioMode}`;
      const selection = selectReadyStream(streams, {
        startupPriority: input.startupPriority,
        qualityPreference: input.qualityPreference,
        preferredSourceId: targetSourceId,
        preferredStreamId: input.preferredStreamId,
        favoriteSourceNames: input.favoriteSourceNames,
      });
      const sources = finalizeCycleSourceInventory({
        sources: buildAnidbSourceInventory(resolvedModes, audioMode, cachePolicy),
        attempts: [],
        streams,
        selectedStreamId: selection.selected.id,
      });
      const endedAt = context.now();

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: ANIDB_PROVIDER_ID,
        message: `Resolved ${streams.length} AniDB stream(s)`,
        attributes: {
          sourceId: selection.selected.sourceId ?? targetSourceId,
          showId,
          ...routeAttributes,
        },
      });

      const malId = await malIdPromise;

      return {
        status: "resolved",
        providerId: ANIDB_PROVIDER_ID,
        selectedStreamId: selection.selected.id,
        selectionDecision: selection.decision,
        sources,
        streams,
        variants,
        subtitles: [],
        release: input.episode?.release,
        artwork: input.episode?.artwork,
        externalIds: {
          anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
          malId,
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
            createTraceStep("provider", "Routed AniDB season identity", {
              providerId: ANIDB_PROVIDER_ID,
              attributes: routeAttributes,
            }),
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
      if (context.signal?.aborted) {
        return createExhaustedResult(
          input,
          context,
          ANIDB_PROVIDER_ID,
          {
            code: "cancelled",
            message: "AniDB resolution was cancelled",
            retryable: false,
          },
          {
            cachePolicy,
            events,
            failures,
            startedAt,
          },
        );
      }
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

function emitAnidbModeOutcome(
  events: ProviderTraceEvent[],
  context: ProviderRuntimeContext,
  outcome: AnidbModeOutcome,
): void {
  const sourceId = `source:${ANIDB_PROVIDER_ID}:${outcome.mode}`;
  const type =
    outcome.status === "resolved"
      ? "source:success"
      : outcome.status === "failed" || outcome.status === "timed-out"
        ? "source:failed"
        : "source:skipped";
  emitTraceEvent(events, context, {
    type,
    providerId: ANIDB_PROVIDER_ID,
    sourceId,
    message: `AniDB ${outcome.mode} source ${outcome.status}`,
    attributes: { mode: outcome.mode, status: outcome.status },
  });
}
