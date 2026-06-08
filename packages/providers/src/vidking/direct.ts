import {
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  runProviderCycle,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  CachePolicy,
  EpisodeIdentity,
  ProviderCycleCandidate,
  ProviderCycleAttempt,
  ProviderFailure,
  ProviderFetchPort,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";

import { HealthTracker } from "../shared/provider-cache";
import {
  appendCycleEventsToResult,
  findLastCycleFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import {
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createStreamId,
  createVariantCandidateFromStream,
  createVariantId,
  finalizeCycleSourceInventory,
  qualityRankFromLabel,
  normalizeQualityLabel,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { runStreamHealthCheck, STREAM_HEALTH_DEFAULTS } from "../shared/stream-health";
import { looksLikeHiSubtitle, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import {
  getPhaseAVidkingServers,
  flavorSourceId,
  getPhaseAVidkingFlavorIds,
  listEligibleVidkingFlavorIds,
  listVidkingFlavors,
  resolveFlavorEngineOptions,
  resolveVidkingPresentation,
  vidkingEngineOptionsForEndpoint,
  vidkingSourceIdForEndpoint,
  vidkingSourceIdForPresentation,
} from "./flavors";
import { vidkingManifest, VIDKING_PROVIDER_ID } from "./manifest";

export { VIDKING_PROVIDER_ID };
export const VIDKING_REFERER = "https://www.vidking.net/";
export const VIDKING_ORIGIN = "https://www.vidking.net";
/** Videasy moved the stream API from api.videasy.net (404) to api.videasy.to. */
export const VIDKING_API_BASE = "https://api.videasy.to";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const VIDEASY_APP_ID = "vidking";

const VIDKING_SERVERS = ["mb-flix", "cdn", "downloader2", "1movies"] as const;

/** Phase A blocking resolve: Luffy → Zoro → Nami (no embed-referer fanout). */
export const VIDKING_PHASE_A_SERVERS = getPhaseAVidkingServers();

export const VIDKING_VIDEASY_FETCH_TIMEOUT_MS = 90_000;
const VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS = 95_000;
/** Normalize audio language codes to ISO 639-1. Delegates to the shared language
 *  normalizer which handles both subtitle and audio language code formats. */
function normalizeLanguageCode(value: string | undefined): string | undefined {
  return normalizeIsoLanguageCode(value);
}

/** Track server health with 60s cooldown after 2 consecutive failures. */
const vidkingHealth = new HealthTracker(60_000, 2);

type VidkingServer = (typeof VIDKING_SERVERS)[number];
type VidkingServerEndpoint = VidkingServer | (string & {});

type VidkingCycleCandidateMetadata = {
  readonly server: VidkingServerEndpoint;
  readonly customReferer?: string;
  readonly flavorId?: string;
  readonly flavorLabel?: string;
  readonly flavorArchetype?: string;
  readonly retryTier: "direct" | "embed-referer";
};

export interface VidKingEngineOptions {
  readonly flavorId?: string;
  readonly serverEndpoint?: VidkingServerEndpoint;
  readonly language?: string;
  readonly filterQuality?: string;
  readonly flavorLabel?: string;
  readonly flavorArchetype?: string;
  readonly customReferer?: string;
  readonly sessionToken?: string;
  readonly appId?: string;
}

export interface VidkingSourcePayload {
  readonly url?: string;
  readonly quality?: string;
  readonly type?: string;
  readonly language?: string;
}

export interface VidkingSubtitlePayload {
  readonly url?: string;
  readonly src?: string;
  readonly file?: string;
  readonly href?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly label?: string;
  readonly release?: string;
}

export interface VidkingPayload {
  readonly sources?: readonly VidkingSourcePayload[];
  readonly subtitles?: readonly VidkingSubtitlePayload[];
}

type VideasyErrorPayload = {
  readonly error?: string;
  readonly codes?: readonly string[];
};

type WasmExports = {
  __newString(value: string): number;
  __getString(pointer: number): string;
  decrypt(payloadPointer: number, tmdbId: number): number;
};

let wasmExportsPromise: Promise<WasmExports> | null = null;
let wasmDecodeQueue: Promise<void> = Promise.resolve();

export const vidkingProviderModule: CoreProviderModule = {
  providerId: VIDKING_PROVIDER_ID,
  manifest: vidkingManifest,
  async resolve(input, context) {
    const result = await resolveVidkingDirect(input, context);
    if (result) {
      return result;
    }

    return createExhaustedResult(input, context, VIDKING_PROVIDER_ID, {
      code: "not-found",
      message: "VidKing direct resolver did not find a playable source",
      retryable: false,
    });
  },
};

export async function resolveVidkingDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
  engineOptions: VidKingEngineOptions = {},
): Promise<ProviderResolveResult | null> {
  const resolvedOptions =
    engineOptions.flavorId && !engineOptions.serverEndpoint
      ? { ...resolveFlavorEngineOptions(engineOptions.flavorId), ...engineOptions }
      : engineOptions;

  if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
    return null;
  }

  if (!input.allowedRuntimes.includes("direct-http")) {
    return createExhaustedResult(input, context, VIDKING_PROVIDER_ID, {
      code: "runtime-missing",
      message: "VidKing direct resolver requires direct-http runtime",
      retryable: false,
    });
  }

  const tmdbId = resolveTmdbId(input.title);
  if (!tmdbId) {
    return createExhaustedResult(input, context, VIDKING_PROVIDER_ID, {
      code: "unsupported-title",
      message: "VidKing direct resolver requires a numeric TMDB id",
      retryable: false,
    });
  }

  const startedAt = context.now();
  const cachePolicy = createProviderCachePolicy({
    providerId: VIDKING_PROVIDER_ID,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
    startupPriority: input.startupPriority,
  });
  const events: ProviderTraceEvent[] = [];
  const sources: ProviderSourceCandidate[] = [];
  const failures: ProviderFailure[] = [];

  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId: VIDKING_PROVIDER_ID,
    message: "Started VidKing direct Videasy resolution",
  });

  const exhaustiveRefresh = input.intent === "refresh";
  const preferredFlavorIds =
    !exhaustiveRefresh && !resolvedOptions?.serverEndpoint && input.preferredSourceId
      ? listVidkingFlavors()
          .filter(
            (flavor) =>
              flavorSourceId(flavor.id) === input.preferredSourceId ||
              vidkingSourceIdForEndpoint(flavor.endpoint) === input.preferredSourceId,
          )
          .filter((flavor) => input.mediaKind !== "series" || flavor.moviesOnly !== true)
          .map((flavor) => flavor.id)
      : [];
  const phaseAOnly =
    !exhaustiveRefresh &&
    preferredFlavorIds.length === 0 &&
    !resolvedOptions?.serverEndpoint &&
    !resolvedOptions?.customReferer;
  let activeServers: VidkingServerEndpoint[] = (
    phaseAOnly ? [...VIDKING_PHASE_A_SERVERS] : [...VIDKING_SERVERS]
  ).filter((s) => vidkingHealth.shouldTry(s));
  const exhaustiveFlavorIds =
    exhaustiveRefresh && !resolvedOptions?.serverEndpoint
      ? listVidkingFlavors()
          .filter((flavor) => input.mediaKind !== "series" || flavor.moviesOnly !== true)
          .map((flavor) => flavor.id)
      : [];

  // Flavor wrappers can target a specific Videasy-compatible endpoint.
  if (resolvedOptions?.serverEndpoint) {
    activeServers = [resolvedOptions.serverEndpoint];
  }

  if (activeServers.length === 0) {
    emitTraceEvent(events, context, {
      type: "source:skipped",
      providerId: VIDKING_PROVIDER_ID,
      sourceId: createSourceId("all"),
      message: "All servers in cooldown, skipping Tier 1",
    });
  }

  const mediaKind =
    input.mediaKind === "movie" || input.mediaKind === "series" ? input.mediaKind : undefined;
  const inventoryFlavorIds = resolvedOptions?.flavorId
    ? [resolvedOptions.flavorId]
    : exhaustiveFlavorIds.length > 0
      ? exhaustiveFlavorIds
      : preferredFlavorIds.length > 0
        ? preferredFlavorIds
        : resolvedOptions?.serverEndpoint
          ? listEligibleVidkingFlavorIds(mediaKind).filter((flavorId) => {
              const options = resolveFlavorEngineOptions(flavorId);
              if (!options || options.serverEndpoint !== resolvedOptions.serverEndpoint) {
                return false;
              }
              if (
                resolvedOptions.language &&
                options.language &&
                options.language !== resolvedOptions.language
              ) {
                return false;
              }
              if (
                resolvedOptions.filterQuality &&
                options.filterQuality &&
                options.filterQuality !== resolvedOptions.filterQuality
              ) {
                return false;
              }
              return true;
            })
          : listEligibleVidkingFlavorIds(mediaKind);

  const phaseAFlavorIds = new Set<string>(getPhaseAVidkingFlavorIds());
  for (const flavorId of inventoryFlavorIds) {
    const sourceOptions = resolveFlavorEngineOptions(flavorId);
    if (!sourceOptions?.serverEndpoint) continue;
    const server = sourceOptions.serverEndpoint;
    const presentation = resolveVidkingPresentation(server, sourceOptions);
    const sid = vidkingSourceIdForPresentation(server, sourceOptions);
    const phase = phaseAFlavorIds.has(flavorId) ? "A" : "B";
    sources.push({
      id: sid,
      providerId: VIDKING_PROVIDER_ID,
      kind: "provider-api",
      label: presentation.themeLabel,
      host: "api.videasy.to",
      status: phase === "A" ? "probing" : "pending",
      confidence: phase === "A" ? 0.8 : 0.5,
      cachePolicy,
      metadata: {
        server,
        flavorId: presentation.flavorId,
        flavorArchetype: presentation.subtitle,
        flavorLabel: presentation.themeLabel,
        phase,
      },
    });
  }

  const embedReferer = buildEmbedReferer({
    tmdbId,
    mediaKind: input.mediaKind as "movie" | "series",
    season: input.episode?.season,
    episode: input.episode?.episode,
  });

  const cycleCandidates = buildVidkingCycleCandidates({
    directServers:
      exhaustiveFlavorIds.length > 0 || preferredFlavorIds.length > 0 ? [] : activeServers,
    embedServers:
      preferredFlavorIds.length > 0 || (phaseAOnly && !resolvedOptions.customReferer)
        ? []
        : embedReferer
          ? resolvedOptions.serverEndpoint
            ? [resolvedOptions.serverEndpoint]
            : exhaustiveFlavorIds.length > 0
              ? []
              : [...VIDKING_SERVERS]
          : [],
    flavorIds: exhaustiveFlavorIds.length > 0 ? exhaustiveFlavorIds : preferredFlavorIds,
    embedReferer: resolvedOptions.customReferer ?? embedReferer ?? undefined,
    engineOptions: resolvedOptions,
    preferredSourceId: input.preferredSourceId,
  });

  const resolveVidkingCycleCandidate = async (candidate: ProviderCycleCandidate) => {
    const metadata = parseVidkingCycleCandidateMetadata(candidate);
    const flavorOptions = metadata.flavorId
      ? (resolveFlavorEngineOptions(metadata.flavorId) ?? {})
      : {};
    const candidateOptions = vidkingEngineOptionsForEndpoint(metadata.server, {
      ...resolvedOptions,
      ...flavorOptions,
      flavorLabel: metadata.flavorLabel,
      flavorArchetype: metadata.flavorArchetype,
    });
    const failureStartIndex = failures.length;
    const result = await tryVidkingServer({
      server: metadata.server,
      tmdbId,
      input,
      cachePolicy,
      events,
      context,
      failures,
      startedAt,
      customReferer: metadata.customReferer,
      engineOptions: candidateOptions,
    });
    if (!result) {
      const candidateFailures = failures.slice(failureStartIndex);
      const sessionGuardFailure = candidateFailures.find((failure) =>
        isVideasySessionGuardMessage(failure.message),
      );
      if (sessionGuardFailure) {
        throw createProviderCycleFailureError(candidate, {
          failureClass: "candidate-blocked",
          message: sessionGuardFailure.message,
          retryable: false,
          at: sessionGuardFailure.at,
        });
      }
      throw createProviderCycleFailureError(candidate, {
        failureClass: "candidate-empty",
        message: `Videasy ${metadata.server} did not produce a playable source`,
        retryable: false,
        at: context.now(),
      });
    }
    return result;
  };

  let cycleResult = await runProviderCycle({
    providerId: VIDKING_PROVIDER_ID,
    candidates: cycleCandidates,
    signal: context.signal,
    now: context.now,
    maxAttemptsPerCandidate: 1,
    candidateTimeoutMs: VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS,
    shouldStopAfterFailure: (failure) =>
      failure.failureClass === "candidate-blocked" && isVideasySessionGuardMessage(failure.message),
    resolveCandidate: resolveVidkingCycleCandidate,
  });

  const shouldRetryWithEmbedReferer =
    !cycleResult.selected &&
    !cycleResult.cancelled &&
    phaseAOnly &&
    !resolvedOptions.customReferer &&
    !resolvedOptions.serverEndpoint &&
    preferredFlavorIds.length === 0 &&
    exhaustiveFlavorIds.length === 0 &&
    embedReferer;

  if (shouldRetryWithEmbedReferer) {
    const embedCandidates = buildVidkingCycleCandidates({
      directServers: [],
      embedServers: activeServers.length > 0 ? activeServers : [...VIDKING_SERVERS],
      flavorIds: [],
      embedReferer,
      engineOptions: resolvedOptions,
      preferredSourceId: input.preferredSourceId,
    });
    const embedCycleResult = await runProviderCycle({
      providerId: VIDKING_PROVIDER_ID,
      candidates: embedCandidates,
      signal: context.signal,
      now: context.now,
      maxAttemptsPerCandidate: 1,
      candidateTimeoutMs: VIDKING_CYCLE_CANDIDATE_TIMEOUT_MS,
      shouldStopAfterFailure: (failure) =>
        failure.failureClass === "candidate-blocked" &&
        isVideasySessionGuardMessage(failure.message),
      resolveCandidate: resolveVidkingCycleCandidate,
    });
    events.push(...embedCycleResult.events);
    if (embedCycleResult.selected) {
      cycleResult = embedCycleResult;
    } else if (!embedCycleResult.cancelled) {
      cycleResult = {
        ...cycleResult,
        attempts: [...cycleResult.attempts, ...embedCycleResult.attempts],
        events: [...cycleResult.events, ...embedCycleResult.events],
        stopReason: embedCycleResult.stopReason,
      };
    }
  }
  if (cycleResult.cancelled) {
    events.push(...cycleResult.events);
    return createExhaustedResult(
      input,
      context,
      VIDKING_PROVIDER_ID,
      {
        code: "cancelled",
        message: "VidKing source cycling was cancelled",
        retryable: false,
      },
      {
        cachePolicy,
        events,
        failures,
        sources: finalizeVidkingSourceInventory({
          sources,
          attempts: cycleResult.attempts,
        }),
        startedAt,
      },
    );
  }

  if (cycleResult.selected) {
    const resolved = withVidkingSourceInventory(
      { ...cycleResult.selected, failures: [] },
      sources,
      cycleResult.attempts,
    );
    return appendCycleEventsToResult(resolved, cycleResult.events);
  }

  events.push(...cycleResult.events);
  const cycleFailure = findLastCycleFailure(cycleResult.attempts);
  const failure = cycleFailure
    ? {
        code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
        message: cycleFailure.message,
        retryable: cycleFailure.retryable,
      }
    : {
        code: "not-found" as const,
        message: "VidKing direct resolver did not find a playable source",
        retryable: false,
      };

  return createExhaustedResult(input, context, VIDKING_PROVIDER_ID, failure, {
    cachePolicy,
    events,
    failures,
    sources: finalizeVidkingSourceInventory({
      sources,
      attempts: cycleResult.attempts,
    }),
    startedAt,
  });
}

