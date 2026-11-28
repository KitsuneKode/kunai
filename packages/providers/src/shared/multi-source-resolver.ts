import { createProviderCachePolicy, createResolveTrace, createTraceStep } from "@kunai/core";
import type {
  CachePolicy,
  ProviderEpisodeIdentity,
  ProviderExternalIds,
  ProviderFailure,
  ProviderId,
  ProviderReleaseInfo,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { ProviderHttpError } from "../runtime/fetch";
import { dropRefusedStreams, selectVerifiedStream } from "./resolve-gate";
import { createExhaustedResult, emitTraceEvent } from "./resolve-helpers";
import {
  createProviderLanguageEvidence,
  createProviderSourceEvidence,
  createStreamId,
  createVariantId,
  detectDynamicRangeFromLabel,
  finalizeCycleSourceInventory,
  normalizeProviderDisplayLabel,
  normalizeQualityLabel,
  parseSourceHost,
  providerInventorySourceId,
  qualityRankFromLabel,
} from "./source-inventory";
import { selectReadyStream } from "./startup-selection";
import {
  inferSubtitleFormat,
  normalizeIsoLanguageCode,
  normalizeIsoLanguageList,
} from "./subtitle-helpers";

/** One already-located media URL a small multi-server adapter can hand to the shared resolver. */
export interface MultiSourceStreamInput {
  readonly sourceKey: string;
  readonly sourceLabel?: string;
  readonly url: string;
  readonly qualityHint?: string;
  readonly protocol?: StreamCandidate["protocol"];
  readonly audioLanguages?: readonly string[];
  readonly presentation?: StreamCandidate["presentation"];
  readonly hardSubLanguage?: string;
  readonly subtitleDelivery?: StreamCandidate["subtitleDelivery"];
  readonly subtitleLanguages?: readonly string[];
  readonly headers?: StreamCandidate["headers"];
  readonly metadata?: StreamCandidate["metadata"];
}

export interface MultiSourceSubtitleInput {
  readonly sourceKey: string;
  readonly url: string;
  readonly language?: string;
  readonly label?: string;
  readonly type?: string;
}

export interface MultiSourceEmptySourceInput {
  readonly sourceKey: string;
  readonly label?: string;
  readonly host?: string;
  readonly metadata?: ProviderSourceCandidate["metadata"];
}

export interface MultiSourceResolvePayload {
  readonly streams: readonly MultiSourceStreamInput[];
  readonly subtitles?: readonly MultiSourceSubtitleInput[];
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  /** Source rows with no stream remain visible as skipped inventory. */
  readonly emptySources?: readonly MultiSourceEmptySourceInput[];
}

export interface MultiSourceResolverOptions {
  readonly providerId: ProviderId;
  readonly label: string;
  readonly input: ProviderResolveInput;
  readonly context: ProviderRuntimeContext;
  readonly supportedMediaKinds: readonly ProviderResolveInput["mediaKind"][];
  readonly unsupportedMessage: string;
  readonly fetchPayload: () => Promise<MultiSourceResolvePayload | null>;
  /**
   * Strict opt-in for new adapters: only a positively verified probe accepts a
   * candidate — inconclusive answers (timeout, skipped, non-definitive
   * refusals) reject instead of passing as unverified. Established callers
   * stay on the default lenient gate.
   */
  readonly requireVerifiedStream?: boolean;
  /** Maximum candidates the shared gate may probe, after selection ordering. */
  readonly maxGateProbes?: number;
  readonly resolveGateTimeoutMs?: number;
  readonly episodeIdentity?: ProviderEpisodeIdentity;
  readonly traceMessage?: string;
}

function inferProtocol(url: string): StreamCandidate["protocol"] {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4")) return "mp4";
  if (lower.includes(".webm")) return "mp4";
  return "unknown";
}

function containerForProtocol(protocol: StreamCandidate["protocol"]): StreamCandidate["container"] {
  if (protocol === "hls") return "m3u8";
  if (protocol === "dash") return "mpd";
  if (protocol === "mp4") return "mp4";
  return "unknown";
}

function normalizeSourceKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "default";
}

