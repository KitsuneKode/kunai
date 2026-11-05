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
} from "@kunai/types";

import { ProviderHttpError } from "../runtime/fetch";
import { resolveTmdbCatalogId } from "./catalog-id";
import { verifyCandidateStream, type CandidateStreamVerdict } from "./resolve-gate";
import { createExhaustedResult, emitTraceEvent } from "./resolve-helpers";
import { hasResolvableSeriesCoordinates } from "./series-coordinates";
import {
  createStreamId,
  createVariantId,
  normalizeQualityLabel,
  qualityRankFromLabel,
} from "./source-inventory";
import { normalizeIsoLanguageCode } from "./subtitle-helpers";
import { createTimeoutSignal } from "./timeout-signal";

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
  /** Protocol observed from a fetched manifest, for extensionless endpoints. */
  readonly protocol?: StreamCandidate["protocol"];
  readonly serverLabel?: string;
  readonly audioLanguages?: readonly string[];
  readonly presentation?: import("@kunai/types").StreamPresentation;
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
  /** Explicit HTTP 200 JSON null, distinct from parse, transport or probe failure. */
  readonly catalogAbsent?: boolean;
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
  /** Optional delay in ms before hedging the next candidate probe if primary stalls (default: 2,000ms). */
  readonly resolveGateHedgeDelayMs?: number;
  /** When true, allows hedging next candidate on the same host (default: false, avoiding CDN 429). */
  readonly resolveGateAllowSameHostHedge?: boolean;
}

/**
 * How many ranked candidates the resolve gate may probe before giving up.
 *
 * Probing only `streams[0]` meant one throttled or hotlink-protected URL
 * condemned every working sibling in the same payload, failing the whole
 * provider. The walk is capped because each probe costs a round trip against
 * the attempt budget — a lower-quality stream that plays beats a perfect one
 * that never arrives, but not at unbounded cost.
 */
