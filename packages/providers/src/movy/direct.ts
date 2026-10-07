import {
  ProviderCycleFailureError,
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  providerCycleCandidateTimeoutMs,
  runProviderCycle,
  type CoreProviderModule,
} from "@kunai/core";
import { isJsonNumber, isJsonString } from "@kunai/types";
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

import { ProviderHttpError, providerFetch } from "../runtime/fetch";
import { resolveTmdbCatalogId } from "../shared/catalog-id";
import {
  cycleExhaustionFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import {
  dropRefusedStreams,
  resolveGateBudgetMs,
  selectVerifiedStream,
} from "../shared/resolve-gate";
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
// Origin carries no path and no trailing slash — a real browser sends
// `Origin: https://www.movy.sx`.
const MOVY_ORIGIN = "https://www.movy.sx";

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
const MOVY_CANDIDATE_TIMEOUT_MS = 15_000;

async function fetchMovySeed(
  context: ProviderRuntimeContext,
  mediaId: number,
  signal?: AbortSignal,
): Promise<string> {
  const cacheKey = `${MOVY_API_BASE}|${mediaId}`;
  const now = Date.now();
  const cached = seedCache.get(cacheKey);
  if (cached && cached.expiresAt - SEED_EXPIRY_HEADROOM_MS > now) return cached.seed;

  const response = await providerFetch(context, `${MOVY_API_BASE}/seed?mediaId=${mediaId}`, {
    headers: { "User-Agent": USER_AGENT, Referer: MOVY_REFERER, Origin: MOVY_ORIGIN },
    signal,
  });
  if (!response.ok) {
    throw new ProviderHttpError({
      message: `seed request failed: HTTP ${response.status}`,
      providerId: MOVY_PROVIDER_ID,
      stage: "seed",
      status: response.status,
      code: "network-error",
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  // SAFETY: the seed envelope is untrusted — `seed` must be a non-empty string
  // (a number/boolean decrypts to a TypeError), and `ttlMs` must be a finite
  // positive number (a string concatenates onto Date.now() into an immortal
  // entry). Either surprise fails closed and never reaches the cache.
  const body = (await response.json()) as { seed?: unknown; ttlMs?: unknown } | null;
  if (!body || !isJsonString(body.seed) || !body.seed) {
    throw new MovyDecryptError("seed response carried no usable seed");
  }
  const ttlMs =
    isJsonNumber(body.ttlMs) && Number.isFinite(body.ttlMs) && body.ttlMs > 0 ? body.ttlMs : 30_000;

  seedCache.delete(cacheKey);
  seedCache.set(cacheKey, {
    seed: body.seed,
    expiresAt: Date.now() + ttlMs,
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

/** Test seam — the seed cache is module state and must not leak between cases. */
export function clearMovySeedCacheForTest(): void {
  seedCache.clear();
}

async function fetchMovyLaneSources(
  context: ProviderRuntimeContext,
  lane: MovyLane,
  params: Record<string, string>,
  mediaId: number,
  signal?: AbortSignal,
): Promise<MovySourcesPayload> {
  // One seed retry on STREAMCRYPTO_SEED_INVALID — matches the site's own
  // "401 → drop cached seed, refetch, retry once" recovery.
  for (let attempt = 0; attempt < 2; attempt++) {
    const seed = await fetchMovySeed(context, mediaId, signal);
    const query = new URLSearchParams({ ...params, enc: "2", seed });
    const response = await providerFetch(context, `${MOVY_API_BASE}/${lane}/sources?${query}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: MOVY_REFERER,
        Origin: MOVY_ORIGIN,
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
      throw new ProviderHttpError({
        message: detail ? `${lane}: ${detail}` : `${lane} sources failed: HTTP ${response.status}`,
        providerId: MOVY_PROVIDER_ID,
        stage: "sources",
        status: response.status,
        code: "network-error",
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const ciphertext = await response.text();
    try {
      const plaintext = decryptMovyPayload(ciphertext, seed, mediaId);
      // SAFETY: decrypted payload is the lane's sources envelope; every
      // consumer reads optional fields and empty sources fail closed below.
      return JSON.parse(plaintext) as MovySourcesPayload;
    } catch (error) {
      // A seed that cannot decrypt this lane's ciphertext does not fit it —
      // treat it like the 401 the site uses: drop the cached seed, refetch,
      // retry once. Otherwise one bad draw poisons the seed cache for its
      // whole TTL and every later resolve of the title fails.
      if (attempt === 0) {
        invalidateMovySeed(mediaId);
        continue;
      }
      throw new MovyDecryptError(`${lane}: decrypted payload was not JSON`, { cause: error });
    }
  }
  throw new MovyDecryptError(`${lane}: seed rejected after retry`);
}

/** Language names appear in the `quality` field on multi-audio lanes. */
const LANE_AUDIO_LABELS = {
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
  // SAFETY: the label comes from provider JSON; an unmapped key indexes to
  // undefined at runtime, which is the documented "no audio language" answer.
  const label = quality.trim().toLowerCase() as keyof typeof LANE_AUDIO_LABELS;
  return LANE_AUDIO_LABELS[label];
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
  signal,
  gateTimeoutMs,
}: {
  readonly candidate: ProviderCycleCandidate;
  readonly lane: MovyLane;
  readonly context: ProviderRuntimeContext;
  readonly cachePolicy: CachePolicy;
  readonly laneParams: Record<string, string>;
  readonly tmdbId: number;
  readonly signal?: AbortSignal;
  readonly gateTimeoutMs: number;
}): Promise<MovyResolvedCandidate> {
  const sourceId = candidate.sourceId ?? providerInventorySourceId(MOVY_PROVIDER_ID, lane);
  const displayLabel = `Movy ${lane}`;
  const payload = await fetchMovyLaneSources(context, lane, laneParams, tmdbId, signal);

  const rawSources = (payload.sources ?? []).filter(
    (source) => source.url?.startsWith("http") === true,
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
    // Lane labels like "Auto HLS" / "Auto - Vidara" are adaptive ladders, not
    // a fixed tier — rank them as `auto` or they'd sort below an explicit 360p.
    const qualityRank =
      qualityRankFromLabel(qualityStr) ??
      (/^auto\b/i.test(qualityStr) ? qualityRankFromLabel("auto") : undefined) ??
      0;
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

  // Probe before accepting the lane: a lane payload can carry dead mirrors
  // (the status sweep caught a Denver source answering 404), and reporting it
  // unprobed is the videasy failure shape — success claimed for a stream that
  // cannot play. The gate only rejects on a definitive refusal; a slow or
  // non-committal host still ships.
  const selection = await selectVerifiedStream({
    streams,
    context,
    signal,
    timeoutMs: gateTimeoutMs,
  });
  if (!selection.accepted) {
    throw createProviderCycleFailureError(candidate, {
      failureClass: "candidate-blocked",
      message: `${displayLabel}: ${selection.reason}`,
      retryable: false,
      at: context.now(),
      // Every rung of this lane was refused by probing its own URLs, so it is
      // durable evidence about that lane's endpoints rather than our network.
      endpointScoped: true,
    });
  }
  // Keep the alternatives, drop the rungs the gate proved dead.
  const gatedStreams = dropRefusedStreams(streams, selection.refusedHosts);
  const gatedVariants = variants.filter((variant) =>
    gatedStreams.some((stream) => stream.variantId === variant.id),
  );

  return { provider: lane, streams: gatedStreams, variants: gatedVariants, subtitles };
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
  const laneParams = {
    // The site's own bundle pre-encodes the title before the query layer
    // encodes again — lanes receive a still-encoded title on the wire.
    // Live-verified: a space-containing title resolved on 11/16 lanes only
    // with this double-encoding.
    title: encodeURIComponent(input.title.title ?? ""),
    mediaType: input.mediaKind === "movie" ? "movie" : "tv",
    year: String(input.title.year ?? ""),
    // ProviderResolveInput carries no season count, and the lanes don't
    // validate seasonId ≤ totalSeasons — "1" is what the site sends for
    // single-season lookups and resolves S2+ fine.
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

  // The attempt budget caps this, so the gate has to be sized against what the
  // candidate actually gets rather than the number chosen here.
  const candidateTimeoutMs = providerCycleCandidateTimeoutMs(
    input.startupPriority ?? "balanced",
    MOVY_CANDIDATE_TIMEOUT_MS,
  );
  const gateTimeoutMs = resolveGateBudgetMs(candidateTimeoutMs);

  const cycleResult = await runProviderCycle({
    providerId: MOVY_PROVIDER_ID,
    candidates: cycleCandidates,
    signal: context.signal,
    now: context.now,
    emit: context.emit,
    // Each lane is a different upstream scraper, so a lane's health evidence
    // belongs to that lane alone — wiring the port is what makes
    // `endpointScoped` on the gate refusal below mean anything.
    endpointHealth: context.endpointHealth,
    titleId: input.title.id,
    maxAttemptsPerCandidate: 1,
    candidateTimeoutMs,
    resolveCandidate: async (candidate, candidateContext) => {
      // SAFETY: serverId/lane were minted by this module's own lane roster
      // when the candidates were declared; a stray value resolves as a lane
      // fetch that the API rejects, failing closed in the cycle.
      const lane = String(candidate.serverId ?? candidate.metadata?.lane ?? "") as MovyLane;
      try {
        return await resolveMovyLaneCandidate({
          candidate,
          lane,
          context,
          cachePolicy,
          laneParams,
          tmdbId,
          // The per-candidate controller aborts at candidateTimeoutMs — without
          // it the fetch is never cancelled and a stalled lane leaks its
          // socket until TCP timeout.
          signal: candidateContext.signal,
          gateTimeoutMs,
        });
      } catch (error) {
        // resolveMovyLaneCandidate already classifies its own failures (e.g.
        // candidate-empty) — rewrapping them would flatten every lane error
        // into not-found and hide transient/server evidence from provider
        // health and offline detection.
        if (error instanceof ProviderCycleFailureError) {
          // The gate's own verdict carries `endpointScoped`; keep it visible in
          // the resolve's failure list instead of only in the cycle attempts.
          failures.push({
            providerId: MOVY_PROVIDER_ID,
            code: providerFailureCodeFromCycleFailure(error.failure.failureClass),
            message: error.failure.message,
            retryable: error.failure.retryable,
            at: context.now(),
          });
          throw error;
        }
        // A caller abort is not lane evidence — record nothing, spend nothing.
        if (context.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : `Movy lane ${lane} failed`;
        const failure =
          error instanceof ProviderHttpError
            ? {
                // An HTTP answer is upstream evidence: 5xx/429 retryable
                // outage, 404/410 a definitive miss. Not a decrypt/parse bug.
                code: error.code,
                retryable: error.retryable,
                failureClass:
                  error.status === 404 || error.status === 410
                    ? ("candidate-empty" as const)
                    : ("candidate-network" as const),
              }
            : error instanceof MovyDecryptError
              ? {
                  code: "parse-failed" as const,
                  retryable: false,
                  failureClass: "candidate-parse" as const,
                }
              : {
                  // Raw transport errors (ENOTFOUND, ECONNRESET, fetch failed)
                  // are offline-class evidence — non-retryable so the cycle's
                  // offline early-exit can still trigger.
                  code: "network-error" as const,
                  retryable:
                    !/enotfound|eai_again|enetunreach|econnrefused|econnreset|fetch failed|socket/i.test(
                      message,
                    ),
                  failureClass: "candidate-network" as const,
                };
        failures.push({
          providerId: MOVY_PROVIDER_ID,
          code: failure.code,
          message,
          retryable: failure.retryable,
          at: context.now(),
        });
        throw createProviderCycleFailureError(candidate, {
          failureClass: failure.failureClass,
          message,
          retryable: failure.retryable,
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
    const failure = cycleExhaustionFailure(cycleResult, "All Movy lanes exhausted without streams");
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