function withVidkingSourceInventory(
  result: ProviderResolveResult,
  sources: readonly ProviderSourceCandidate[],
  attempts: readonly ProviderCycleAttempt[],
): ProviderResolveResult {
  return {
    ...result,
    sources: finalizeVidkingSourceInventory({
      sources,
      attempts,
      selectedSources: result.sources,
      streams: result.streams,
      selectedStreamId: result.selectedStreamId,
    }),
  };
}

export function finalizeVidkingSourceInventory({
  sources,
  attempts,
  selectedSources = [],
  streams = [],
  selectedStreamId,
}: {
  readonly sources: readonly ProviderSourceCandidate[];
  readonly attempts: readonly ProviderCycleAttempt[];
  readonly selectedSources?: readonly ProviderSourceCandidate[];
  readonly streams?: readonly StreamCandidate[];
  readonly selectedStreamId?: string;
}): ProviderSourceCandidate[] {
  return finalizeCycleSourceInventory({
    sources,
    attempts,
    selectedSources,
    streams,
    selectedStreamId,
  });
}

function buildVidkingCycleCandidates({
  directServers,
  embedServers,
  flavorIds,
  embedReferer,
  engineOptions,
  preferredSourceId,
}: {
  readonly directServers: readonly VidkingServerEndpoint[];
  readonly embedServers: readonly VidkingServerEndpoint[];
  readonly flavorIds?: readonly string[];
  readonly embedReferer?: string;
  readonly engineOptions: VidKingEngineOptions;
  readonly preferredSourceId?: string;
}): ProviderCycleCandidate[] {
  const candidates: ProviderCycleCandidate[] = [];
  for (const [index, flavorId] of (flavorIds ?? []).entries()) {
    const flavorOptions = resolveFlavorEngineOptions(flavorId);
    if (!flavorOptions?.serverEndpoint) continue;
    const sourceId = vidkingSourceIdForPresentation(flavorOptions.serverEndpoint, flavorOptions);
    candidates.push({
      id: `candidate:${sourceId}:direct`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      serverId: flavorOptions.serverEndpoint,
      label: flavorOptions.flavorLabel ?? flavorOptions.serverEndpoint,
      nativeLabel: flavorOptions.serverEndpoint,
      priority: index,
      metadata: {
        server: flavorOptions.serverEndpoint,
        flavorId,
        flavorLabel: flavorOptions.flavorLabel,
        flavorArchetype: flavorOptions.flavorArchetype,
        retryTier: "direct",
      } satisfies VidkingCycleCandidateMetadata,
    });
  }

  directServers.forEach((server, index) => {
    const perServerOptions = vidkingEngineOptionsForEndpoint(server, engineOptions);
    const sourceId = vidkingSourceIdForPresentation(server, perServerOptions);
    candidates.push({
      id: `candidate:${sourceId}:direct`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      serverId: server,
      label: perServerOptions.flavorLabel ?? server,
      nativeLabel: server,
      priority: index,
      metadata: {
        server,
        flavorId: perServerOptions.flavorId,
        flavorLabel: perServerOptions.flavorLabel,
        flavorArchetype: perServerOptions.flavorArchetype,
        retryTier: "direct",
      } satisfies VidkingCycleCandidateMetadata,
    });
  });

  if (!embedReferer) return prioritizePreferredSource(candidates, preferredSourceId);

  embedServers.forEach((server, index) => {
    const perServerOptions = vidkingEngineOptionsForEndpoint(server, engineOptions);
    const sourceId = `${vidkingSourceIdForPresentation(server, perServerOptions)}:embed-ref`;
    candidates.push({
      id: `candidate:${sourceId}:embed-referer`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      serverId: server,
      label: `${perServerOptions.flavorLabel ?? server} embed referer`,
      nativeLabel: server,
      priority: 100 + index,
      metadata: {
        server,
        customReferer: embedReferer,
        flavorId: perServerOptions.flavorId,
        flavorLabel: perServerOptions.flavorLabel,
        flavorArchetype: perServerOptions.flavorArchetype,
        retryTier: "embed-referer",
      } satisfies VidkingCycleCandidateMetadata,
    });
  });

  return prioritizePreferredSource(candidates, preferredSourceId);
}