const RESOLVE_GATE_MAX_PROBES = 3;

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

  const tmdbId = resolveTmdbCatalogId(input.title);
  if (!tmdbId) {
    return createExhaustedResult(input, context, providerId, {
      code: "unsupported-title",
      message: `${label} requires a numeric TMDB id`,
      retryable: false,
    });
  }
  if (input.mediaKind === "series" && !hasResolvableSeriesCoordinates(input.episode)) {
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

    let streams = payload
      ? normalizeStreams(
          payload,
          providerId,
          sourceId,
          label,
          cachePolicy,
          input.preferredAudioLanguage,
        )
      : [];
    let selectedStream = input.preferredStreamId
      ? (streams.find((s) => s.id === input.preferredStreamId) ?? streams[0])
      : streams[0];
    if (!selectedStream) {
      if (payload?.catalogAbsent) {
        emitTraceEvent(events, context, {
          type: "source:failed",
          providerId,
          sourceId,
          message: "Provider explicitly reported catalog absence",
          attributes: { catalogAbsent: true, httpStatus: 200, responseKind: "json-null" },
        });
      }
      const failure: ProviderFailure = {
        providerId,
        code: payload?.catalogAbsent ? "not-found" : payload ? "provider-unavailable" : "not-found",
        message: payload?.catalogAbsent
          ? `${label} returned no playable streams`
          : payload
            ? `${label} returned no playable streams (upstream CDN/manifest refusal)`
            : `${label} returned no playable streams`,
        retryable: Boolean(payload && !payload.catalogAbsent),
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
    const refusedStreamIds = new Set<string>();
    if (resolveGateProbe) {
      let gateFailure: ProviderFailure | undefined;
      let cancelled = false;

      // Probe the user's pinned stream first, so the first healthy default
      // cannot silently replace an explicit quality/audio choice.
      const initialStreamId = selectedStream.id;
      const probeOrder = (
        input.preferredStreamId
          ? [selectedStream, ...streams.filter((stream) => stream.id !== initialStreamId)]
          : streams
      )
        .slice(0, RESOLVE_GATE_MAX_PROBES)
        .filter((candidate) => Boolean(candidate.url));

      const hedgeDelayMs = options.resolveGateHedgeDelayMs ?? 2_000;
      let candidateIndex = 0;

      while (candidateIndex < probeOrder.length) {
        if (context.signal?.aborted) {
          cancelled = true;
          break;
        }

        const candidate = probeOrder[candidateIndex];
        if (!candidate) {
          candidateIndex++;
          continue;
        }
        // Only hedge if nextCandidate is on a different host (or resolveGateAllowSameHostHedge is true), avoiding concurrent probes that trigger CDN 429
        let nextCandidate: typeof candidate | undefined;
        let nextCandidateIndex = -1;
        const currentHost = candidate.url ? new URL(candidate.url).hostname : undefined;
        for (let j = candidateIndex + 1; j < probeOrder.length; j++) {
          const cand = probeOrder[j];
          if (!cand?.url) continue;
          const candHost = new URL(cand.url).hostname;
          if (options.resolveGateAllowSameHostHedge || !candHost || candHost !== currentHost) {
            nextCandidate = cand;
            nextCandidateIndex = j;
            break;
          }
        }

        const effectiveHedgeDelayMs =
          options.resolveGateTimeoutMs && options.resolveGateTimeoutMs <= hedgeDelayMs + 300
            ? 0
            : hedgeDelayMs;

        const currentAbort = new AbortController();
        const nextAbort = new AbortController();
        const onAbort = () => {
          currentAbort.abort(context.signal?.reason);
          nextAbort.abort(context.signal?.reason);
        };
        context.signal?.addEventListener("abort", onAbort, { once: true });

        const probeCandidate = (cand: typeof candidate, signal: AbortSignal) =>
          verifyCandidateStream({
            stream: cand,
            context,
            signal,
            ...(options.resolveGateTimeoutMs === undefined
              ? null
              : { timeoutMs: options.resolveGateTimeoutMs }),
          });

        type RacedProbeResult =
          | { readonly which: "primary"; readonly verdict: CandidateStreamVerdict }
          | { readonly which: "backup"; readonly verdict: CandidateStreamVerdict };

        const primaryPromise: Promise<RacedProbeResult> = probeCandidate(
          candidate,
          currentAbort.signal,
        ).then(
          (verdict) => ({ which: "primary", verdict }),
          (err) => ({ which: "primary", verdict: { accepted: false, reason: String(err) } }),
        );

        let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
        let backupPromise: Promise<RacedProbeResult> | undefined;

        if (nextCandidate && effectiveHedgeDelayMs > 0) {
          const hedgedCandidate = nextCandidate;
          const nextSig = nextAbort.signal;
          backupPromise = new Promise<RacedProbeResult>((resolve) => {
            hedgeTimer = setTimeout(() => {
              hedgeTimer = undefined;
              if (currentAbort.signal.aborted || context.signal?.aborted) return;
              probeCandidate(hedgedCandidate, nextSig).then(
                (verdict) => resolve({ which: "backup", verdict }),
                (err) =>
                  resolve({ which: "backup", verdict: { accepted: false, reason: String(err) } }),
              );
            }, effectiveHedgeDelayMs);
          });
        }

        try {
          if (!nextCandidate || !backupPromise) {
            const { verdict } = await primaryPromise;
            if (context.signal?.aborted) {
              cancelled = true;
              break;
            }
            if (verdict.accepted) {
              selectedStream = candidate;
              streamReachabilityVerified = verdict.verified;
              gateFailure = undefined;
              break;
            }

            refusedStreamIds.add(candidate.id);
            const probe = verdict.probe;
            const reason = verdict.reason;
            gateFailure ??= {
              providerId,
              code: probe?.status === "timeout" ? "timeout" : "not-found",
              message: `${label} selected stream is unreachable (${reason})`,
              retryable: true,
              at: context.now(),
            };
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId,
              sourceId,
              streamId: candidate.id,
              message: `${label} resolve-gate probe failed`,
              attributes: { reason, probe: probe?.status ?? "failed" },
            });
            candidateIndex++;
            continue;
          }

          const hedgedCandidate = nextCandidate;
          const firstResult = await Promise.race([primaryPromise, backupPromise]);

          if (firstResult.which === "primary") {
            if (firstResult.verdict.accepted) {
              nextAbort.abort();
              selectedStream = candidate;
              streamReachabilityVerified = firstResult.verdict.verified;
              gateFailure = undefined;
              break;
            }

            refusedStreamIds.add(candidate.id);
            const probe = firstResult.verdict.probe;
            const reason = firstResult.verdict.reason;
            gateFailure ??= {
              providerId,
              code: probe?.status === "timeout" ? "timeout" : "not-found",
              message: `${label} selected stream is unreachable (${reason})`,
              retryable: true,
              at: context.now(),
            };
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId,
              sourceId,
              streamId: candidate.id,
              message: `${label} resolve-gate probe failed`,
              attributes: { reason, probe: probe?.status ?? "failed" },
            });

            if (hedgeTimer) {
              clearTimeout(hedgeTimer);
              hedgeTimer = undefined;
              nextAbort.abort();
              candidateIndex++;
              continue;
            }

            const backupResult = await backupPromise;
            if (context.signal?.aborted) {
              cancelled = true;
              break;
            }
            if (backupResult.verdict.accepted) {
              selectedStream = hedgedCandidate;
              streamReachabilityVerified = backupResult.verdict.verified;
              gateFailure = undefined;
              break;
            }

            refusedStreamIds.add(hedgedCandidate.id);
            const nextProbe = backupResult.verdict.probe;
            const nextReason = backupResult.verdict.reason;
            gateFailure ??= {
              providerId,
              code: nextProbe?.status === "timeout" ? "timeout" : "not-found",
              message: `${label} selected stream is unreachable (${nextReason})`,
              retryable: true,
              at: context.now(),
            };
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId,
              sourceId,
              streamId: hedgedCandidate.id,
              message: `${label} resolve-gate probe failed`,
              attributes: { reason: nextReason, probe: nextProbe?.status ?? "failed" },
            });
            candidateIndex = nextCandidateIndex + 1;
            continue;
          } else {
            // Backup finished first!
            if (firstResult.verdict.accepted) {
              currentAbort.abort();
              primaryPromise.catch(() => undefined);
              selectedStream = hedgedCandidate;
              streamReachabilityVerified = firstResult.verdict.verified;
              gateFailure = undefined;
              break;
            }

            refusedStreamIds.add(hedgedCandidate.id);
            const nextProbe = firstResult.verdict.probe;
            const nextReason = firstResult.verdict.reason;
            gateFailure ??= {
              providerId,
              code: nextProbe?.status === "timeout" ? "timeout" : "not-found",
              message: `${label} selected stream is unreachable (${nextReason})`,
              retryable: true,
              at: context.now(),
            };
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId,
              sourceId,
              streamId: hedgedCandidate.id,
              message: `${label} resolve-gate probe failed`,
              attributes: { reason: nextReason, probe: nextProbe?.status ?? "failed" },
            });

            const primaryResult = await primaryPromise;
            if (context.signal?.aborted) {
              cancelled = true;
              break;
            }
            if (primaryResult.verdict.accepted) {
              selectedStream = candidate;
              streamReachabilityVerified = primaryResult.verdict.verified;
              gateFailure = undefined;
              break;
            }

            refusedStreamIds.add(candidate.id);
            const primaryProbe = primaryResult.verdict.probe;
            const primaryReason = primaryResult.verdict.reason;
            gateFailure ??= {
              providerId,
              code: primaryProbe?.status === "timeout" ? "timeout" : "not-found",
              message: `${label} selected stream is unreachable (${primaryReason})`,
              retryable: true,
              at: context.now(),
            };
            emitTraceEvent(events, context, {
              type: "source:failed",
              providerId,
              sourceId,
              streamId: candidate.id,
              message: `${label} resolve-gate probe failed`,
              attributes: { reason: primaryReason, probe: primaryProbe?.status ?? "failed" },
            });
            candidateIndex = nextCandidateIndex + 1;
            continue;
          }
        } finally {
          if (hedgeTimer) clearTimeout(hedgeTimer);
          context.signal?.removeEventListener("abort", onAbort);
        }
      }

      // Cancellation outranks a partial gate failure. If the caller aborted, any
      // rejection collected before the abort describes a probe the user no
      // longer cares about. Return cancellation rather than handing off a
      // selection from an abandoned resolve.
      if (cancelled && !streamReachabilityVerified) {
        return createExhaustedResult(
          input,
          context,
          providerId,
          {
            code: "cancelled",
            message: `${label} resolve was cancelled`,
            retryable: false,
          },
          { cachePolicy, events, failures, startedAt },
        );
      }

      if (gateFailure) {
        failures.push(gateFailure);
        return createExhaustedResult(input, context, providerId, gateFailure, {
          cachePolicy,
          events,
          failures,
          startedAt,
        });
      }
      // A refusal belongs to the probed request, not every URL on its host:
      // one quality path can be gone while a lower rung on the same CDN works.
      // Remove refused choices before building variants and shipping inventory.
      streams = streams.filter((stream) => !refusedStreamIds.has(stream.id));
    }

    emitTraceEvent(events, context, {
      type: "source:success",
      providerId,
      sourceId,
      streamId: selectedStream.id,
      message: `${label} selected ${selectedStream.qualityLabel ?? "auto"} stream`,
      attributes: { streams: streams.length },
    });

    // Ship the inventory without the rungs the gate refused — leaving them in
    // lets a later quality/source pick select the exact stream the probe
    // rejected.
    const liveStreams = streams.filter((stream) => !refusedStreamIds.has(stream.id));
    const subtitles = normalizeSubtitles(
      payload?.subtitles ?? [],
      providerId,
      sourceId,
      cachePolicy,
    );
    const variants = liveStreams.map<ProviderVariantCandidate>((stream) => ({
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
      streams: liveStreams,
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
    // A ProviderHttpError already carries the classified code and retryability
    // (e.g. 429 → rate-limited, 403 → blocked); collapsing it to network-error
    // would retry-storm throttled endpoints and mis-report them as generic
    // network failures.
    const httpError = error instanceof ProviderHttpError ? error : undefined;
    const failure: ProviderFailure = {
      providerId,
      code: httpError?.code ?? (timedOut ? "timeout" : "network-error"),
      message: error instanceof Error ? error.message : `${label} resolution failed`,
      retryable: httpError?.retryable ?? true,
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
  preferredAudioLanguage?: string,
): StreamCandidate[] {
  const streams: StreamCandidate[] = [];
  const seen = new Set<string>();
  const headers = payload.headers;

  for (const entry of payload.streams) {
    if (!entry.url || seen.has(entry.url)) continue;
    seen.add(entry.url);
    const protocol = entry.protocol ?? inferProtocol(entry.url);
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
      serverName: entry.serverLabel ?? label,
      flavorLabel: entry.serverLabel ?? label,
      audioLanguages: entry.audioLanguages,
      presentation: entry.presentation,
      headers,
      confidence: qualityRank > 0 ? 0.9 : 0.82,
      cachePolicy,
    });
  }

  const requestedLang = normalizeIsoLanguageCode(preferredAudioLanguage);
  return streams.sort((a, b) => {
    if (requestedLang && requestedLang !== "original") {
      const aMatches = a.audioLanguages?.some(
        (lang) => normalizeIsoLanguageCode(lang) === requestedLang,
      )
        ? 1
        : 0;
      const bMatches = b.audioLanguages?.some(
        (lang) => normalizeIsoLanguageCode(lang) === requestedLang,
      )
        ? 1
        : 0;
      if (aMatches !== bMatches) return bMatches - aMatches;
    }
    return (b.qualityRank ?? 0) - (a.qualityRank ?? 0);
  });
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

/** Combine an optional caller signal with a per-request timeout. */
export function directStreamFetchSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return createTimeoutSignal(signal, ms);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /timed out|timeout/i.test(error.message);
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
