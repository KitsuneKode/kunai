import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  ProviderFailure,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { TTLCache } from "../shared/provider-cache";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { miruroManifest, MIRURO_PROVIDER_ID } from "./manifest";

export { MIRURO_PROVIDER_ID };
export const MIRURO_REFERER = "https://www.miruro.tv/";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";
const PIPE_URL = "https://www.miruro.tv/api/secure/pipe";

/** Cache episode lists per AniList ID. TTL 30 minutes (episode data is stable). */
const episodeCache = new TTLCache<string, unknown>(1_800_000);
/** Cache source responses per episode+category. TTL 5 minutes. */
const sourceCache = new TTLCache<string, unknown>(300_000);

type MiruroPipeStream = {
  readonly url?: string;
  readonly type?: "hls" | "embed";
  readonly quality?: string;
  readonly referer?: string;
  readonly resolution?: { readonly width?: number; readonly height?: number };
  readonly codec?: string;
  readonly audio?: string;
  readonly fansub?: string;
  readonly isActive?: boolean;
};

type MiruroSourcesResponse = {
  readonly streams?: readonly MiruroPipeStream[];
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
  readonly download?: string;
};

type MiruroEpisodeEntry = {
  readonly id: string;
  readonly number: number;
  readonly title?: string;
};

type MiruroEpisodesResponse = {
  readonly mappings?: Record<string, unknown>;
  readonly providers?: {
    readonly kiwi?: {
      readonly meta?: Record<string, unknown>;
      readonly episodes?: {
        readonly sub?: readonly MiruroEpisodeEntry[];
        readonly dub?: readonly MiruroEpisodeEntry[];
      };
    };
  };
};

function base64urlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function xorDecrypt(encrypted: Uint8Array, keyHex: string): Uint8Array {
  const parts = keyHex.match(/.{2}/g) ?? [];
  if (parts.length === 0) throw new Error("Invalid Miruro pipe key");
  const key = new Uint8Array(parts.map((b) => parseInt(b, 16)));
  const result = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    result[i] = (encrypted[i] ?? 0) ^ (key[i % key.length] ?? 0);
  }
  return result;
}