function prioritizePreferredSource(
  candidates: readonly ProviderCycleCandidate[],
  preferredSourceId: string | undefined,
): ProviderCycleCandidate[] {
  if (!preferredSourceId) return [...candidates];
  return candidates.map((candidate) =>
    candidate.sourceId === preferredSourceId
      ? { ...candidate, priority: candidate.priority - 10_000 }
      : candidate,
  );
}

function parseVidkingCycleCandidateMetadata(
  candidate: ProviderCycleCandidate,
): VidkingCycleCandidateMetadata {
  const server = candidate.metadata?.server;
  if (typeof server !== "string") {
    throw createProviderCycleFailureError(candidate, {
      failureClass: "candidate-unsupported",
      message: `VidKing candidate ${candidate.id} is missing server metadata`,
      retryable: false,
      at: new Date().toISOString(),
    });
  }
  const customReferer = candidate.metadata?.customReferer;
  const flavorId = candidate.metadata?.flavorId;
  const flavorLabel = candidate.metadata?.flavorLabel;
  const flavorArchetype = candidate.metadata?.flavorArchetype;
  const retryTier = candidate.metadata?.retryTier;
  return {
    server,
    customReferer: typeof customReferer === "string" ? customReferer : undefined,
    flavorId: typeof flavorId === "string" ? flavorId : undefined,
    flavorLabel: typeof flavorLabel === "string" ? flavorLabel : undefined,
    flavorArchetype: typeof flavorArchetype === "string" ? flavorArchetype : undefined,
    retryTier: retryTier === "embed-referer" ? "embed-referer" : "direct",
  };
}

