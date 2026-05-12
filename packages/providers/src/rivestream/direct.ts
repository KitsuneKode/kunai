/* oxlint-disable no-shadow */

import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { ProviderHttpError, providerJson } from "../runtime/fetch";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { rivestreamManifest, RIVESTREAM_PROVIDER_ID } from "./manifest";

export { RIVESTREAM_PROVIDER_ID };
export const RIVESTREAM_REFERER = "https://www.rivestream.app/";
export const RIVESTREAM_API_BASE = "https://www.rivestream.app/api/backendfetch";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
    });

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: RIVESTREAM_PROVIDER_ID,
      message: "Started Rivestream 0-RAM resolution",
    });

    try {
      const secretKey = generateSecretKey(tmdbId);
      const typeStr = input.mediaKind === "series" ? "tv" : "movie";
      const season = input.episode?.season ?? 1;
      const episode = input.episode?.episode ?? 1;

      // 1. Get Providers
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

      if (providers.length === 0) {
        throw new Error("No providers available");
      }

      // Internal Server Loop
      const streams: StreamCandidate[] = [];
      const variants: ProviderVariantCandidate[] = [];
      const subtitles: SubtitleCandidate[] = [];
      let sourceId = "";
      let serverUsed = "";

      for (const provider of providers) {
        serverUsed = provider;
        sourceId = `source:${RIVESTREAM_PROVIDER_ID}:${provider}`;

        let url = `${RIVESTREAM_API_BASE}?requestID=${typeStr}VideoProvider&id=${tmdbId}`;
        if (input.mediaKind === "series") url += `&season=${season}&episode=${episode}`;
        url += `&service=${provider}&secretKey=${secretKey}&proxyMode=noProxy`;

        try {
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

          if (rawSources.length > 0) {
            rawSources.forEach((s) => {
              if (!s.url) return;
              const qualityStr = String(s.quality || s.format || "auto");
              const streamId = `stream:${RIVESTREAM_PROVIDER_ID}:${Bun.hash(s.url).toString(36)}`;
              const variantId = `variant:${RIVESTREAM_PROVIDER_ID}:${sourceId}:${qualityStr}`;
              const protocol = s.url.includes(".m3u8") ? "hls" : "mp4";

              streams.push({
                id: streamId,
                providerId: RIVESTREAM_PROVIDER_ID,
                sourceId,
                variantId,
                url: s.url,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                headers: { referer: RIVESTREAM_REFERER, "user-agent": USER_AGENT },
                confidence: 0.95,
                cachePolicy,
              });

              variants.push({
                id: variantId,
                providerId: RIVESTREAM_PROVIDER_ID,
                sourceId,
                qualityLabel: qualityStr,
                qualityRank: parseInt(qualityStr) || 0,
                protocol,
                container: protocol === "hls" ? "m3u8" : "mp4",
                streamIds: [streamId],
                confidence: 0.95,
              });
            });

            // Extract embedded captions if present
            const responseData = sourceData.data;
            const embeddedCaptions =
              responseData &&
              typeof responseData === "object" &&
              !Array.isArray(responseData) &&
              "captions" in responseData
                ? responseData.captions
                : undefined;
            if (Array.isArray(embeddedCaptions)) {
              embeddedCaptions.forEach((sub) => {
                const subUrl = sub.url || sub.file;
                const lang = sub.lang || sub.language || sub.label || "unknown";
                if (!subUrl) return;
                subtitles.push({
                  id: `subtitle:${RIVESTREAM_PROVIDER_ID}:${Bun.hash(subUrl).toString(36)}`,
                  providerId: RIVESTREAM_PROVIDER_ID,
                  sourceId,
                  url: subUrl,
                  language: lang.split(" - ")[0].trim(), // e.g. "English - FlowCast" -> "English"
                  label: lang,
                  format: subUrl.endsWith(".vtt") ? "vtt" : "srt",
                  source: "provider",
                  confidence: 0.95,
                  cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
                });
              });
            }

            // We found sources, break the loop
            break;
          }
        } catch {
          // Silently swallow error and try next server
          failures.push({
            providerId: RIVESTREAM_PROVIDER_ID,
            code: "not-found",
            message: `Internal server ${provider} failed`,
            retryable: true,
            at: context.now(),
          });
        }
      }

      if (streams.length === 0) {
        throw new Error("All internal servers exhausted without returning streams.");
      }

      streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
      variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      const selectedStream =
        streams.find((s) => s.qualityLabel?.includes(input.qualityPreference || "")) || streams[0];
      if (!selectedStream) {
        throw new Error("No selectable Rivestream streams were mapped.");
      }

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: RIVESTREAM_PROVIDER_ID,
        message: `Successfully resolved Rivestream for TMDB ID ${tmdbId}`,
      });

      const endedAt = context.now();

      return {
        providerId: RIVESTREAM_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: [
          {
            id: sourceId,
            providerId: RIVESTREAM_PROVIDER_ID,
            kind: "provider-api",
            label: serverUsed,
            host: "rivestream.app",
            status: "selected",
            confidence: 0.95,
            requiresRuntime: "direct-http",
            cachePolicy,
          },
        ],
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

      return createExhaustedResult(input, context, RIVESTREAM_PROVIDER_ID, failure);
    }
  },
};
