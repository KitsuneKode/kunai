/* oxlint-disable no-shadow */

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
  ProviderCycleCandidate,
  ProviderFailure,
  ProviderResolveInput,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { ProviderHttpError, providerJson } from "../runtime/fetch";
import {
  findLastCycleFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import {
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
  createVariantId,
  finalizeCycleSourceInventory,
  normalizeProviderDisplayLabel,
  normalizeQualityLabel,
  providerInventorySourceId,
  qualityRankFromLabel,
  streamPresentationFields,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { rivestreamManifest, RIVESTREAM_PROVIDER_ID } from "./manifest";

export { RIVESTREAM_PROVIDER_ID };
export const RIVESTREAM_REFERER = "https://www.rivestream.app/";
export const RIVESTREAM_API_BASE = "https://www.rivestream.app/api/backendfetch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Memoize secretKey per tmdbId — deterministic, expensive to recompute. */
const secretKeyCache = new Map<string, string>();
const RIVESTREAM_PROVIDER_SERVICES_TTL_MS = 24 * 60 * 60 * 1000;
const RIVESTREAM_STATIC_PROVIDER_SERVICES = ["self", "prime"] as const;
let providerServicesCache:
  | {
      readonly providers: readonly string[];
      readonly expiresAtMs: number;
    }
  | undefined;

type RivestreamProviderServicesResponse = {
  readonly data?: unknown;
};

type RivestreamRawSource = {
  readonly url?: string;
  readonly quality?: string;
  readonly format?: string;
};

type RivestreamSourceResponse = {
  readonly data?:
    | readonly RivestreamRawSource[]
    | {
        readonly sources?: readonly RivestreamRawSource[];
        readonly captions?: readonly RivestreamRawSubtitle[];
      };
};

type RivestreamRawSubtitle = {
  readonly url?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly file?: string;
  readonly label?: string;
};

type RivestreamResolvedCandidate = {
  readonly provider: string;
  readonly sourceId: string;
  readonly streams: readonly StreamCandidate[];
  readonly variants: readonly ProviderVariantCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
};

type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

function createTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (!signal) return AbortSignal.timeout(timeoutMs);
  return abortSignal.any ? abortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal;
}

function getRivestreamRawSources(
  data: RivestreamSourceResponse["data"],
): readonly RivestreamRawSource[] {
  if (Array.isArray(data)) return data;
  if (isRivestreamSourceEnvelope(data)) return data.sources ?? [];
  return [];
}

function isRivestreamSourceEnvelope(
  data: RivestreamSourceResponse["data"],
): data is { readonly sources?: readonly RivestreamRawSource[] } {
  return typeof data === "object" && data !== null && !Array.isArray(data) && "sources" in data;
}

// Ported 32-bit MurmurHash custom algorithm
const cArray = [
  "4Z7lUo",
  "gwIVSMD",
  "PLmz2elE2v",
  "Z4OFV0",
  "SZ6RZq6Zc",
  "zhJEFYxrz8",
  "FOm7b0",
  "axHS3q4KDq",
  "o9zuXQ",
  "4Aebt",
  "wgjjWwKKx",
  "rY4VIxqSN",
  "kfjbnSo",
  "2DyrFA1M",
  "YUixDM9B",
  "JQvgEj0",
  "mcuFx6JIek",
  "eoTKe26gL",
  "qaI9EVO1rB",
  "0xl33btZL",
  "1fszuAU",
  "a7jnHzst6P",
  "wQuJkX",
  "cBNhTJlEOf",
  "KNcFWhDvgT",
  "XipDGjST",
  "PCZJlbHoyt",
  "2AYnMZkqd",
  "HIpJh",
  "KH0C3iztrG",
  "W81hjts92",
  "rJhAT",
  "NON7LKoMQ",
  "NMdY3nsKzI",
  "t4En5v",
  "Qq5cOQ9H",
  "Y9nwrp",
  "VX5FYVfsf",
  "cE5SJG",
  "x1vj1",
  "HegbLe",
  "zJ3nmt4OA",
  "gt7rxW57dq",
  "clIE9b",
  "jyJ9g",
  "B5jXjMCSx",
  "cOzZBZTV",
  "FTXGy",
  "Dfh1q1",
  "ny9jqZ2POI",
  "X2NnMn",
  "MBtoyD",
  "qz4Ilys7wB",
  "68lbOMye",
  "3YUJnmxp",
  "1fv5Imona",
  "PlfvvXD7mA",
  "ZarKfHCaPR",
  "owORnX",
  "dQP1YU",
  "dVdkx",
  "qgiK0E",
  "cx9wQ",
  "5F9bGa",
  "7UjkKrp",
  "Yvhrj",
  "wYXez5Dg3",
  "pG4GMU",
  "MwMAu",
  "rFRD5wlM",
];

function generateSecretKey(e: string | number) {
  if (e === undefined) return "rive";
  try {
    let t, n;
    const r = String(e);
    if (isNaN(Number(e))) {
      const sum = r.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      t = cArray[sum % cArray.length] || btoa(r);
      n = Math.floor((sum % r.length) / 2);
    } else {
      const i = Number(e);
      t = cArray[i % cArray.length] || btoa(r);
      n = Math.floor((i % r.length) / 2);
    }

    const i = r.slice(0, n) + t + r.slice(n);

    const hash2 = (e: string) => {
      let t = 0;
      for (let n = 0; n < e.length; n++) {
        const r = e.charCodeAt(n);
        const i =
          (((t = (r + (t << 6) + (t << 16) - t) >>> 0) << (n % 5)) | (t >>> (32 - (n % 5)))) >>> 0;
        t ^= (i ^ ((r << (n % 7)) | (r >>> (8 - (n % 7))))) >>> 0;
        t = (t + ((t >>> 11) ^ (t << 3))) >>> 0;
      }
      t ^= t >>> 15;
      t = ((65535 & t) * 49842 + ((((t >>> 16) * 49842) & 65535) << 16)) >>> 0;
      t ^= t >>> 13;
      t = ((65535 & t) * 40503 + ((((t >>> 16) * 40503) & 65535) << 16)) >>> 0;
      return (t ^= t >>> 16).toString(16).padStart(8, "0");
    };

    const o = (e: string) => {
      let t = String(e);
      let n = 3735928559 ^ t.length;
      for (let e = 0; e < t.length; e++) {
        const r = t.charCodeAt(e);
        let rMod = r;
        rMod ^= ((131 * e + 89) ^ (rMod << (e % 5))) & 255;
        n = (((n << 7) | (n >>> 25)) >>> 0) ^ rMod;
        const i = (65535 & n) * 60205;
        const o = ((n >>> 16) * 60205) << 16;
        n = (i + o) >>> 0;
        n ^= n >>> 11;
      }
      n ^= n >>> 15;
      n = ((65535 & n) * 49842 + (((n >>> 16) * 49842) << 16)) >>> 0;
      n ^= n >>> 13;
      n = ((65535 & n) * 40503 + (((n >>> 16) * 40503) << 16)) >>> 0;
      n ^= n >>> 16;
      n = ((65535 & n) * 10196 + (((n >>> 16) * 10196) << 16)) >>> 0;
      return (n ^= n >>> 15).toString(16).padStart(8, "0");
    };

    return btoa(o(hash2(i)));
  } catch {
    return "topSecret";
  }
}

export const rivestreamProviderModule: CoreProviderModule = {
  providerId: RIVESTREAM_PROVIDER_ID,
  manifest: rivestreamManifest,
  async resolve(input, context) {
    if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
      return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Rivestream only supports movies and series",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Rivestream resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const tmdbId = input.title.tmdbId ?? input.title.id.replace("tmdb:", "");
    if (!tmdbId || Number.isNaN(Number(tmdbId))) {
      return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Rivestream requires a numeric TMDB ID",
        retryable: false,
      });
    }

    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];
    const cachePolicy = createProviderCachePolicy({
      providerId: RIVESTREAM_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: RIVESTREAM_PROVIDER_ID,
      message: "Started Rivestream 0-RAM resolution",
    });

    try {
      const secretKey =
        secretKeyCache.get(tmdbId) ??
        (() => {
          const key = generateSecretKey(tmdbId);
          secretKeyCache.set(tmdbId, key);
          return key;
        })();
      const typeStr = input.mediaKind === "series" ? "tv" : "movie";
      const season = input.episode?.season ?? 1;
      const episode = input.episode?.episode ?? 1;

      const providers = await getRivestreamProviderServices(context);

      const cycleCandidates = buildRivestreamCycleCandidates(providers, input.preferredSourceId);
      const sourceInventorySeeds = buildRivestreamSourceInventoryCandidates(
        cycleCandidates,
        cachePolicy,
      );

      const cycleResult = await runProviderCycle({
        providerId: RIVESTREAM_PROVIDER_ID,
        candidates: cycleCandidates,
        signal: context.signal,
        now: context.now,
        maxAttemptsPerCandidate: 1,
        candidateTimeoutMs: 10_000,
        resolveCandidate: async (candidate) => {
          const provider = String(candidate.serverId ?? candidate.metadata?.provider ?? "");
          if (!provider) {
            throw createProviderCycleFailureError(candidate, {
              failureClass: "candidate-unsupported",
              message: `Rivestream candidate ${candidate.id} is missing provider metadata`,
              retryable: false,
              at: context.now(),
            });
          }

          try {
            return await resolveRivestreamProviderCandidate({
              candidate,
              provider,
              input,
              context,
              cachePolicy,
              tmdbId,
              typeStr,
              season,
              episode,
              secretKey,
            });
          } catch (error) {
            const providerError =
              error instanceof ProviderHttpError
                ? error
                : new ProviderHttpError({
                    providerId: RIVESTREAM_PROVIDER_ID,
                    stage: "source:start",
                    code: "not-found",
                    message:
                      error instanceof Error ? error.message : `Internal server ${provider} failed`,
                    retryable: true,
                    cause: error,
                  });
            failures.push({
              providerId: RIVESTREAM_PROVIDER_ID,
              code: providerError.code,
              message: providerError.message,
              retryable: providerError.retryable,
              at: context.now(),
            });
            throw createProviderCycleFailureError(candidate, {
              failureClass: rivestreamFailureClassFromProviderError(providerError),
              message: providerError.message,
              retryable: providerError.retryable,
              at: context.now(),
            });
          }
        },
      });
      events.push(...cycleResult.events);

      if (cycleResult.cancelled) {
        return createExhaustedResult(
          input,
          context,
          RIVESTREAM_PROVIDER_ID,
          {
            code: "cancelled",
            message: "Rivestream provider cycling was cancelled",
            retryable: false,
          },
          {
            cachePolicy,
            events,
            failures,
            sources: finalizeCycleSourceInventory({
              sources: sourceInventorySeeds,
              attempts: cycleResult.attempts,
            }),
            startedAt,
          },
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
              message: "All internal servers exhausted without returning streams.",
              retryable: true,
            };
        return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          sources: finalizeCycleSourceInventory({
            sources: sourceInventorySeeds,
            attempts: cycleResult.attempts,
          }),
          startedAt,
        });
      }

      const {
        streams: selectedStreams,
        variants: selectedVariants,
        subtitles,
        provider: serverUsed,
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
          providerId: RIVESTREAM_PROVIDER_ID,
          stream: selectedStream,
          kind: "provider-api",
          selected: true,
          cachePolicy,
          label: displayRivestreamProviderLabel(serverUsed),
          confidence: 0.95,
        }),
        requiresRuntime: "direct-http" as const,
      };

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: RIVESTREAM_PROVIDER_ID,
        message: `Successfully resolved Rivestream for TMDB ID ${tmdbId}`,
      });

      const endedAt = context.now();

      return {
        status: "resolved",
        providerId: RIVESTREAM_PROVIDER_ID,
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
          providerId: RIVESTREAM_PROVIDER_ID,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved Rivestream through local MurmurHash", {
              providerId: RIVESTREAM_PROVIDER_ID,
              attributes: { streams: streams.length, server: serverUsed },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: RIVESTREAM_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, {
          code: "cancelled",
          message: "Rivestream resolution was cancelled",
          retryable: false,
        });
      }

      const failure: ProviderFailure = {
        providerId: RIVESTREAM_PROVIDER_ID,
        code: error instanceof ProviderHttpError ? error.code : "network-error",
        message: error instanceof Error ? error.message : "Rivestream API failed",
        retryable: error instanceof ProviderHttpError ? error.retryable : true,
        at: context.now(),
      };
      failures.push(failure);

      return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, failure, {
        cachePolicy,
        events,
        failures,
        startedAt,
      });
    }
  },
};