export function createVidkingResultFromPayload({
  input,
  cachePolicy,
  payload,
  sourceId,
  server,
  events = [],
  context,
  startedAt,
  failures = [],
  streamReferer,
  sourceQualityFilter,
  sourceDisplayLabel,
  flavorArchetype,
  engineOptions,
  streamReachabilityVerified,
}: {
  readonly input: ProviderResolveInput;
  readonly cachePolicy?: CachePolicy;
  readonly payload: VidkingPayload;
  readonly sourceId?: string;
  readonly server?: string;
  readonly events?: ProviderTraceEvent[];
  readonly context?: ProviderRuntimeContext;
  readonly startedAt?: string;
  readonly failures?: readonly ProviderFailure[];
  readonly streamReferer?: string;
  readonly sourceQualityFilter?: string;
  readonly sourceDisplayLabel?: string;
  readonly flavorArchetype?: string;
  readonly engineOptions?: VidKingEngineOptions;
  readonly streamReachabilityVerified?: boolean;
}): ProviderResolveResult | null {
  const policy =
    cachePolicy ??
    createProviderCachePolicy({
      providerId: VIDKING_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });
  const resolvedServer = (server as VidkingServer | undefined) ?? "mb-flix";
  const presentation = resolveVidkingPresentation(
    resolvedServer,
    engineOptions ?? {
      flavorLabel: sourceDisplayLabel,
      flavorArchetype,
      filterQuality: sourceQualityFilter,
    },
  );
  const resolvedSourceId =
    sourceId ??
    vidkingSourceIdForPresentation(
      resolvedServer,
      engineOptions ?? {
        flavorLabel: sourceDisplayLabel,
        flavorArchetype,
        filterQuality: sourceQualityFilter,
      },
    );
  const themedLabel = sourceDisplayLabel ?? presentation.themeLabel;
  const themedSubtitle = flavorArchetype ?? presentation.subtitle;
  const sourceEvidence = [
    createProviderSourceEvidence({
      sourceId: resolvedSourceId,
      serverId: server,
      nativeLabel: server ?? "Videasy",
      host: "api.videasy.to",
      confidence: 0.9,
      metadata: { flavorFilter: sourceQualityFilter },
    }),
  ];
  const streams = normalizeStreamCandidates({
    payload,
    input,
    cachePolicy: policy,
    sourceId: resolvedSourceId,
    server: resolvedServer,
    streamReferer,
    sourceQualityFilter,
    flavorLabel: themedLabel,
    serverName: themedLabel,
  });

  if (streams.length === 0) {
    return null;
  }

  const subtitles = normalizeSubtitleCandidates({
    payload,
    input,
    cachePolicy: policy,
    sourceId: resolvedSourceId,
  });
  const selection = selectReadyStream(streams, {
    startupPriority: input.startupPriority,
    qualityPreference: input.qualityPreference,
    preferredStreamId: input.preferredStreamId,
    preferredSourceId: input.preferredSourceId,
    favoriteSourceNames: input.favoriteSourceNames,
  });
  const selectedStream = selection.selected;
  const orderedSubtitles = orderSubtitleCandidates(
    subtitles,
    input.preferredSubtitleLanguage ?? "en",
  );
  const variants = createVariantCandidates({
    streams,
    subtitles: orderedSubtitles,
    selectedStreamId: selectedStream.id,
    sourceId: resolvedSourceId,
    sourceEvidence,
  });

  emitTraceEvent(events, context, {
    type: "source:success",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    message: `Videasy server ${server ?? "unknown"} returned playable candidates`,
    attributes: {
      streams: streams.length,
      subtitles: orderedSubtitles.length,
    },
  });
  emitTraceEvent(events, context, {
    type: "variant:selected",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    variantId: selectedStream.variantId,
    streamId: selectedStream.id,
    message: `Selected ${selectedStream.qualityLabel ?? "unknown"} VidKing stream`,
  });

  const selectedSubtitle = orderedSubtitles[0];
  if (selectedSubtitle) {
    emitTraceEvent(events, context, {
      type: "subtitle:selected",
      providerId: VIDKING_PROVIDER_ID,
      sourceId: resolvedSourceId,
      subtitleId: selectedSubtitle.id,
      message: `Selected ${selectedSubtitle.label ?? selectedSubtitle.language ?? "subtitle"} subtitle`,
    });
  }

  emitTraceEvent(events, context, {
    type: "provider:success",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    streamId: selectedStream.id,
    message: "VidKing direct resolver produced a stream",
  });

  const endedAt = context?.now() ?? new Date().toISOString();

  return {
    status: "resolved",
    providerId: VIDKING_PROVIDER_ID,
    selectedStreamId: selectedStream.id,
    selectionDecision: selection.decision,
    streamReachabilityVerified: streamReachabilityVerified === true ? true : undefined,
    sources: [
      {
        id: resolvedSourceId,
        providerId: VIDKING_PROVIDER_ID,
        kind: "provider-api",
        label: themedLabel,
        host: "api.videasy.to",
        status: "selected",
        confidence: 0.9,
        requiresRuntime: "direct-http",
        cachePolicy: policy,
        sourceEvidence,
        metadata: {
          server: resolvedServer,
          flavorId: presentation.flavorId,
          flavorArchetype: themedSubtitle,
          flavorLabel: themedLabel,
        },
      },
    ],
    variants,
    streams,
    subtitles: orderedSubtitles,
    cachePolicy: policy,
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId: VIDKING_PROVIDER_ID,
      streamId: selectedStream.id,
      cacheHit: false,
      runtime: "direct-http",
      startedAt,
      endedAt,
      steps: [
        createTraceStep("provider", "Resolved VidKing through direct Videasy payload", {
          providerId: VIDKING_PROVIDER_ID,
          attributes: {
            source: resolvedServer,
            sourceLabel: themedLabel,
            flavorId: presentation.flavorId ?? null,
            streams: streams.length,
            subtitles: orderedSubtitles.length,
          },
        }),
      ],
      events,
      failures,
    }),
    failures,
    healthDelta: {
      providerId: VIDKING_PROVIDER_ID,
      outcome: "success",
      at: endedAt,
    },
  };
}

