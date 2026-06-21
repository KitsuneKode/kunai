import { createProviderCachePolicy, createResolveTrace, createTraceStep } from "@kunai/core";
import type {
  CachePolicy,
  ProviderFailure,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";

import { createExhaustedResult, emitTraceEvent } from "./resolve-helpers";
import {
  createStreamId,
  createVariantId,
  normalizeQualityLabel,
  qualityRankFromLabel,
} from "./source-inventory";
import { runStreamHealthCheck, STREAM_HEALTH_DEFAULTS } from "./stream-health";
import { normalizeIsoLanguageCode } from "./subtitle-helpers";

/**
 * Shared engine for "P-Stream-style" direct-stream providers (vidlink, vidrock,
 * rgshows, …). A provider supplies its own `fetchPayload` that returns a simple
 * list of stream URLs + subtitles; this helper handles input validation, the
 * StreamCandidate/variant/source/trace boilerplate, and failure mapping.
 */

export interface DirectStreamInput {
  readonly url: string;
  /** Quality hint such as "1080", "720p", "4k" — used for label + ranking. */
  readonly qualityHint?: string;
}

export interface DirectSubtitleInput {
  readonly url: string;
  readonly language?: string;
  /** "srt" | "vtt" | file extension; inferred from the URL when omitted. */
  readonly type?: string;
  readonly label?: string;
}

export interface DirectStreamPayload {
  readonly streams: readonly DirectStreamInput[];
  readonly subtitles?: readonly DirectSubtitleInput[];
  /** Headers the player must send to fetch the stream (referer/origin/UA). */
  readonly headers?: Record<string, string>;
}

export interface DirectStreamFetchParams {
  readonly tmdbId: number;
  readonly season?: number;
  readonly episode?: number;
  readonly input: ProviderResolveInput;
  readonly context: ProviderRuntimeContext;
}

export interface DirectStreamSourceOptions {
  readonly providerId: ProviderId;
  /** Host shown in source inventory, e.g. "vidlink.pro". */
  readonly host: string;
  /** Human label for the source/server, e.g. "VidLink". */
  readonly label: string;
  readonly input: ProviderResolveInput;
  readonly context: ProviderRuntimeContext;
  readonly fetchPayload: (params: DirectStreamFetchParams) => Promise<DirectStreamPayload | null>;
  /** When true, probe the selected stream before returning (resolve-gate). */
  readonly resolveGateProbe?: boolean;
  readonly resolveGateTimeoutMs?: number;
}

export async function resolveDirectStreamSource(
  options: DirectStreamSourceOptions,
): Promise<ProviderResolveResult> {
  const { providerId, host, label, input, context, fetchPayload, resolveGateProbe } = options;

  if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
    return createExhaustedResult(input, context, providerId, {
      code: "unsupported-title",
      message: `${label} only supports movie and series content`,
      retryable: false,
    });
  }
  if (!input.allowedRuntimes.includes("direct-http")) {
    return createExhaustedResult(input, context, providerId, {
      code: "runtime-missing",
      message: `${label} requires the direct-http runtime`,
      retryable: false,
    });
  }

  const tmdbId = resolveTmdbId(input.title);
  if (!tmdbId) {
    return createExhaustedResult(input, context, providerId, {
      code: "unsupported-title",
      message: `${label} requires a numeric TMDB id`,
      retryable: false,
    });
  }
  if (input.mediaKind === "series" && (!input.episode?.season || !input.episode.episode)) {
    return createExhaustedResult(input, context, providerId, {
      code: "unsupported-title",
      message: `${label} requires season and episode for series`,
      retryable: false,
    });
  }

  const startedAt = context.now();
  const events: ProviderTraceEvent[] = [];
  const failures: ProviderFailure[] = [];
  const cachePolicy = createProviderCachePolicy({
    providerId,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
    startupPriority: input.startupPriority,
  });
  const sourceId = `source:${providerId}:${providerId}`;

  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId,
    message: `Started ${label} direct resolution`,
  });
  emitTraceEvent(events, context, {
    type: "source:start",
    providerId,
    sourceId,
    message: `Trying ${label} direct source`,
    attributes: { host },
  });

  try {
    const payload = await fetchPayload({
      tmdbId,
      season: input.episode?.season,
      episode: input.episode?.episode,
      input,
      context,
    });

    const streams = payload
      ? normalizeStreams(payload, providerId, sourceId, label, cachePolicy)
      : [];
    let selectedStream = streams[0];
    if (!selectedStream) {
      const failure: ProviderFailure = {
        providerId,
        code: "not-found",
        message: `${label} returned no playable streams`,
        retryable: false,
        at: context.now(),
      };
      failures.push(failure);
      return createExhaustedResult(input, context, providerId, failure, {
        cachePolicy,
        events,
        failures,
        startedAt,
      });
    }

    let streamReachabilityVerified: boolean | undefined;
    if (resolveGateProbe && selectedStream.url) {
      const health = await runStreamHealthCheck({
        phase: "resolve-gate",
        url: selectedStream.url,
        headers: selectedStream.headers,
        fetchImpl: context.fetch?.fetch.bind(context.fetch),
        timeoutMs: options.resolveGateTimeoutMs ?? STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs,
        signal: context.signal,
      });
      if (!health.healthy) {
        const probe = health.probe;
        const reason =
          probe?.status === "timeout"
            ? "stream probe timed out"
            : probe?.status === "unreachable"
              ? probe.reason
              : "stream probe failed";
        const failure: ProviderFailure = {
          providerId,
          code: probe?.status === "timeout" ? "timeout" : "not-found",
          message: `${label} selected stream is unreachable (${reason})`,
          retryable: true,
          at: context.now(),
        };
        failures.push(failure);
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId,
          sourceId,
          streamId: selectedStream.id,
          message: `${label} resolve-gate probe failed`,
          attributes: { reason, probe: probe?.status ?? "failed" },
        });
        return createExhaustedResult(input, context, providerId, failure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }
      streamReachabilityVerified = true;
    }

    emitTraceEvent(events, context, {
      type: "source:success",
      providerId,
      sourceId,
      streamId: selectedStream.id,
      message: `${label} selected ${selectedStream.qualityLabel ?? "auto"} stream`,
      attributes: { streams: streams.length },
    });

    const subtitles = normalizeSubtitles(
      payload?.subtitles ?? [],
      providerId,
      sourceId,
      cachePolicy,
    );
    const variants = streams.map<ProviderVariantCandidate>((stream) => ({
      id: stream.variantId ?? stream.id,
      providerId,
      sourceId,
      label: stream.qualityLabel ?? stream.container ?? "auto",
      qualityLabel: stream.qualityLabel,
      qualityRank: stream.qualityRank,
      protocol: stream.protocol,
      container: stream.container,
      streamIds: [stream.id],
      subtitleIds: subtitles.map((sub) => sub.id),
      subtitleLanguages: subtitles
        .map((sub) => sub.language)
        .filter((lang): lang is string => Boolean(lang)),
      selected: stream.id === selectedStream.id,
      confidence: stream.confidence,
    }));

    emitTraceEvent(events, context, {
      type: "provider:success",
      providerId,
      sourceId,
      streamId: selectedStream.id,
      message: `${label} resolved ${streams.length} stream(s) and ${subtitles.length} subtitle(s)`,
    });

    const endedAt = context.now();
    return {
      status: "resolved",
      providerId,
      selectedStreamId: selectedStream.id,
      streamReachabilityVerified,
      sources: [
        {
          id: sourceId,
          providerId,
          kind: "provider-api",
          label,
          host,
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
        providerId,
        streamId: selectedStream.id,
        cacheHit: false,
        runtime: "direct-http",
        startedAt,
        endedAt,
        steps: [
          createTraceStep("provider", `Resolved ${label} direct stream`, {
            providerId,
            attributes: { streams: streams.length, subtitles: subtitles.length },
          }),
        ],
        events,
        failures,
      }),
      failures,
      healthDelta: { providerId, outcome: "success", at: endedAt },
    };
  } catch (error) {
    if (context.signal?.aborted) {
      return createExhaustedResult(input, context, providerId, {
        code: "cancelled",
        message: `${label} resolution was cancelled`,
        retryable: false,
      });
    }
    const timedOut = isTimeoutError(error);
    const failure: ProviderFailure = {
      providerId,
      code: timedOut ? "timeout" : "network-error",
      message: error instanceof Error ? error.message : `${label} resolution failed`,
      retryable: true,
      at: context.now(),
    };
    failures.push(failure);
    emitTraceEvent(events, context, {
      type: "source:failed",
      providerId,
      sourceId,
      message: `${label} direct source failed`,
      attributes: { code: failure.code },
    });
    return createExhaustedResult(input, context, providerId, failure, {
      cachePolicy,
      events,
      failures,
      startedAt,
    });
  }
}