function buildRivestreamCycleCandidates(
  providers: readonly string[],
  preferredSourceId?: string,
): readonly ProviderCycleCandidate[] {
  return providers.map((provider, index) => {
    const displayLabel = displayRivestreamProviderLabel(provider);
    const audioSubtitle = inferRivestreamAudioSubtitle(provider);
    const sourceId = providerInventorySourceId(RIVESTREAM_PROVIDER_ID, provider);
    return {
      id: `candidate:${sourceId}`,
      providerId: RIVESTREAM_PROVIDER_ID,
      sourceId,
      serverId: provider,
      label: displayLabel,
      nativeLabel: provider,
      priority: sourceId === preferredSourceId ? index - 10_000 : index,
      metadata: {
        provider,
        sourceHost: "rivestream.app",
        flavorLabel: displayLabel,
        flavorArchetype: audioSubtitle,
      },
    };
  });
}

function buildRivestreamSourceInventoryCandidates(
  candidates: readonly ProviderCycleCandidate[],
  cachePolicy: CachePolicy,
): readonly ProviderSourceCandidate[] {
  return candidates.flatMap((candidate) => {
    const sourceId = candidate.sourceId;
    const provider = String(candidate.serverId ?? candidate.metadata?.provider ?? "");
    if (!sourceId || !provider) return [];
    const displayLabel = displayRivestreamProviderLabel(provider);
    const audioSubtitle = inferRivestreamAudioSubtitle(provider);
    return [
      {
        id: sourceId,
        providerId: RIVESTREAM_PROVIDER_ID,
        kind: "provider-api",
        label: displayLabel,
        host: "rivestream.app",
        status: "probing",
        confidence: 0.75,
        requiresRuntime: "direct-http",
        cachePolicy,
        languageEvidence: candidate.normalizedAudioLanguage
          ? [
              createProviderLanguageEvidence({
                role: "audio",
                value: candidate.normalizedAudioLanguage,
                nativeLabel: provider,
                sourceId,
                confidence: 0.65,
              }),
            ]
          : undefined,
        sourceEvidence: [
          createProviderSourceEvidence({
            sourceId,
            serverId: provider,
            nativeLabel: provider,
            host: "rivestream.app",
            confidence: 0.75,
            metadata: { displayLabel },
          }),
        ],
        metadata: {
          provider,
          sourceHost: "rivestream.app",
          flavorLabel: displayLabel,
          flavorArchetype: audioSubtitle,
        },
      },
    ];
  });
}