type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

function createVideasyFetchSignal(
  signal: AbortSignal | undefined,
  timeoutMs = VIDKING_VIDEASY_FETCH_TIMEOUT_MS,
): AbortSignal {
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (!signal) return AbortSignal.timeout(timeoutMs);
  return abortSignal.any ? abortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal;
}

function isVideasyTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return error.message.includes("timeout") || error.message.includes("timed out");
  }
  return /timed out|timeout/i.test(error.message);
}

async function fetchVideasyPayload({
  server,
  query,
  fetchPort,
  signal,
  customReferer,
  sessionToken,
  appId,
}: {
  readonly server: VidkingServerEndpoint;
  readonly query: URLSearchParams;
  readonly fetchPort?: ProviderFetchPort;
  readonly signal?: AbortSignal;
  readonly customReferer?: string;
  readonly sessionToken?: string;
  readonly appId?: string;
}): Promise<Response> {
  const requester = fetchPort?.fetch.bind(fetchPort) ?? fetch;
  const headers = new Headers({
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: VIDKING_ORIGIN,
    referer: customReferer ?? VIDKING_REFERER,
    "user-agent": USER_AGENT,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  });
  if (sessionToken) {
    headers.set("x-app-id", normalizeVideasyAppId(appId));
    headers.set("x-session-token", sessionToken);
  }

  return requester(`${VIDKING_API_BASE}/${server}/sources-with-title?${query.toString()}`, {
    signal: createVideasyFetchSignal(signal),
    headers,
  });
}

function normalizeVideasyAppId(value: string | undefined): string {
  const appId = value?.trim();
  return appId || VIDEASY_APP_ID;
}

/**
 * Tier 2: Scrape the embed page for already-decrypted HLS URL + subtitles.
 * Used as fallback when the Videasy API is blocked (Cloudflare, timeout, etc.).
 */
function buildEmbedReferer(options: {
  readonly tmdbId: number;
  readonly mediaKind: "movie" | "series";
  readonly season?: number;
  readonly episode?: number;
}): string | null {
  const { tmdbId, mediaKind, season, episode } = options;

  if (mediaKind === "series" && (!season || !episode)) return null;

  return mediaKind === "series"
    ? `https://www.vidking.net/embed/tv/${tmdbId}/${season}/${episode}?autoPlay=true&episodeSelector=false&nextEpisode=false`
    : `https://www.vidking.net/embed/movie/${tmdbId}?autoPlay=true`;
}

async function probeSelectedVidkingPayloadStream({
  decoded,
  input,
  cachePolicy,
  sourceId,
  server,
  streamReferer,
  sourceQualityFilter,
  engineOptions,
  events,
  context,
}: {
  readonly decoded: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
  readonly server: VidkingServerEndpoint;
  readonly streamReferer?: string;
  readonly sourceQualityFilter?: string;
  readonly engineOptions?: VidKingEngineOptions;
  readonly events: ProviderTraceEvent[];
  readonly context: ProviderRuntimeContext;
}): Promise<boolean> {
  const presentation = resolveVidkingPresentation(server, engineOptions ?? {});
  const streams = normalizeStreamCandidates({
    payload: decoded,
    input,
    cachePolicy,
    sourceId,
    server,
    streamReferer,
    sourceQualityFilter,
    flavorLabel: presentation.themeLabel,
    serverName: presentation.themeLabel,
  });
  if (streams.length === 0) {
    return false;
  }

  const selection = selectReadyStream(streams, {
    startupPriority: input.startupPriority,
    qualityPreference: input.qualityPreference,
    preferredStreamId: input.preferredStreamId,
    preferredSourceId: input.preferredSourceId,
    favoriteSourceNames: input.favoriteSourceNames,
  });
  const selected = selection.selected;
  const streamUrl = selected.url?.trim();
  if (!streamUrl) {
    return false;
  }

  const probeStartedAt = Date.now();
  const health = await runStreamHealthCheck({
    phase: "resolve-gate",
    url: streamUrl,
    headers: selected.headers,
    fetchImpl: context.fetch?.fetch.bind(context.fetch),
    timeoutMs: STREAM_HEALTH_DEFAULTS.vidkingResolveGateTimeoutMs,
    signal: context.signal,
  });
  const probeDurationMs = Date.now() - probeStartedAt;

  if (health.healthy) {
    return true;
  }

  const probe = health.probe;
  const reason =
    probe?.status === "timeout"
      ? "stream probe timed out"
      : probe?.status === "unreachable"
        ? probe.reason
        : "stream probe failed";

  emitTraceEvent(events, context, {
    type: "source:failed",
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    streamId: selected.id,
    message: `${presentation.themeLabel} decoded sources but selected stream is unreachable`,
    durationMs: probeDurationMs,
    attributes: {
      server,
      reason,
      quality: selected.qualityLabel ?? null,
      probe: probe?.status ?? "failed",
    },
  });
  return false;
}

