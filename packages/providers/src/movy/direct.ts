import {
  ProviderCycleFailureError,
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  runProviderCycle,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  CachePolicy,
  ProviderCycleCandidate,
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { resolveTmdbCatalogId } from "../shared/catalog-id";
import {
  findLastCycleFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { hasResolvableSeriesCoordinates } from "../shared/series-coordinates";
import {
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
  createVariantId,
  finalizeCycleSourceInventory,
  normalizeQualityLabel,
  providerInventorySourceId,
  qualityRankFromLabel,
  streamPresentationFields,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { inferSubtitleFormat, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { movyManifest, MOVY_PROVIDER_ID } from "./manifest";
import { decryptMovyPayload, MovyDecryptError } from "./streamcrypto";

export { MOVY_PROVIDER_ID };

/**
 * movy.sx's backend. The site calls it `STREAM_API_URL`; each named lane below
 * is a `/{lane}/sources` route wrapping a different upstream scraper — the
 * lanes surface as individual sources so the tracks panel can switch servers.
 */
export const MOVY_API_BASE = "https://api.wecollege.net";
export const MOVY_REFERER = "https://www.movy.sx/";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Lane order mirrors the site's own picker. Every lane is tried in order;
 * individual lanes fail independently (a dead upstream scraper 500s without
 * taking the whole provider down).
 */
export const MOVY_LANES = [
  "denver",
  "atlanta",
  "phoenix",
  "portland",
  "seattle",
  "miami",
  "boise",
  "paris",
  "cancun",
  "austin",
  "dallas",
  "delhi",
  "munich",
  "orlando",
  "tampa",
  "berlin",
] as const;

export type MovyLane = (typeof MOVY_LANES)[number];

type MovySourceRow = {
  readonly url?: string;
  readonly quality?: string;
  readonly type?: string;
  readonly server?: string;
};

type MovySourcesPayload = {
  readonly sources?: readonly MovySourceRow[];
  readonly subtitles?: readonly {
    readonly url?: string;
    readonly file?: string;
    readonly lang?: string;
    readonly language?: string;
    readonly label?: string;
  }[];
};

/** Per-mediaId seed cache — seeds carry a ~30 s server TTL. */
const seedCache = new Map<string, { seed: string; expiresAt: number }>();
const SEED_CACHE_MAX = 64;
const SEED_EXPIRY_HEADROOM_MS = 5_000;

async function fetchMovySeed(
  context: ProviderRuntimeContext,
  mediaId: number,
  signal?: AbortSignal,
): Promise<string> {
  const cacheKey = `${MOVY_API_BASE}|${mediaId}`;
  const now = Date.now();
  const cached = seedCache.get(cacheKey);
  if (cached && cached.expiresAt - SEED_EXPIRY_HEADROOM_MS > now) return cached.seed;

  const fetchImpl = context.fetch?.fetch.bind(context.fetch) ?? fetch;
  const response = await fetchImpl(`${MOVY_API_BASE}/seed?mediaId=${mediaId}`, {
    headers: { "User-Agent": USER_AGENT, Referer: MOVY_REFERER, Origin: MOVY_REFERER },
    signal,
  });
  if (!response.ok) {
    throw new MovyDecryptError(`seed request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { seed?: string; ttlMs?: number };
  if (!body.seed) throw new MovyDecryptError("seed response carried no seed");

  seedCache.delete(cacheKey);
  seedCache.set(cacheKey, {
    seed: body.seed,
    expiresAt: Date.now() + (body.ttlMs ?? 30_000),
  });
  while (seedCache.size > SEED_CACHE_MAX) {
    const oldest = seedCache.keys().next();
    if (oldest.done) break;
    seedCache.delete(oldest.value);
  }
  return body.seed;
}

function invalidateMovySeed(mediaId: number): void {
  seedCache.delete(`${MOVY_API_BASE}|${mediaId}`);
}

async function fetchMovyLaneSources(
  context: ProviderRuntimeContext,
  lane: MovyLane,
  params: Record<string, string>,
  mediaId: number,
  signal?: AbortSignal,
): Promise<MovySourcesPayload> {
  const fetchImpl = context.fetch?.fetch.bind(context.fetch) ?? fetch;

  // One seed retry on STREAMCRYPTO_SEED_INVALID — matches the site's own
  // "401 → drop cached seed, refetch, retry once" recovery.
  for (let attempt = 0; attempt < 2; attempt++) {
    const seed = await fetchMovySeed(context, mediaId, signal);
    const query = new URLSearchParams({ ...params, enc: "2", seed });
    const response = await fetchImpl(`${MOVY_API_BASE}/${lane}/sources?${query}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: MOVY_REFERER,
        Origin: MOVY_REFERER,
        Accept: "*/*",
      },
      signal,
    });
    if (response.status === 401 && attempt === 0) {
      invalidateMovySeed(mediaId);
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = /"message"\s*:\s*"([^"]{3,120})"/.exec(body)?.[1];
      throw new MovyDecryptError(
        detail ? `${lane}: ${detail}` : `${lane} sources failed: HTTP ${response.status}`,
      );
    }
    const ciphertext = await response.text();
    const plaintext = decryptMovyPayload(ciphertext, seed, mediaId);
    return JSON.parse(plaintext) as MovySourcesPayload;
  }
  throw new MovyDecryptError(`${lane}: seed rejected after retry`);
}