async function getRivestreamProviderServices(
  context: ProviderRuntimeContext,
): Promise<readonly string[]> {
  const nowMs = Date.parse(context.now());
  const cacheNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (providerServicesCache && providerServicesCache.expiresAtMs > cacheNow) {
    return providerServicesCache.providers;
  }

  try {
    const servicesSignal = createTimeoutSignal(context.signal, 8000);
    const provData = await providerJson<RivestreamProviderServicesResponse>(
      context,
      `${RIVESTREAM_API_BASE}?requestID=VideoProviderServices&secretKey=rive&proxyMode=undefined`,
      {
        headers: { "User-Agent": USER_AGENT, Referer: RIVESTREAM_REFERER },
        signal: servicesSignal,
      },
      { providerId: RIVESTREAM_PROVIDER_ID, stage: "source:start" },
    );
    const providers = Array.isArray(provData.data)
      ? provData.data.filter((provider): provider is string => typeof provider === "string")
      : [];

    if (providers.length > 0) {
      providerServicesCache = {
        providers,
        expiresAtMs: cacheNow + RIVESTREAM_PROVIDER_SERVICES_TTL_MS,
      };
      return providers;
    }
  } catch {
    // Fall through to the known baseline provider list so source resolution can still try.
  }

  return RIVESTREAM_STATIC_PROVIDER_SERVICES;
}