/**
 * Probe a single VidKing server with all query variants and retries.
 * Runs sequentially internally but multiple servers are fired in parallel.
 */
async function tryVidkingServer(opts: {
  readonly server: VidkingServerEndpoint;
  readonly tmdbId: number;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly events: ProviderTraceEvent[];
  readonly context: ProviderRuntimeContext;
  readonly failures: ProviderFailure[];
  readonly startedAt: string;
  readonly customReferer?: string;
  readonly engineOptions?: VidKingEngineOptions;
}): Promise<ProviderResolveResult | null> {
  const {
    server,
    tmdbId,
    input,
    cachePolicy,
    events,
    context,
    failures,
    startedAt,
    customReferer,
    engineOptions = {},
  } = opts;
  const presentation = resolveVidkingPresentation(server, engineOptions);
  const sourceId = customReferer
    ? `${vidkingSourceIdForPresentation(server, engineOptions)}:embed-ref`
    : vidkingSourceIdForPresentation(server, engineOptions);
  const sessionToken = resolveVideasySessionToken(engineOptions, context);
  const appId = resolveVideasyAppId(engineOptions, context);

  emitTraceEvent(events, context, {
    type: "source:start",
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    message: customReferer
      ? `Retrying ${presentation.themeLabel} with embed referer`
      : `Trying Videasy source ${presentation.themeLabel}`,
  });

  const queries = buildQueryVariants({
    title: input.title,
    mediaKind: input.mediaKind as "movie" | "series",
    tmdbId,
    episode: input.episode,
    language: engineOptions.language,
    singleVariant: !customReferer,
  });
  const maxAttempts = customReferer ? Math.max(1, context.retryPolicy?.maxAttempts ?? 2) : 1;

  for (const query of queries) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchVideasyPayload({
          server,
          query,
          fetchPort: context.fetch,
          signal: context.signal,
          customReferer,
          sessionToken,
          appId,
        });

        if (!response.ok) {
          vidkingHealth.recordFailure(server);
          const statusCode = response.status;
          const body = await safeReadResponseText(response);
          const providerError = parseVideasyErrorPayload(body);
          const guardedFailure = createVideasyGuardFailure(providerError, context);
          if (guardedFailure) {
            failures.push(guardedFailure);
            emitRetryIfNeeded(events, context, guardedFailure, sourceId, attempt, maxAttempts);
            break;
          }
          const nonRetryableStatus =
            statusCode === 401 ||
            statusCode === 403 ||
            statusCode === 404 ||
            statusCode === 500 ||
            statusCode >= 502;
          const f: ProviderFailure = {
            providerId: VIDKING_PROVIDER_ID,
            code: vidkingStatusToFailureCode(statusCode),
            message: `Videasy ${server} returned HTTP ${statusCode}`,
            retryable: !nonRetryableStatus,
            at: context.now(),
          };
          failures.push(f);
          emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
          if (!isRetryableFailure(context, f)) {
            break;
          }
          continue;
        }

        const payload = (await response.text()).trim();
        if (!payload) {
          vidkingHealth.recordFailure(server);
          const f: ProviderFailure = {
            providerId: VIDKING_PROVIDER_ID,
            code: "not-found",
            message: `Videasy ${server} empty payload`,
            retryable: false,
            at: context.now(),
          };
          failures.push(f);
          emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
          continue;
        }

        const providerError = parseVideasyErrorPayload(payload);
        const guardedFailure = createVideasyGuardFailure(providerError, context);
        if (guardedFailure) {
          vidkingHealth.recordFailure(server);
          failures.push(guardedFailure);
          emitRetryIfNeeded(events, context, guardedFailure, sourceId, attempt, maxAttempts);
          break;
        }

        const decodedPayload = await decodeVideasyGuardedPayload(payload, sessionToken);
        const decoded = await decodeVidkingPayload(decodedPayload, tmdbId);
        const streamReferer = customReferer ?? VIDKING_REFERER;
        const streamVerified = await probeSelectedVidkingPayloadStream({
          decoded,
          input,
          cachePolicy,
          sourceId,
          server,
          streamReferer,
          sourceQualityFilter: engineOptions.filterQuality,
          engineOptions,
          events,
          context,
        });
        if (!streamVerified) {
          vidkingHealth.recordFailure(server);
          break;
        }

        const result = createVidkingResultFromPayload({
          input,
          cachePolicy,
          payload: decoded,
          sourceId,
          server,
          events,
          context,
          startedAt,
          failures,
          streamReferer,
          sourceQualityFilter: engineOptions.filterQuality,
          engineOptions,
          streamReachabilityVerified: true,
        });
        if (result) {
          vidkingHealth.recordSuccess(server);
          return result;
        }

        const f: ProviderFailure = {
          providerId: VIDKING_PROVIDER_ID,
          code: "not-found",
          message: `Videasy ${server} no playable streams`,
          retryable: false,
          at: context.now(),
        };
        failures.push(f);
        emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
      } catch (error) {
        vidkingHealth.recordFailure(server);
        if (context.signal?.aborted) throw error;
        const timedOut = isVideasyTimeoutError(error);
        const f: ProviderFailure = {
          providerId: VIDKING_PROVIDER_ID,
          code: timedOut ? "timeout" : "parse-failed",
          message: error instanceof Error ? error.message : "VidKing payload decode failed",
          retryable: false,
          at: context.now(),
        };
        failures.push(f);
        emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
      }
    }
  }

  emitTraceEvent(events, context, {
    type: "source:failed",
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    message: `Server ${server} did not produce a playable source`,
  });
  return null;
}

function resolveVideasySessionToken(
  engineOptions: VidKingEngineOptions,
  context: ProviderRuntimeContext,
): string | undefined {
  return (
    engineOptions.sessionToken?.trim() ||
    context.auth?.getSecret(VIDKING_PROVIDER_ID, "videasySessionToken")?.trim() ||
    process.env.KUNAI_VIDEASY_SESSION_TOKEN?.trim() ||
    undefined
  );
}

function resolveVideasyAppId(
  engineOptions: VidKingEngineOptions,
  context: ProviderRuntimeContext,
): string {
  return (
    engineOptions.appId?.trim() ||
    context.auth?.getSecret(VIDKING_PROVIDER_ID, "videasyAppId")?.trim() ||
    VIDEASY_APP_ID
  );
}