function normalizeStreams(
  payload: MultiSourceResolvePayload,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
): StreamCandidate[] {
  const streams: StreamCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of payload.streams) {
    const url = entry.url.trim();
    if (!url || seen.has(`${entry.sourceKey}\n${url}`)) continue;
    seen.add(`${entry.sourceKey}\n${url}`);
    const sourceKey = normalizeSourceKey(entry.sourceKey);
    const sourceId = providerInventorySourceId(providerId, sourceKey);
    const sourceLabel =
      entry.sourceLabel ?? normalizeProviderDisplayLabel(entry.sourceKey) ?? entry.sourceKey;
    const protocol = entry.protocol ?? inferProtocol(url);
    const qualityLabel = normalizeQualityLabel(entry.qualityHint);
    const qualityRank = qualityRankFromLabel(entry.qualityHint) ?? 0;
    const audioLanguages = normalizeIsoLanguageList(entry.audioLanguages ?? []);
    const subtitleLanguages = normalizeIsoLanguageList(entry.subtitleLanguages ?? []);
    const languageEvidence = audioLanguages.map((language) =>
      createProviderLanguageEvidence({
        role: "audio",
        value: language,
        nativeLabel: language,
        sourceId,
        confidence: 0.85,
      }),
    );
    const sourceEvidence = [
      createProviderSourceEvidence({
        sourceId,
        serverId: sourceKey,
        nativeLabel: sourceLabel,
        url,
        confidence: 0.9,
      }),
    ];
    streams.push({
      id: createStreamId(providerId, [sourceKey, url, qualityLabel ?? "auto"]),
      providerId,
      sourceId,
      variantId: createVariantId(providerId, [sourceId, qualityLabel ?? "auto", url]),
      url,
      protocol,
      container: containerForProtocol(protocol),
      serverName: sourceLabel,
      flavorLabel: sourceLabel,
      flavorArchetype: sourceLabel,
      qualityLabel,
      qualityRank,
      dynamicRange: detectDynamicRangeFromLabel(entry.qualityHint),
      audioLanguages: audioLanguages.length > 0 ? audioLanguages : undefined,
      presentation: entry.presentation,
      hardSubLanguage: entry.hardSubLanguage,
      subtitleDelivery: entry.subtitleDelivery,
      subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
      headers: entry.headers,
      confidence: qualityRank > 0 ? 0.9 : 0.84,
      cachePolicy,
      languageEvidence,
      sourceEvidence,
      metadata: entry.metadata,
    });
  }
  return streams.sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0));
}

function normalizeSubtitles(
  payload: MultiSourceResolvePayload,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
): SubtitleCandidate[] {
  const subtitles: SubtitleCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of payload.subtitles ?? []) {
    const url = entry.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const sourceId = providerInventorySourceId(providerId, normalizeSourceKey(entry.sourceKey));
    const language = normalizeIsoLanguageCode(entry.language ?? entry.label);
    subtitles.push({
      id: `subtitle:${providerId}:${Bun.hash(url).toString(36)}`,
      providerId,
      sourceId,
      url,
      language,
      label: entry.label ?? entry.language ?? language,
      format: inferSubtitleFormat(url, entry.type),
      source: "provider",
      confidence: 0.85,
      cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
    });
  }
  return subtitles;
}

function sourceCandidates(
  streams: readonly StreamCandidate[],
  payload: MultiSourceResolvePayload,
  providerId: ProviderId,
  cachePolicy: CachePolicy,
): ProviderSourceCandidate[] {
  const byId = new Map<string, ProviderSourceCandidate>();
  for (const stream of streams) {
    const sourceId = stream.sourceId;
    if (!sourceId || byId.has(sourceId)) continue;
    byId.set(sourceId, {
      id: sourceId,
      providerId,
      kind: "provider-api",
      label: stream.serverName ?? stream.flavorLabel,
      host: stream.sourceEvidence?.[0]?.host ?? parseSourceHost(stream.url),
      status: "available",
      confidence: 0.86,
      requiresRuntime: "direct-http",
      cachePolicy,
      languageEvidence: stream.languageEvidence,
      sourceEvidence: stream.sourceEvidence,
      metadata: stream.metadata,
    });
  }
  for (const empty of payload.emptySources ?? []) {
    const sourceKey = normalizeSourceKey(empty.sourceKey);
    const sourceId = providerInventorySourceId(providerId, sourceKey);
    if (byId.has(sourceId)) continue;
    byId.set(sourceId, {
      id: sourceId,
      providerId,
      kind: "provider-api",
      label: empty.label ?? normalizeProviderDisplayLabel(empty.sourceKey) ?? empty.sourceKey,
      host: empty.host,
      status: "skipped",
      confidence: 0.4,
      requiresRuntime: "direct-http",
      cachePolicy,
      metadata: empty.metadata,
    });
  }
  return [...byId.values()];
}

function variantsForStreams(
  streams: readonly StreamCandidate[],
  subtitles: readonly SubtitleCandidate[],
  selectedStreamId: string,
): ProviderVariantCandidate[] {
  return streams.map((stream) => {
    const subtitleIds = subtitles
      .filter((subtitle) => subtitle.sourceId === stream.sourceId)
      .map((subtitle) => subtitle.id);
    return {
      id: stream.variantId ?? stream.id,
      providerId: stream.providerId,
      sourceId: stream.sourceId ?? "",
      label: stream.qualityLabel ?? stream.container ?? "auto",
      qualityLabel: stream.qualityLabel,
      qualityRank: stream.qualityRank,
      dynamicRange: stream.dynamicRange,
      protocol: stream.protocol,
      container: stream.container,
      audioLanguages: stream.audioLanguages,
      presentation: stream.presentation,
      hardSubLanguage: stream.hardSubLanguage,
      subtitleDelivery: stream.subtitleDelivery,
      subtitleLanguages: stream.subtitleLanguages,
      flavorArchetype: stream.flavorArchetype,
      flavorLabel: stream.flavorLabel,
      streamIds: [stream.id],
      subtitleIds,
      selected: stream.id === selectedStreamId,
      confidence: stream.confidence,
    };
  });
}