async function resolveRivestreamProviderCandidate({
  candidate,
  provider,
  input,
  context,
  cachePolicy,
  tmdbId,
  typeStr,
  season,
  episode,
  secretKey,
}: {
  readonly candidate: ProviderCycleCandidate;
  readonly provider: string;
  readonly input: ProviderResolveInput;
  readonly context: ProviderRuntimeContext;
  readonly cachePolicy: CachePolicy;
  readonly tmdbId: string;
  readonly typeStr: "movie" | "tv";
  readonly season: number;
  readonly episode: number;
  readonly secretKey: string;
}): Promise<RivestreamResolvedCandidate> {
  const displayLabel = displayRivestreamProviderLabel(provider);
  const audioSubtitle = inferRivestreamAudioSubtitle(provider);
  const sourceId =
    candidate.sourceId ?? providerInventorySourceId(RIVESTREAM_PROVIDER_ID, provider);
  let url = `${RIVESTREAM_API_BASE}?requestID=${typeStr}VideoProvider&id=${tmdbId}`;
  if (input.mediaKind === "series") url += `&season=${season}&episode=${episode}`;
  url += `&service=${provider}&secretKey=${secretKey}&proxyMode=noProxy`;

  const fetchSignal = createTimeoutSignal(context.signal, 8000);
  const sourceData = await providerJson<RivestreamSourceResponse>(
    context,
    url,
    {
      headers: { "User-Agent": USER_AGENT, Referer: RIVESTREAM_REFERER },
      signal: fetchSignal,
    },
    { providerId: RIVESTREAM_PROVIDER_ID, stage: "source:start" },
  );
  const rawSources = getRivestreamRawSources(sourceData.data);
  if (rawSources.length === 0) {
    throw createProviderCycleFailureError(candidate, {
      failureClass: "candidate-empty",
      message: `Rivestream ${provider} did not return sources`,
      retryable: true,
      at: context.now(),
    });
  }

  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const subtitles: SubtitleCandidate[] = [];

  rawSources.forEach((source) => {
    if (!source.url) return;
    const qualityStr = String(source.quality || source.format || "auto");
    const qualityLabel = normalizeQualityLabel(qualityStr);
    const qualityRank = qualityRankFromLabel(qualityStr) ?? 0;
    const streamId = createStreamId(RIVESTREAM_PROVIDER_ID, [source.url]);
    const variantId = createVariantId(RIVESTREAM_PROVIDER_ID, [sourceId, qualityLabel, source.url]);
    const protocol = source.url.includes(".m3u8") ? "hls" : "mp4";
    const normalizedAudioLanguage =
      inferRivestreamAudioLanguage(provider, qualityStr) ??
      normalizeIsoLanguageCode(input.preferredAudioLanguage);
    const languageEvidence = normalizedAudioLanguage
      ? [
          createProviderLanguageEvidence({
            role: "audio" as const,
            value: normalizedAudioLanguage,
            nativeLabel: provider,
            sourceId,
            confidence: 0.65,
            metadata: { quality: qualityStr },
          }),
        ]
      : undefined;
    const sourceEvidence = [
      createProviderSourceEvidence({
        sourceId,
        serverId: provider,
        nativeLabel: provider,
        host: "rivestream.app",
        confidence: 0.9,
        metadata: {
          quality: qualityStr,
          displayLabel: displayRivestreamProviderLabel(provider),
        },
      }),
    ];

    streams.push({
      id: streamId,
      providerId: RIVESTREAM_PROVIDER_ID,
      sourceId,
      variantId,
      url: source.url,
      protocol,
      container: protocol === "hls" ? "m3u8" : "mp4",
      audioLanguages: normalizedAudioLanguage ? [normalizedAudioLanguage] : undefined,
      qualityLabel,
      qualityRank,
      languageEvidence,
      sourceEvidence,
      headers: { referer: RIVESTREAM_REFERER, "user-agent": USER_AGENT },
      confidence: 0.95,
      cachePolicy,
      ...streamPresentationFields({ displayLabel, subtitle: audioSubtitle }),
    });

    const stream = streams[streams.length - 1];
    if (stream) {
      variants.push(
        createVariantCandidateFromStream({
          providerId: RIVESTREAM_PROVIDER_ID,
          stream,
        }),
      );
    }
  });

  const embeddedCaptions = extractRivestreamCaptions(sourceData.data);
  for (const subtitle of embeddedCaptions) {
    const subUrl = subtitle.url || subtitle.file;
    const lang = String(subtitle.lang || subtitle.language || subtitle.label || "unknown");
    const normalizedLang = normalizeIsoLanguageCode(lang);
    if (!subUrl) continue;
    subtitles.push({
      id: `subtitle:${RIVESTREAM_PROVIDER_ID}:${Bun.hash(subUrl).toString(36)}`,
      providerId: RIVESTREAM_PROVIDER_ID,
      sourceId,
      url: subUrl,
      language: normalizedLang,
      label: lang,
      format: subUrl.endsWith(".vtt") ? "vtt" : "srt",
      source: "provider",
      confidence: 0.95,
      cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
    });
  }

  return { provider, sourceId, streams, variants, subtitles };
}