function isVideasySessionGuardMessage(message: string): boolean {
  return /session_missing|session_invalid|session_expired|turnstile_failed|guarded_session_invalid|valid browser session/i.test(
    message,
  );
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function parseVideasyErrorPayload(payload: string): VideasyErrorPayload | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as VideasyErrorPayload;
    return typeof parsed.error === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function createVideasyGuardFailure(
  payload: VideasyErrorPayload | null,
  context: ProviderRuntimeContext,
): ProviderFailure | null {
  if (!payload?.error) return null;
  const error = payload.error;
  const blockedErrors = new Set([
    "session_missing",
    "session_invalid",
    "session_expired",
    "turnstile_failed",
    "guarded_session_invalid",
  ]);
  if (!blockedErrors.has(error)) return null;
  const details = payload.codes?.length ? ` (${payload.codes.join(", ")})` : "";
  return {
    providerId: VIDKING_PROVIDER_ID,
    code: error === "session_expired" ? "expired" : "blocked",
    message: `Videasy requires a valid browser session: ${error}${details}. Set one in Kunai settings or KUNAI_VIDEASY_SESSION_TOKEN.`,
    retryable: false,
    at: context.now(),
  };
}

export async function decodeVideasyGuardedPayload(
  payload: string,
  sessionToken: string | undefined,
): Promise<string> {
  if (!payload.startsWith("v2:")) return payload;
  if (!sessionToken) {
    throw new Error("Videasy guarded payload requires a session token");
  }
  const { default: CryptoJS } = await import("crypto-js");
  const key = CryptoJS.SHA256(`g:${sessionToken}`).toString();
  const decrypted = CryptoJS.AES.decrypt(payload.slice(3), key).toString(CryptoJS.enc.Utf8);
  if (!decrypted) {
    throw new Error("Videasy guarded session payload could not be decrypted");
  }
  return decrypted;
}

async function loadWasmExports(): Promise<WasmExports> {
  if (wasmExportsPromise) {
    return wasmExportsPromise;
  }

  wasmExportsPromise = (async () => {
    const loader = await import("@assemblyscript/loader");
    const wasmBuffer = await Bun.file(
      new URL("./assets/module1_patched.wasm", import.meta.url),
    ).arrayBuffer();
    const module = await loader.instantiate(wasmBuffer, {
      env: {
        seed: () => Date.now(),
        abort: () => {},
      },
    });

    return module.exports as unknown as WasmExports;
  })();

  return await wasmExportsPromise;
}

export async function decodeVidkingPayload(
  payload: string,
  tmdbId: number,
): Promise<VidkingPayload> {
  return await withWasmDecodeLock(async () => {
    const wasm = await loadWasmExports();
    const payloadPtr = wasm.__newString(payload);
    const decryptedPtr = wasm.decrypt(payloadPtr, tmdbId);
    const wasmDecryptedBase64 = wasm.__getString(decryptedPtr);
    const { default: CryptoJS } = await import("crypto-js");
    const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedBase64, "");
    const finalJson = decryptedBytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(finalJson) as VidkingPayload;
  });
}

async function withWasmDecodeLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = wasmDecodeQueue;
  let release!: () => void;
  wasmDecodeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    release();
  }
}

function normalizeStreamCandidates({
  payload,
  input,
  cachePolicy,
  sourceId,
  server,
  streamReferer = VIDKING_REFERER,
  streamOrigin = VIDKING_ORIGIN,
  sourceQualityFilter,
  flavorLabel,
  serverName,
}: {
  readonly payload: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
  readonly server?: string;
  readonly streamReferer?: string;
  readonly streamOrigin?: string;
  readonly sourceQualityFilter?: string;
  readonly flavorLabel?: string;
  readonly serverName?: string;
}): StreamCandidate[] {
  const seen = new Set<string>();
  const streams: StreamCandidate[] = [];
  const normalizedFilter = sourceQualityFilter?.trim().toLowerCase();
  const payloadSources = normalizedFilter
    ? (payload.sources ?? []).filter((source) =>
        [source.quality, source.language, source.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedFilter),
      )
    : (payload.sources ?? []);

  for (const source of payloadSources) {
    if (!source.url || seen.has(source.url)) {
      continue;
    }
    seen.add(source.url);

    const qualityLabel = normalizeQualityLabel(source.quality);
    const qualityRank = qualityRankFromLabel(source.quality) ?? 0;
    const streamId = createStreamId(VIDKING_PROVIDER_ID, [source.url]);
    const variantId = createVariantId(VIDKING_PROVIDER_ID, [sourceId, qualityLabel, source.url]);
    const protocol = inferProtocol(source.url);
    const normalizedAudioLanguage = normalizeVidkingAudioLanguage(source, sourceQualityFilter);
    const languageEvidence = normalizedAudioLanguage
      ? [
          createProviderLanguageEvidence({
            role: "audio" as const,
            value: normalizedAudioLanguage,
            nativeLabel: source.language ?? sourceQualityFilter ?? source.quality,
            sourceId,
            confidence: source.language ? 0.85 : 0.65,
            metadata: {
              server,
              quality: source.quality,
              flavorFilter: sourceQualityFilter,
            },
          }),
        ]
      : undefined;
    const sourceEvidence = [
      createProviderSourceEvidence({
        sourceId,
        serverId: server,
        nativeLabel: server ?? "Videasy",
        host: "api.videasy.to",
        confidence: 0.9,
        metadata: { quality: source.quality, flavorFilter: sourceQualityFilter },
      }),
    ];

    streams.push({
      id: streamId,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      variantId,
      flavorLabel,
      serverName: serverName ?? server,
      url: source.url,
      protocol,
      container:
        protocol === "hls"
          ? "m3u8"
          : protocol === "dash"
            ? "mpd"
            : protocol === "mp4"
              ? "mp4"
              : "unknown",
      audioLanguages: normalizedAudioLanguage ? [normalizedAudioLanguage] : undefined,
      qualityLabel,
      qualityRank,
      languageEvidence,
      sourceEvidence,
      headers: {
        referer: streamReferer,
        origin: streamOrigin,
        "user-agent": USER_AGENT,
      },
      confidence: qualityRank > 0 ? 0.92 : 0.82,
      cachePolicy,
      metadata: {
        server,
        mediaKind: input.mediaKind,
        title: input.title.title,
        flavorFilter: sourceQualityFilter,
      },
    });
  }

  return streams.sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0));
}