async function pipeCall(
  path: string,
  query: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) q[k] = String(v);

  const payload = { path, method: "GET" as const, query: q, body: null, version: "0.2.0" };
  const encoded = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const url = `${PIPE_URL}?e=${encoded}`;

  try {
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": USER_AGENT,
        Referer: MIRURO_REFERER,
        Origin: MIRURO_REFERER.slice(0, -1),
        Accept: "application/json, text/plain, */*",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    });
    if (!res.ok) return null;

    const body = await res.text();
    if (!body.startsWith("bh4YNPj7") && res.headers.get("x-obfuscated") !== "2") return null;

    const raw = base64urlToBytes(body);
    const decrypted = xorDecrypt(raw, PIPE_KEY);
    let json: string;
    if (decrypted[0] === 31 && decrypted[1] === 139) {
      json = new TextDecoder().decode(Bun.gunzipSync(decrypted.buffer as ArrayBuffer));
    } else {
      json = new TextDecoder().decode(decrypted);
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const miruroProviderModule: CoreProviderModule = {
  providerId: MIRURO_PROVIDER_ID,
  manifest: miruroManifest,
  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro pipe resolver only supports anime",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Miruro pipe resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const anilistId = input.title.anilistId ?? input.title.id.replace("anilist:", "");
    if (!anilistId || Number.isNaN(Number(anilistId))) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro pipe resolver requires a numeric AniList ID",
        retryable: false,
      });
    }

    const episodeNum = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: MIRURO_PROVIDER_ID,
      message: "Started Miruro pipe resolution",
    });

    const sourceId = `source:${MIRURO_PROVIDER_ID}:pipe`;
    const cachePolicy = createProviderCachePolicy({
      providerId: MIRURO_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
    });

    try {
      // Step 1: Fetch episode list to get the episodeId (cached 30m)
      const epCacheKey = `episodes:${anilistId}`;
      let epData = episodeCache.get(epCacheKey) as MiruroEpisodesResponse | null;
      if (!epData) {
        epData = (await pipeCall(
          "episodes",
          { anilistId: Number(anilistId) },
          context.signal,
        )) as MiruroEpisodesResponse | null;
        if (epData) episodeCache.set(epCacheKey, epData);
      }
      if (!epData?.providers?.kiwi?.episodes) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: "No episode data from miruro pipe API",
          retryable: true,
        });
      }

      const targetAudio = input.preferredAudioLanguage === "dub" ? "dub" : "sub";
      const fallbackAudio = targetAudio === "dub" ? "sub" : "dub";
      const episodeList =
        epData.providers.kiwi.episodes[targetAudio] ??
        epData.providers.kiwi.episodes[fallbackAudio];
      if (!episodeList?.length) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: `No ${targetAudio} episodes available`,
          retryable: true,
        });
      }

      const episodeEntry =
        episodeList.find((e) => e.number === episodeNum) ??
        episodeList[episodeNum - 1] ??
        episodeList[0];
      if (!episodeEntry?.id) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: `Episode ${episodeNum} has no ID in miruro data`,
          retryable: false,
        });
      }

      // Step 2: Fetch sources for this episode (cached 5m)
      const srcCacheKey = `sources:${episodeEntry.id}:${targetAudio}`;
      let srcData = sourceCache.get(srcCacheKey) as MiruroSourcesResponse | null;
      if (!srcData) {
        srcData = (await pipeCall(
          "sources",
          {
            episodeId: episodeEntry.id,
            anilistId: Number(anilistId),
            provider: "kiwi",
            category: targetAudio,
          },
          context.signal,
        )) as MiruroSourcesResponse | null;
        if (srcData) sourceCache.set(srcCacheKey, srcData);
      }

      const rawStreams = srcData?.streams?.filter((s) => s.type === "hls" && s.url) ?? [];
      if (rawStreams.length === 0) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: "No HLS streams from miruro sources pipe",
          retryable: true,
        });
      }

      // Map to StreamCandidate + ProviderVariantCandidate
      const streams: StreamCandidate[] = [];
      const variants: ProviderVariantCandidate[] = [];
      const subtitles: SubtitleCandidate[] = [];

      for (const raw of rawStreams) {
        if (!raw.url) continue;
        const qualityStr = raw.quality || "auto";
        const streamId = `stream:${MIRURO_PROVIDER_ID}:${Bun.hash(raw.url).toString(36)}`;
        const variantId = `variant:${MIRURO_PROVIDER_ID}:${sourceId}:${qualityStr}`;
        const streamReferer = raw.referer || MIRURO_REFERER;

        streams.push({
          id: streamId,
          providerId: MIRURO_PROVIDER_ID,
          sourceId,
          variantId,
          url: raw.url,
          protocol: "hls",
          container: "m3u8",
          audioLanguages: [targetAudio],
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          headers: {
            referer: streamReferer,
            "user-agent": USER_AGENT,
          },
          confidence: 0.95,
          cachePolicy,
        });

        variants.push({
          id: variantId,
          providerId: MIRURO_PROVIDER_ID,
          sourceId,
          qualityLabel: qualityStr,
          qualityRank: parseInt(qualityStr) || 0,
          protocol: "hls",
          container: "m3u8",
          audioLanguages: [targetAudio],
          streamIds: [streamId],
          confidence: 0.95,
        });
      }

      // Sort by quality
      streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
      variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

      const selectedStream =
        streams.find((s) => s.qualityLabel?.includes(input.qualityPreference || "")) ?? streams[0];

      if (!selectedStream) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: "No selectable miruro stream",
          retryable: false,
        });
      }

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: MIRURO_PROVIDER_ID,
        message: `Resolved Miruro stream for AniList ID ${anilistId}`,
      });

      const endedAt = context.now();

      return {
        providerId: MIRURO_PROVIDER_ID,
        selectedStreamId: selectedStream.id,
        sources: [
          {
            id: sourceId,
            providerId: MIRURO_PROVIDER_ID,
            kind: "provider-api",
            label: "miruro.tv pipe",
            host: "www.miruro.tv",
            status: "selected",
            confidence: 0.9,
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
          providerId: MIRURO_PROVIDER_ID,
          streamId: selectedStream.id,
          cacheHit: false,
          runtime: "direct-http",
          startedAt,
          endedAt,
          steps: [
            createTraceStep("provider", "Resolved Miruro through pipe API", {
              providerId: MIRURO_PROVIDER_ID,
              attributes: { streams: streams.length },
            }),
          ],
          events,
          failures,
        }),
        failures,
        healthDelta: {
          providerId: MIRURO_PROVIDER_ID,
          outcome: "success",
          at: endedAt,
        },
      };
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "cancelled",
          message: "Miruro resolution was cancelled",
          retryable: false,
        });
      }

      failures.push({
        providerId: MIRURO_PROVIDER_ID,
        code: "network-error",
        message: error instanceof Error ? error.message : "Miruro pipe API failed",
        retryable: true,
        at: context.now(),
      });

      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "network-error",
        message: error instanceof Error ? error.message : "Miruro pipe API failed",
        retryable: true,
      });
    }
  },
};
