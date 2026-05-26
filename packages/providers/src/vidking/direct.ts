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
  normalizeProviderDisplayLabel,
  qualityRankFromLabel,
  normalizeQualityLabel,
} from "../shared/source-inventory";
import { looksLikeHiSubtitle, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { vidkingManifest, VIDKING_PROVIDER_ID } from "./manifest";

export { VIDKING_PROVIDER_ID };
export const VIDKING_REFERER = "https://www.vidking.net/";
export const VIDKING_ORIGIN = "https://www.vidking.net";
export const VIDKING_API_BASE = "https://api.videasy.net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIDKING_SERVERS = ["mb-flix", "cdn", "downloader2", "1movies"] as const;

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
  readonly flavorLabel?: string;
  readonly flavorArchetype?: string;
  readonly retryTier: "direct" | "embed-referer";
};

export interface VidKingEngineOptions {
  readonly serverEndpoint?: VidkingServerEndpoint;
  readonly language?: string;
  readonly filterQuality?: string;
  readonly flavorLabel?: string;
  readonly flavorArchetype?: string;
  readonly customReferer?: string;
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
      retryable: true,
    });
  },
};

export async function resolveVidkingDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
  engineOptions: VidKingEngineOptions = {},
): Promise<ProviderResolveResult | null> {
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

  let activeServers: VidkingServerEndpoint[] = VIDKING_SERVERS.filter((s) =>
    vidkingHealth.shouldTry(s),
  );

  // Flavor wrappers can target a specific Videasy-compatible endpoint.
  if (engineOptions?.serverEndpoint) {
    activeServers = [engineOptions.serverEndpoint];
  }

  if (activeServers.length === 0) {
    emitTraceEvent(events, context, {
      type: "source:skipped",
      providerId: VIDKING_PROVIDER_ID,
      sourceId: createSourceId("all"),
      message: "All servers in cooldown, skipping Tier 1",
    });
  }

  for (const server of activeServers) {
    const sid = createSourceId(server);
    sources.push({
      id: sid,
      providerId: VIDKING_PROVIDER_ID,
      kind: "provider-api",
      label: engineOptions?.flavorLabel ?? server,
      host: "api.videasy.net",
      status: "probing",
      confidence: 0.8,
      cachePolicy,
      metadata: { server, flavorArchetype: engineOptions?.flavorArchetype },
    });
  }

  const embedReferer = buildEmbedReferer({
    tmdbId,
    mediaKind: input.mediaKind as "movie" | "series",
    season: input.episode?.season,
    episode: input.episode?.episode,
  });

  const cycleCandidates = buildVidkingCycleCandidates({
    directServers: activeServers,
    embedServers: embedReferer
      ? engineOptions.serverEndpoint
        ? [engineOptions.serverEndpoint]
        : VIDKING_SERVERS
      : [],
    embedReferer: engineOptions.customReferer ?? embedReferer ?? undefined,
    engineOptions,
    preferredSourceId: input.preferredSourceId,
  });

  const cycleResult = await runProviderCycle({
    providerId: VIDKING_PROVIDER_ID,
    candidates: cycleCandidates,
    signal: context.signal,
    now: context.now,
    maxAttemptsPerCandidate: 1,
    candidateTimeoutMs: 20_000,
    resolveCandidate: async (candidate) => {
      const metadata = parseVidkingCycleCandidateMetadata(candidate);
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
        engineOptions,
      });
      if (!result) {
        throw createProviderCycleFailureError(candidate, {
          failureClass: "candidate-empty",
          message: `Videasy ${metadata.server} did not produce a playable source`,
          retryable: true,
          at: context.now(),
        });
      }
      return result;
    },
  });
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
        sources,
        startedAt,
      },
    );
  }

  if (cycleResult.selected) {
    return appendCycleEventsToResult(cycleResult.selected, cycleResult.events);
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
        retryable: true,
      };

  return createExhaustedResult(input, context, VIDKING_PROVIDER_ID, failure, {
    cachePolicy,
    events,
    failures,
    sources,
    startedAt,
  });
}