function normalizeSubtitleCandidates({
  payload,
  input,
  cachePolicy,
  sourceId,
}: {
  readonly payload: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
}): SubtitleCandidate[] {
  const seen = new Set<string>();
  const subtitles: SubtitleCandidate[] = [];

  for (const subtitle of payload.subtitles ?? []) {
    const url = subtitle.url ?? subtitle.src ?? subtitle.file ?? subtitle.href;
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const language = normalizeIsoLanguageCode(subtitle.lang ?? subtitle.language ?? subtitle.label);
    subtitles.push({
      id: `subtitle:${VIDKING_PROVIDER_ID}:${hashId(url)}`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      url,
      language,
      label: subtitle.language ?? subtitle.label ?? subtitle.lang?.toUpperCase(),
      format: inferSubtitleFormat(url),
      source: "provider",
      confidence: looksLikeHiSubtitle(
        subtitle.language ?? subtitle.label,
        subtitle.release,
        subtitle.lang ?? subtitle.language,
      )
        ? 0.7
        : 0.88,
      syncEvidence: subtitle.release,
      cachePolicy: {
        ...cachePolicy,
        ttlClass: "subtitle-list",
        keyParts: [
          ...cachePolicy.keyParts,
          "subtitles",
          input.preferredSubtitleLanguage ?? "default",
        ],
      },
    });
  }

  return subtitles;
}

function createVariantCandidates({
  streams,
  subtitles,
  selectedStreamId,
  sourceId,
  sourceEvidence,
}: {
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly selectedStreamId: string;
  readonly sourceId: string;
  readonly sourceEvidence?: StreamCandidate["sourceEvidence"];
}): ProviderVariantCandidate[] {
  return streams.map((stream) => ({
    ...createVariantCandidateFromStream({
      providerId: VIDKING_PROVIDER_ID,
      stream: {
        ...stream,
        sourceId,
        sourceEvidence: stream.sourceEvidence ?? sourceEvidence,
        subtitleLanguages: subtitles
          .map((subtitle) => subtitle.language)
          .filter((language): language is string => Boolean(language)),
      },
      subtitles,
      selected: stream.id === selectedStreamId,
      label: stream.qualityLabel ?? stream.container ?? "unknown",
    }),
    subtitleIds: subtitles.map((subtitle) => subtitle.id),
  }));
}

function orderSubtitleCandidates(
  subtitles: readonly SubtitleCandidate[],
  preferredLanguage: string,
): SubtitleCandidate[] {
  if (subtitles.length === 0 || preferredLanguage === "none") {
    return [...subtitles];
  }

  const normalizedPreference = normalizeIsoLanguageCode(preferredLanguage);
  return [...subtitles].sort((left, right) => {
    const leftLang = left.language ? normalizeIsoLanguageCode(left.language) : undefined;
    const rightLang = right.language ? normalizeIsoLanguageCode(right.language) : undefined;
    const langDelta =
      Number(leftLang === normalizedPreference) - Number(rightLang === normalizedPreference);
    if (langDelta !== 0) return -langDelta;

    const hiDelta =
      Number(looksLikeHiSubtitle(left.label, left.syncEvidence)) -
      Number(looksLikeHiSubtitle(right.label, right.syncEvidence));
    if (hiDelta !== 0) return hiDelta;

    return right.confidence - left.confidence;
  });
}

function buildQueryVariants(opts: {
  readonly title: TitleIdentity;
  readonly mediaKind: "movie" | "series";
  readonly tmdbId: number;
  readonly episode?: EpisodeIdentity;
  readonly language?: string;
  readonly singleVariant?: boolean;
}): URLSearchParams[] {
  const base = new URLSearchParams({
    title: opts.title.title,
    mediaType: opts.mediaKind === "series" ? "tv" : "movie",
    tmdbId: String(opts.tmdbId),
    _t: String(Date.now()),
  });

  if (!opts.title.tmdbId && opts.title.year) {
    base.set("year", String(opts.title.year));
  }
  if (opts.title.imdbId) {
    base.set("imdbId", opts.title.imdbId);
  }

  if (opts.language) {
    base.set("language", opts.language);
  }

  if (opts.mediaKind === "series") {
    if (!opts.episode?.season || !opts.episode.episode) {
      return [];
    }
    base.set("seasonId", String(opts.episode.season));
    base.set("episodeId", String(opts.episode.episode));
  }

  if (opts.singleVariant) {
    return [base];
  }

  const variants: URLSearchParams[] = [];
  if (!opts.title.tmdbId && opts.title.year) {
    const withYear = new URLSearchParams(base);
    withYear.set("year", String(opts.title.year));
    variants.push(withYear);
  }

  variants.push(base);
  return variants;
}

function emitRetryIfNeeded(
  events: ProviderTraceEvent[],
  context: ProviderRuntimeContext,
  failure: ProviderFailure,
  sourceId: string,
  attempt: number,
  maxAttempts: number,
): void {
  if (!isRetryableFailure(context, failure) || attempt >= maxAttempts) {
    return;
  }

  emitTraceEvent(events, context, {
    type: "retry:scheduled",
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    attempt: attempt + 1,
    message: `Retrying VidKing source after ${failure.code}`,
    attributes: {
      previousAttempt: attempt,
      maxAttempts,
      code: failure.code,
      retryable: failure.retryable,
    },
  });
}

function isRetryableFailure(context: ProviderRuntimeContext, failure: ProviderFailure): boolean {
  if (!failure.retryable) return false;
  const retryableCodes = context.retryPolicy?.retryableCodes;
  return !retryableCodes || retryableCodes.includes(failure.code);
}

function resolveTmdbId(title: TitleIdentity): number | null {
  const raw = title.tmdbId ?? title.id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVidkingAudioLanguage(
  source: VidkingSourcePayload,
  sourceQualityFilter: string | undefined,
): string | undefined {
  return normalizeLanguageCode(
    source.language ??
      inferLanguageLabel(sourceQualityFilter) ??
      inferLanguageLabel(source.quality),
  );
}

function inferLanguageLabel(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("hindi")) return "hindi";
  if (normalized.includes("german")) return "german";
  if (normalized.includes("spanish")) return "spanish";
  if (normalized.includes("english")) return "english";
  return undefined;
}

function createSourceId(server: VidkingServer | string): string {
  return vidkingSourceIdForEndpoint(server);
}

function inferProtocol(url: string): StreamCandidate["protocol"] {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4")) return "mp4";
  return "unknown";
}

function vidkingStatusToFailureCode(status: number): ProviderFailure["code"] {
  if (status === 408 || status === 504) return "timeout";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  return "network-error";
}

function inferSubtitleFormat(url: string): SubtitleCandidate["format"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".ass")) return "ass";
  return "unknown";
}

function hashId(value: string): string {
  return Bun.hash(value).toString(36);
}