/**
 * Shared resolver for small multi-server direct providers. The adapter owns
 * discovery and parsing; this function owns inventory, selection, and the one
 * shared resolve gate, so probed and shipped candidates cannot diverge.
 */
export async function resolveMultiSourceProvider(
  options: MultiSourceResolverOptions,
): Promise<ProviderResolveResult> {
  const { providerId, label, input, context } = options;
  if (!options.supportedMediaKinds.includes(input.mediaKind)) {
    return createExhaustedResult(input, context, providerId, {
      code: "unsupported-title",
      message: options.unsupportedMessage,
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
  emitTraceEvent(events, context, {
    type: "provider:start",
    providerId,
    message: `Started ${label} resolution`,
  });

  try {
    const payload = await options.fetchPayload();
    const streams = payload ? normalizeStreams(payload, providerId, cachePolicy) : [];
    if (!payload || streams.length === 0) {
      return createExhaustedResult(
        input,
        context,
        providerId,
        { code: "not-found", message: `${label} returned no playable streams`, retryable: false },
        { cachePolicy, events, failures, startedAt },
      );
    }

    const subtitles = normalizeSubtitles(payload, providerId, cachePolicy);
    const selection = selectReadyStream(streams, {
      startupPriority: input.startupPriority,
      qualityPreference: input.qualityPreference,
      preferredStreamId: input.preferredStreamId,
      preferredSourceId: input.preferredSourceId,
      favoriteSourceNames: input.favoriteSourceNames,
    });
    const gateOrder = [
      selection.selected,
      ...streams.filter((stream) => stream.id !== selection.selected.id),
    ].slice(0, options.maxGateProbes ?? 3);
    const gated = await selectVerifiedStream({
      streams: gateOrder,
      context,
      signal: context.signal,
      requireVerifiedStream: options.requireVerifiedStream,
      ...(options.resolveGateTimeoutMs === undefined
        ? null
        : { timeoutMs: options.resolveGateTimeoutMs }),
    });
    if (context.signal?.aborted) {
      return createExhaustedResult(
        input,
        context,
        providerId,
        {
          code: "cancelled",
          message: `${label} resolve-gate probe was cancelled`,
          retryable: false,
        },
        { cachePolicy, events, failures, startedAt },
      );
    }
    if (!gated.accepted) {
      return createExhaustedResult(
        input,
        context,
        providerId,
        {
          code: "not-found",
          message: `${label} selected stream is unreachable (${gated.reason})`,
          retryable: true,
        },
        { cachePolicy, events, failures, startedAt },
      );
    }

    const shippedStreams = dropRefusedStreams(streams, gated.refusals);
    const sourceRows = finalizeCycleSourceInventory({
      sources: sourceCandidates(shippedStreams, payload, providerId, cachePolicy),
      attempts: [],
      streams: shippedStreams,
      selectedStreamId: gated.stream.id,
    });
    const variants = variantsForStreams(shippedStreams, subtitles, gated.stream.id);
    const endedAt = context.now();
    emitTraceEvent(events, context, {
      type: "provider:success",
      providerId,
      streamId: gated.stream.id,
      sourceId: gated.stream.sourceId,
      message: `${label} resolved ${shippedStreams.length} stream(s) and ${subtitles.length} subtitle(s)`,
      attributes: { streams: shippedStreams.length, subtitles: subtitles.length },
    });

    return {
      status: "resolved",
      providerId,
      selectedStreamId: gated.stream.id,
      streamReachabilityVerified: gated.verified,
      selectionDecision: { ...selection.decision, selectedQualityRank: gated.stream.qualityRank },
      sources: sourceRows,
      streams: shippedStreams,
      variants,
      subtitles,
      externalIds: payload.externalIds,
      release: payload.release,
      cachePolicy,
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId,
        streamId: gated.stream.id,
        cacheHit: false,
        runtime: "direct-http",
        startedAt,
        endedAt,
        steps: [
          createTraceStep("provider", options.traceMessage ?? `Resolved ${label} direct stream`, {
            providerId,
            attributes: { streams: shippedStreams.length, subtitles: subtitles.length },
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
      return createExhaustedResult(
        input,
        context,
        providerId,
        { code: "cancelled", message: `${label} resolution was cancelled`, retryable: false },
        { cachePolicy, events, failures, startedAt },
      );
    }
    const httpError = error instanceof ProviderHttpError ? error : undefined;
    const timedOut = error instanceof Error && /timed out|timeout/i.test(error.message);
    const failure: ProviderFailure = {
      providerId,
      code: httpError?.code ?? (timedOut ? "timeout" : "network-error"),
      message: error instanceof Error ? error.message : `${label} resolution failed`,
      retryable: httpError?.retryable ?? true,
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
}