function extractRivestreamCaptions(
  data: RivestreamSourceResponse["data"],
): readonly RivestreamRawSubtitle[] {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("captions" in data)) {
    return [];
  }
  return Array.isArray(data.captions) ? data.captions : [];
}

function rivestreamFailureClassFromProviderError(
  error: ProviderHttpError,
):
  | "candidate-network"
  | "candidate-empty"
  | "candidate-timeout"
  | "candidate-blocked"
  | "candidate-parse" {
  if (error.code === "timeout") return "candidate-timeout";
  if (error.code === "blocked") return "candidate-blocked";
  if (error.code === "parse-failed") return "candidate-parse";
  if (error.code === "not-found") return "candidate-empty";
  return "candidate-network";
}

function displayRivestreamProviderLabel(provider: string): string {
  return normalizeProviderDisplayLabel(provider) ?? provider;
}

function inferRivestreamAudioSubtitle(provider: string): string {
  const language = inferRivestreamAudioLanguage(provider, undefined);
  const label = displayRivestreamProviderLabel(provider);
  if (language) {
    return `${language.toUpperCase()} · ${label}`;
  }
  return `Rivestream · ${label}`;
}

function inferRivestreamAudioLanguage(
  provider: string | undefined,
  quality: string | undefined,
): string | undefined {
  const raw = [provider, quality].filter(Boolean).join(" ").toLowerCase();
  if (raw.includes("hindi")) return "hi";
  if (raw.includes("german")) return "de";
  if (raw.includes("spanish")) return "es";
  if (raw.includes("english") || raw.includes("flowcast") || raw.includes("primevids")) return "en";
  return undefined;
}