function normalizeStreams(
  payload: DirectStreamPayload,
  providerId: ProviderId,
  sourceId: string,
  label: string,
  cachePolicy: CachePolicy,
): StreamCandidate[] {
  const streams: StreamCandidate[] = [];
  const seen = new Set<string>();
  const headers = payload.headers;

  for (const entry of payload.streams) {
    if (!entry.url || seen.has(entry.url)) continue;
    seen.add(entry.url);
    const protocol = inferProtocol(entry.url);
    const qualityLabel = normalizeQualityLabel(entry.qualityHint);
    const qualityRank = qualityRankFromLabel(entry.qualityHint) ?? 0;
    streams.push({
      id: createStreamId(providerId, [entry.url]),
      providerId,
      sourceId,
      variantId: createVariantId(providerId, [sourceId, qualityLabel, entry.url]),
      url: entry.url,
      protocol,
      container: containerForProtocol(protocol),
      qualityLabel,
      qualityRank,
      serverName: label,
      headers,
      confidence: qualityRank > 0 ? 0.9 : 0.82,
      cachePolicy,
    });
  }

  return streams.sort((a, b) => (b.qualityRank ?? 0) - (a.qualityRank ?? 0));
}

function normalizeSubtitles(
  captions: readonly DirectSubtitleInput[],
  providerId: ProviderId,
  sourceId: string,
  cachePolicy: CachePolicy,
): SubtitleCandidate[] {
  const subtitles: SubtitleCandidate[] = [];
  const seen = new Set<string>();
  for (const caption of captions) {
    if (!caption.url || seen.has(caption.url)) continue;
    seen.add(caption.url);
    subtitles.push({
      id: `subtitle:${providerId}:${hashId(caption.url)}`,
      providerId,
      sourceId,
      url: caption.url,
      language: normalizeIsoLanguageCode(caption.language),
      label: caption.label ?? caption.language,
      format: inferSubtitleFormat(caption.url, caption.type),
      source: "provider",
      confidence: 0.85,
      cachePolicy: {
        ...cachePolicy,
        ttlClass: "subtitle-list",
        keyParts: [...cachePolicy.keyParts, "subtitles"],
      },
    });
  }
  return subtitles;
}