function buildVidkingCycleCandidates({
  directServers,
  embedServers,
  embedReferer,
  engineOptions,
  preferredSourceId,
}: {
  readonly directServers: readonly VidkingServerEndpoint[];
  readonly embedServers: readonly VidkingServerEndpoint[];
  readonly embedReferer?: string;
  readonly engineOptions: VidKingEngineOptions;
  readonly preferredSourceId?: string;
}): ProviderCycleCandidate[] {
  const candidates: ProviderCycleCandidate[] = [];
  directServers.forEach((server, index) => {
    const sourceId = createSourceId(server);
    candidates.push({
      id: `candidate:${sourceId}:direct`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      serverId: server,
      label: displayVidkingServerLabel(server, engineOptions),
      nativeLabel: server,
      priority: index,
      metadata: {
        server,
        flavorLabel: engineOptions.flavorLabel,
        flavorArchetype: engineOptions.flavorArchetype,
        retryTier: "direct",
      } satisfies VidkingCycleCandidateMetadata,
    });
  });

  if (!embedReferer) return prioritizePreferredSource(candidates, preferredSourceId);

  embedServers.forEach((server, index) => {
    const sourceId = createSourceId(`${server}-embed-ref`);
    candidates.push({
      id: `candidate:${sourceId}:embed-referer`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      serverId: server,
      label: `${displayVidkingServerLabel(server, engineOptions)} embed referer`,
      nativeLabel: server,
      priority: 100 + index,
      metadata: {
        server,
        customReferer: embedReferer,
        flavorLabel: engineOptions.flavorLabel,
        flavorArchetype: engineOptions.flavorArchetype,
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
  const flavorLabel = candidate.metadata?.flavorLabel;
  const flavorArchetype = candidate.metadata?.flavorArchetype;
  const retryTier = candidate.metadata?.retryTier;
  return {
    server,
    customReferer: typeof customReferer === "string" ? customReferer : undefined,
    flavorLabel: typeof flavorLabel === "string" ? flavorLabel : undefined,
    flavorArchetype: typeof flavorArchetype === "string" ? flavorArchetype : undefined,
    retryTier: retryTier === "embed-referer" ? "embed-referer" : "direct",
  };
}

function displayVidkingServerLabel(
  server: VidkingServerEndpoint,
  engineOptions: VidKingEngineOptions,
): string {
  return engineOptions.flavorLabel?.trim() || normalizeProviderDisplayLabel(server) || server;
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
  const resolvedSourceId =
    sourceId ?? createSourceId((server as VidkingServer | undefined) ?? "mb-flix");
  const sourceEvidence = [
    createProviderSourceEvidence({
      sourceId: resolvedSourceId,
      serverId: server,
      nativeLabel: server ?? "Videasy",
      host: "api.videasy.net",
      confidence: 0.9,
      metadata: { flavorFilter: sourceQualityFilter },
    }),
  ];
  const streams = normalizeStreamCandidates({
    payload,
    input,
    cachePolicy: policy,
    sourceId: resolvedSourceId,
    server,
    streamReferer,
    sourceQualityFilter,
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
  const selectedStream = selectStreamCandidate(streams, input.qualityPreference);
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
    sources: [
      {
        id: resolvedSourceId,
        providerId: VIDKING_PROVIDER_ID,
        kind: "provider-api",
        label: sourceDisplayLabel ?? server ?? "Videasy",
        host: "api.videasy.net",
        status: "selected",
        confidence: 0.9,
        requiresRuntime: "direct-http",
        cachePolicy: policy,
        sourceEvidence,
        metadata: { server, flavorArchetype },
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
            source: server ?? null,
            sourceLabel: sourceDisplayLabel ?? null,
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

async function fetchVideasyPayload({
  server,
  query,
  fetchPort,
  signal,
  customReferer,
}: {
  readonly server: VidkingServerEndpoint;
  readonly query: URLSearchParams;
  readonly fetchPort?: ProviderFetchPort;
  readonly signal?: AbortSignal;
  readonly customReferer?: string;
}): Promise<Response> {
  const requester = fetchPort?.fetch.bind(fetchPort) ?? fetch;
  return requester(`${VIDKING_API_BASE}/${server}/sources-with-title?${query.toString()}`, {
    signal: signal ?? AbortSignal.timeout(12_000),
    headers: {
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
    },
  });
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
  const sourceId = createSourceId(customReferer ? `${server}-embed-ref` : server);

  emitTraceEvent(events, context, {
    type: "source:start",
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    message: customReferer
      ? `Retrying ${server} with embed referer`
      : `Trying Videasy server ${server}`,
  });

  const queries = buildQueryVariants({
    title: input.title,
    mediaKind: input.mediaKind as "movie" | "series",
    tmdbId,
    episode: input.episode,
    language: engineOptions.language,
  });
  const maxAttempts = Math.max(1, context.retryPolicy?.maxAttempts ?? 2);

  for (const query of queries) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchVideasyPayload({
          server,
          query,
          fetchPort: context.fetch,
          signal: context.signal,
          customReferer,
        });

        if (!response.ok) {
          vidkingHealth.recordFailure(server);
          const f: ProviderFailure = {
            providerId: VIDKING_PROVIDER_ID,
            code: vidkingStatusToFailureCode(response.status),
            message: `Videasy ${server} returned HTTP ${response.status}`,
            retryable:
              response.status !== 401 && response.status !== 403 && response.status !== 404,
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
            retryable: true,
            at: context.now(),
          };
          failures.push(f);
          emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
          continue;
        }

        const decoded = await decodeVidkingPayload(payload, tmdbId);
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
          streamReferer: customReferer,
          sourceQualityFilter: engineOptions.filterQuality,
          sourceDisplayLabel: engineOptions.flavorLabel,
          flavorArchetype: engineOptions.flavorArchetype,
        });
        if (result) {
          vidkingHealth.recordSuccess(server);
          return result;
        }

        const f: ProviderFailure = {
          providerId: VIDKING_PROVIDER_ID,
          code: "not-found",
          message: `Videasy ${server} no playable streams`,
          retryable: true,
          at: context.now(),
        };
        failures.push(f);
        emitRetryIfNeeded(events, context, f, sourceId, attempt, maxAttempts);
      } catch (error) {
        vidkingHealth.recordFailure(server);
        if (context.signal?.aborted) throw error;
        const f: ProviderFailure = {
          providerId: VIDKING_PROVIDER_ID,
          code: "parse-failed",
          message: error instanceof Error ? error.message : "VidKing payload decode failed",
          retryable: true,
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
}: {
  readonly payload: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
  readonly server?: string;
  readonly streamReferer?: string;
  readonly streamOrigin?: string;
  readonly sourceQualityFilter?: string;
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
        host: "api.videasy.net",
        confidence: 0.9,
        metadata: { quality: source.quality, flavorFilter: sourceQualityFilter },
      }),
    ];

    streams.push({
      id: streamId,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      variantId,
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

function selectStreamCandidate(
  streams: readonly StreamCandidate[],
  qualityPreference: string | undefined,
): StreamCandidate {
  if (qualityPreference) {
    const normalized = qualityPreference.toLowerCase();
    const matched = streams.find((stream) =>
      stream.qualityLabel?.toLowerCase().includes(normalized),
    );
    if (matched) {
      return matched;
    }
  }

  const [best] = [...streams].sort(
    (left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0),
  );
  if (!best) {
    throw new Error("Cannot select a preferred VidKing stream from an empty candidate list");
  }
  return best;
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
}): URLSearchParams[] {
  const variants: URLSearchParams[] = [];
  const base = new URLSearchParams({
    title: opts.title.title,
    mediaType: opts.mediaKind === "series" ? "tv" : "movie",
    tmdbId: String(opts.tmdbId),
  });

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
  return `source:${VIDKING_PROVIDER_ID}:videasy:${server}`;
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