/** Language names appear in the `quality` field on multi-audio lanes. */
const LANE_AUDIO_LABELS: Readonly<Record<string, string>> = {
  hindi: "hi",
  english: "en",
  tamil: "ta",
  telugu: "te",
  spanish: "es",
  french: "fr",
  german: "de",
  japanese: "ja",
};

function movySourceProtocol(source: MovySourceRow): "hls" | "dash" | "mp4" {
  const type = source.type?.toLowerCase();
  const url = source.url?.toLowerCase() ?? "";
  if (type === "dash" || /\.mpd(?:[?#]|$)/.test(url)) return "dash";
  if (type === "hls" || /\.m3u8(?:[?#]|$)/.test(url) || url.includes("type=hls")) return "hls";
  return "mp4";
}

function movyLaneAudioLanguage(quality: string | undefined): string | undefined {
  if (!quality) return undefined;
  const normalized = normalizeIsoLanguageCode(quality.trim().toLowerCase());
  if (normalized) return normalized;
  return LANE_AUDIO_LABELS[quality.trim().toLowerCase()];
}

type MovyResolvedCandidate = {
  readonly provider: MovyLane;
  readonly streams: readonly StreamCandidate[];
  readonly variants: readonly ProviderVariantCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
};

async function resolveMovyLaneCandidate({
  candidate,
  lane,
  context,
  cachePolicy,
  laneParams,
  tmdbId,
}: {
  readonly candidate: ProviderCycleCandidate;
  readonly lane: MovyLane;
  readonly context: ProviderRuntimeContext;
  readonly cachePolicy: CachePolicy;
  readonly laneParams: Record<string, string>;
  readonly tmdbId: number;
}): Promise<MovyResolvedCandidate> {
  const sourceId = candidate.sourceId ?? providerInventorySourceId(MOVY_PROVIDER_ID, lane);
  const displayLabel = `Movy ${lane}`;
  const payload = await fetchMovyLaneSources(context, lane, laneParams, tmdbId, context.signal);

  const rawSources = (payload.sources ?? []).filter(
    (source) => typeof source.url === "string" && source.url.startsWith("http"),
  );
  if (rawSources.length === 0) {
    throw createProviderCycleFailureError(candidate, {
      failureClass: "candidate-empty",
      message: `Movy lane ${lane} returned no playable sources`,
      retryable: true,
      at: context.now(),
    });
  }

  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const subtitles: SubtitleCandidate[] = [];

  for (const source of rawSources) {
    const url = source.url;
    if (!url) continue;
    const laneAudio = movyLaneAudioLanguage(source.quality);
    const qualityStr = laneAudio ? "auto" : String(source.quality || "auto");
    const qualityLabel = normalizeQualityLabel(qualityStr);
    const qualityRank = qualityRankFromLabel(qualityStr) ?? 0;
    const protocol = movySourceProtocol(source);
    const streamId = createStreamId(MOVY_PROVIDER_ID, [url]);
    const variantId = createVariantId(MOVY_PROVIDER_ID, [sourceId, qualityLabel, url]);
    const languageEvidence = laneAudio
      ? [
          createProviderLanguageEvidence({
            role: "audio" as const,
            value: laneAudio,
            nativeLabel: source.quality,
            sourceId,
            confidence: 0.7,
            metadata: { lane },
          }),
        ]
      : undefined;
    const sourceEvidence = [
      createProviderSourceEvidence({
        sourceId,
        serverId: lane,
        nativeLabel: lane,
        host: "api.wecollege.net",
        confidence: 0.9,
        metadata: { quality: source.quality, displayLabel },
      }),
    ];

    streams.push({
      id: streamId,
      providerId: MOVY_PROVIDER_ID,
      sourceId,
      variantId,
      url,
      protocol,
      container: protocol === "hls" ? "m3u8" : protocol === "dash" ? "mpd" : "mp4",
      audioLanguages: laneAudio ? [laneAudio] : undefined,
      qualityLabel,
      qualityRank,
      languageEvidence,
      sourceEvidence,
      headers: { referer: MOVY_REFERER, "user-agent": USER_AGENT },
      confidence: 0.9,
      cachePolicy,
      ...streamPresentationFields({ displayLabel }),
    });

    const stream = streams[streams.length - 1];
    if (stream) {
      variants.push(createVariantCandidateFromStream({ providerId: MOVY_PROVIDER_ID, stream }));
    }
  }

  for (const subtitle of payload.subtitles ?? []) {
    const subUrl = subtitle.url ?? subtitle.file;
    if (!subUrl) continue;
    const language = normalizeIsoLanguageCode(
      String(subtitle.lang ?? subtitle.language ?? subtitle.label ?? ""),
    );
    subtitles.push({
      id: `subtitle:${MOVY_PROVIDER_ID}:${Bun.hash(subUrl).toString(36)}`,
      providerId: MOVY_PROVIDER_ID,
      sourceId,
      url: subUrl,
      language,
      label: subtitle.label ?? subtitle.lang ?? subtitle.language ?? "Subtitle",
      format: inferSubtitleFormat(subUrl),
      source: "provider",
      confidence: 0.95,
      cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
    });
  }

  return { provider: lane, streams, variants, subtitles };
}

export function buildMovyCycleCandidates(
  lanes: readonly MovyLane[],
  preferredSourceId?: string,
): readonly ProviderCycleCandidate[] {
  return lanes.map((lane, index) => {
    const sourceId = providerInventorySourceId(MOVY_PROVIDER_ID, lane);
    return {
      id: `candidate:${sourceId}`,
      providerId: MOVY_PROVIDER_ID,
      sourceId,
      serverId: lane,
      label: `Movy ${lane}`,
      nativeLabel: lane,
      priority: sourceId === preferredSourceId ? index - 10_000 : index,
      metadata: { lane, sourceHost: "api.wecollege.net" },
    };
  });
}

function buildMovySourceInventoryCandidates(
  candidates: readonly ProviderCycleCandidate[],
  cachePolicy: CachePolicy,
): readonly ProviderSourceCandidate[] {
  return candidates.flatMap((candidate) => {
    const sourceId = candidate.sourceId;
    const lane = String(candidate.serverId ?? candidate.metadata?.lane ?? "");
    if (!sourceId || !lane) return [];
    return [
      {
        id: sourceId,
        providerId: MOVY_PROVIDER_ID,
        kind: "provider-api" as const,
        label: `Movy ${lane}`,
        host: "api.wecollege.net",
        status: "probing" as const,
        confidence: 0.75,
        requiresRuntime: "direct-http" as const,
        cachePolicy,
        sourceEvidence: [
          createProviderSourceEvidence({
            sourceId,
            serverId: lane,
            nativeLabel: lane,
            host: "api.wecollege.net",
            confidence: 0.75,
          }),
        ],
        metadata: { lane, sourceHost: "api.wecollege.net" },
      },
    ];
  });
}

export async function resolveMovyDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult> {
  if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
    return createExhaustedResult(input, context, MOVY_PROVIDER_ID, {
      code: "unsupported-title",
      message: "Movy only supports movie and series content",
      retryable: false,
    });
  }
  if (!input.allowedRuntimes.includes("direct-http")) {
    return createExhaustedResult(input, context, MOVY_PROVIDER_ID, {
      code: "runtime-missing",
      message: "Movy requires the direct-http runtime",
      retryable: false,
    });
  }
  const tmdbId = resolveTmdbCatalogId(input.title);
  if (tmdbId === null || !Number.isFinite(tmdbId) || tmdbId <= 0) {
    return createExhaustedResult(input, context, MOVY_PROVIDER_ID, {
      code: "unsupported-title",
      message: "Movy requires a numeric TMDB id",
      retryable: false,
    });
  }
  if (input.mediaKind === "series" && !hasResolvableSeriesCoordinates(input.episode)) {
    return createExhaustedResult(input, context, MOVY_PROVIDER_ID, {
      code: "unsupported-title",
      message: "Movy requires season and episode for series",
      retryable: false,
    });
  }

  const startedAt = context.now();
  const events: ProviderTraceEvent[] = [];
  const failures: ProviderFailure[] = [];
  const cachePolicy = createProviderCachePolicy({
    providerId: MOVY_PROVIDER_ID,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
    startupPriority: input.startupPriority,
  });

  const season = input.episode?.season ?? 1;
  const episode = input.episode?.episode ?? 1;
  const laneParams: Record<string, string> = {
    title: encodeURIComponent(input.title.title ?? ""),
    mediaType: input.mediaKind === "movie" ? "movie" : "tv",
    year: String(input.title.year ?? ""),
    totalSeasons: "1",
    seasonId: String(season),
    episodeId: String(episode),
    tmdbId: String(tmdbId),
    imdbId: input.title.imdbId ?? "",
  };

  const cycleCandidates = buildMovyCycleCandidates(MOVY_LANES, input.preferredSourceId);
  const sourceInventorySeeds = buildMovySourceInventoryCandidates(cycleCandidates, cachePolicy);

  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId: MOVY_PROVIDER_ID,
    message: `Movy resolving TMDB ${tmdbId} across ${cycleCandidates.length} lanes`,
  });

  const cycleResult = await runProviderCycle({
    providerId: MOVY_PROVIDER_ID,
    candidates: cycleCandidates,
    signal: context.signal,
    now: context.now,
    emit: context.emit,
    maxAttemptsPerCandidate: 1,
    candidateTimeoutMs: 15_000,
    resolveCandidate: async (candidate) => {
      const lane = String(candidate.serverId ?? candidate.metadata?.lane ?? "") as MovyLane;
      try {
        return await resolveMovyLaneCandidate({
          candidate,
          lane,
          context,
          cachePolicy,
          laneParams,
          tmdbId,
        });
      } catch (error) {
        // resolveMovyLaneCandidate already classifies its own failures (e.g.
        // candidate-empty) — rewrapping them would flatten every lane error
        // into not-found and hide transient/server evidence from provider
        // health and offline detection.
        if (error instanceof ProviderCycleFailureError) throw error;
        const message = error instanceof Error ? error.message : `Movy lane ${lane} failed`;
        const isParse = error instanceof MovyDecryptError;
        failures.push({
          providerId: MOVY_PROVIDER_ID,
          code: isParse ? "not-found" : "network-error",
          message,
          retryable: true,
          at: context.now(),
        });
        throw createProviderCycleFailureError(candidate, {
          failureClass: isParse ? "candidate-parse" : "candidate-network",
          message,
          retryable: true,
          at: context.now(),
        });
      }
    },
  });
  events.push(...cycleResult.events);

  const sources = finalizeCycleSourceInventory({
    sources: sourceInventorySeeds,
    attempts: cycleResult.attempts,
  });

  if (cycleResult.cancelled) {
    return createExhaustedResult(
      input,
      context,
      MOVY_PROVIDER_ID,
      { code: "cancelled", message: "Movy lane cycling was cancelled", retryable: false },
      { cachePolicy, events, failures, sources, startedAt },
    );
  }

  if (!cycleResult.selected) {
    const cycleFailure = findLastCycleFailure(cycleResult.attempts);
    const failure = cycleFailure
      ? {
          code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
          message: cycleFailure.message,
          retryable: cycleFailure.retryable,
        }
      : {
          code: "not-found" as const,
          message: "All Movy lanes exhausted without streams",
          retryable: true,
        };
    return createExhaustedResult(input, context, MOVY_PROVIDER_ID, failure, {
      cachePolicy,
      events,
      failures,
      sources,
      startedAt,
    });
  }

  const {
    streams: selectedStreams,
    variants: selectedVariants,
    subtitles,
    provider: laneUsed,
  } = cycleResult.selected;
  const streams = [...selectedStreams];
  const variants = [...selectedVariants];
  streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

  const selectableStreams = input.startupPriority === "fast" ? selectedStreams : streams;
  const selection = selectReadyStream(selectableStreams, {
    startupPriority: input.startupPriority,
    qualityPreference: input.qualityPreference,
    preferredStreamId: input.preferredStreamId,
    preferredSourceId: input.preferredSourceId,
  });
  const selectedStream = selection.selected;
  const selectedSource = {
    ...createSourceCandidateFromStream({
      providerId: MOVY_PROVIDER_ID,
      stream: selectedStream,
      kind: "provider-api",
      selected: true,
      cachePolicy,
      label: `Movy ${laneUsed}`,
      confidence: 0.95,
    }),
    requiresRuntime: "direct-http" as const,
  };

  emitTraceEvent(events, context, {
    type: "provider:success",
    providerId: MOVY_PROVIDER_ID,
    message: `Movy resolved TMDB ${tmdbId} via lane ${laneUsed}`,
  });

  const endedAt = context.now();
  return {
    status: "resolved",
    providerId: MOVY_PROVIDER_ID,
    selectedStreamId: selectedStream.id,
    selectionDecision: selection.decision,
    sources: finalizeCycleSourceInventory({
      sources: sourceInventorySeeds,
      attempts: cycleResult.attempts,
      selectedSources: [selectedSource],
      streams,
      selectedStreamId: selectedStream.id,
    }),
    streams,
    variants,
    subtitles,
    cachePolicy,
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId: MOVY_PROVIDER_ID,
      streamId: selectedStream.id,
      cacheHit: false,
      runtime: "direct-http",
      startedAt,
      endedAt,
      steps: [
        createTraceStep("provider", `Resolved Movy via lane ${laneUsed}`, {
          providerId: MOVY_PROVIDER_ID,
          attributes: { streams: streams.length, lane: laneUsed },
        }),
      ],
      events,
      failures,
    }),
    failures,
    healthDelta: {
      providerId: MOVY_PROVIDER_ID,
      outcome: "success",
      at: endedAt,
    },
  };
}

export const movyProviderModule: CoreProviderModule = {
  providerId: MOVY_PROVIDER_ID,
  manifest: movyManifest,
  resolve: resolveMovyDirect,
};