type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

/** Combine an optional caller signal with a per-request timeout. */
export function directStreamFetchSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctor = AbortSignal as AbortSignalConstructorWithAny;
  if (!signal) return AbortSignal.timeout(ms);
  return ctor.any ? ctor.any([signal, AbortSignal.timeout(ms)]) : signal;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /timed out|timeout/i.test(error.message);
}

function resolveTmdbId(title: TitleIdentity): number | null {
  const raw = title.tmdbId ?? title.id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferProtocol(url: string): StreamCandidate["protocol"] {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4")) return "mp4";
  return "unknown";
}

function containerForProtocol(protocol: StreamCandidate["protocol"]): StreamCandidate["container"] {
  if (protocol === "hls") return "m3u8";
  if (protocol === "dash") return "mpd";
  if (protocol === "mp4") return "mp4";
  return "unknown";
}

function inferSubtitleFormat(url: string, type?: string): SubtitleCandidate["format"] {
  const lower = (type ?? url).toLowerCase();
  if (lower.endsWith(".srt") || lower === "srt") return "srt";
  if (lower.endsWith(".vtt") || lower === "vtt") return "vtt";
  if (lower.endsWith(".ass")) return "ass";
  return "unknown";
}

function hashId(value: string): string {
  return Bun.hash(value).toString(36);
}
