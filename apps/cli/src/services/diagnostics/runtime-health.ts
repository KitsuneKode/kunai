import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";
import {
  collectRuntimeMemorySnapshot,
  formatRuntimeMemory,
  getRuntimeMemorySamples,
  summarizeRuntimeMemoryTrend,
  type RuntimeMemorySample,
  type RuntimeMemorySnapshot,
} from "@/services/diagnostics/runtime-memory";
import {
  formatProviderHealthBadge,
  resolveEffectiveProviderHealth,
  type EffectiveProviderHealthStatus,
} from "@/services/playback/provider-health-policy";
import type { ProviderHealth } from "@kunai/types";

export type RuntimeHealthTone = "neutral" | "info" | "success" | "warning" | "error";

export type RuntimeHealthLine = {
  readonly label: string;
  readonly detail: string;
  readonly tone: RuntimeHealthTone;
};

export type RuntimeHealthSnapshot = {
  readonly network: RuntimeHealthLine;
  readonly provider: RuntimeHealthLine;
  readonly memory: RuntimeHealthLine;
  readonly memoryTrend: RuntimeHealthLine;
};

const NETWORK_EVENT_TYPES = new Set([
  "network-sample",
  "network-buffering",
  "stream-stalled",
  "playback-started",
  "mpv-in-process-reconnect",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatFailureCode(failure: Record<string, unknown> | null): string | null {
  if (!failure) return null;

  const code = typeof failure.code === "string" ? failure.code : null;
  if (!code) return null;

  const retryable = asBoolean(failure.retryable);
  const message = typeof failure.message === "string" ? failure.message : null;
  const parts = [
    code,
    retryable === true ? "retryable" : retryable === false ? "not retryable" : null,
  ];
  if (message) parts.push(message);

  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function formatProviderAttemptFailure(context: Record<string, unknown> | null): string | null {
  if (!context) return null;
  const code = typeof context.failureCode === "string" ? context.failureCode : null;
  if (!code) return null;
  const retryable = asBoolean(context.retryable);
  const message = typeof context.failureMessage === "string" ? context.failureMessage : null;
  return [
    code,
    retryable === true ? "retryable" : retryable === false ? "not retryable" : null,
    message,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function formatElapsedMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}

function summarizeTraceContext(context: Record<string, unknown>): string | null {
  const trace = asRecord(context.trace);
  if (!trace) return null;

  const selectedProvider =
    (typeof trace.selectedProviderId === "string" ? trace.selectedProviderId : null) ??
    (typeof context.provider === "string" ? context.provider : null) ??
    (typeof context.providerId === "string" ? context.providerId : null);
  const cacheHit = asBoolean(trace.cacheHit);
  const streamCandidates = asFiniteNumber(context.streamCandidates);
  const subtitleCandidates = asFiniteNumber(context.subtitleCandidates);

  const parts = [
    selectedProvider,
    // Show "from cache" only on a hit — a miss is the normal first-play path, not worth surfacing
    cacheHit === true ? "from cache" : null,
    streamCandidates !== null ? `${streamCandidates} streams` : null,
    subtitleCandidates !== null ? `${subtitleCandidates} subtitles` : null,
  ];

  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

export function formatNetworkRate(bytesPerSecond: number | null | undefined): string {
  if (typeof bytesPerSecond !== "number" || !Number.isFinite(bytesPerSecond)) {
    return "unknown speed";
  }

  if (bytesPerSecond <= 0) return "0 B/s";
  const mib = bytesPerSecond / 1_048_576;
  if (mib >= 1) return `${mib.toFixed(1)} MiB/s`;
  const kib = bytesPerSecond / 1024;
  if (kib >= 1) return `${kib.toFixed(1)} KiB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function findLatestMpvEvent(
  recentEvents: readonly DiagnosticEvent[],
  eventTypes = NETWORK_EVENT_TYPES,
): DiagnosticEvent | undefined {
  return recentEvents.find((event) => {
    const context = asRecord(event.context);
    return (
      event.message === "MPV runtime event" &&
      typeof context?.event === "string" &&
      eventTypes.has(context.event)
    );
  });
}

export function summarizePlaybackNetworkHealth(
  recentEvents: readonly DiagnosticEvent[],
): RuntimeHealthLine {
  const event = findLatestMpvEvent(recentEvents);
  const context = asRecord(event?.context);
  const eventType = typeof context?.event === "string" ? context.event : null;

  if (!event || !context || !eventType) {
    return {
      label: "Network",
      detail: "waiting for mpv network telemetry",
      tone: "neutral",
    };
  }

  if (eventType === "stream-stalled") {
    const kind = typeof context.stallKind === "string" ? context.stallKind : "progress";
    const seconds = asFiniteNumber(context.secondsWithoutProgress);
    return {
      label: "Network",
      detail: `${kind === "network-read-dead" ? "read idle" : "stalled"}${seconds ? ` for ${seconds}s` : ""} · recover or switch source`,
      tone: "error",
    };
  }

  if (eventType === "mpv-in-process-reconnect") {
    const phase = typeof context.phase === "string" ? context.phase : "started";
    const attempt = asFiniteNumber(context.attempt);
    return {
      label: "Network",
      detail: `same-stream reconnect ${phase}${attempt ? ` · attempt ${attempt}` : ""}`,
      tone: phase === "failed" ? "error" : phase === "complete" ? "success" : "warning",
    };
  }

  const speed = asFiniteNumber(context.cacheSpeed) ?? asFiniteNumber(context.rawInputRate);
  const cacheAhead = asFiniteNumber(context.cacheAheadSeconds);
  const percent = asFiniteNumber(context.percent);
  const pausedForCache = context.pausedForCache === true || eventType === "network-buffering";
  const underrun = context.underrun === true;

  if (eventType === "network-buffering" || pausedForCache || underrun) {
    const parts = [
      percent !== null ? `${Math.round(percent)}% cache` : null,
      cacheAhead !== null ? `${cacheAhead.toFixed(1)}s ahead` : null,
      formatNetworkRate(speed),
    ].filter((part): part is string => Boolean(part));

    return {
      label: "Network",
      detail: `${parts.join(" · ")} · buffering`,
      tone: speed && speed > 0 ? "warning" : "error",
    };
  }

  if (eventType === "network-sample") {
    const parts = [
      formatNetworkRate(speed),
      cacheAhead !== null ? `${cacheAhead.toFixed(1)}s cache ahead` : null,
    ].filter((part): part is string => Boolean(part));

    return {
      label: "Network",
      detail: `${parts.join(" · ")} · HLS active`,
      tone: speed === 0 ? "warning" : "success",
    };
  }

  return {
    label: "Network",
    detail: "playback started · waiting for speed sample",
    tone: "info",
  };
}

export function summarizeProviderHealth(
  recentEvents: readonly DiagnosticEvent[],
  currentProvider?: string | null,
): RuntimeHealthLine {
  const startupPhaseEvent = [...recentEvents]
    .reverse()
    .find((event) => event.operation === "playback.startup.phases");
  const startupPhaseBreakdown =
    startupPhaseEvent?.context && typeof startupPhaseEvent.context.breakdown === "string"
      ? startupPhaseEvent.context.breakdown
      : null;

  const providerEvent = recentEvents.find((event) => {
    if (event.category === "playback" && event.operation === "playback.startup.timeline") {
      return true;
    }
    if (event.category !== "provider" && event.category !== "cache") return false;
    return (
      event.message.includes("Provider resolve") ||
      event.message.includes("Stream resolution") ||
      event.message.includes("Using prefetched stream")
    );
  });
  const context = asRecord(providerEvent?.context);
  const traceSummary = context ? summarizeTraceContext(context) : null;
  const provider =
    (typeof context?.provider === "string" ? context.provider : null) ??
    (typeof context?.providerId === "string" ? context.providerId : null) ??
    (typeof asRecord(context?.trace)?.selectedProviderId === "string"
      ? asRecord(context?.trace)?.selectedProviderId
      : null) ??
    currentProvider ??
    "provider";

  if (!providerEvent) {
    if (startupPhaseBreakdown) {
      return {
        label: "Provider",
        detail: startupPhaseBreakdown,
        tone: "success",
      };
    }
    return {
      label: "Provider",
      detail: `${provider} · no resolve telemetry yet`,
      tone: "neutral",
    };
  }

  if (
    providerEvent.category === "playback" &&
    providerEvent.operation === "playback.startup.timeline"
  ) {
    const stage =
      typeof providerEvent.context?.stage === "string" ? providerEvent.context.stage : "bootstrap";
    const readableStage = stage.replaceAll("-", " ");
    return {
      label: "Provider",
      detail: `${provider} · ${readableStage}`,
      tone: "info",
    };
  }

  const sinceStartMs = resolveDurationMs(recentEvents, providerEvent);
  const duration = sinceStartMs === null ? null : `${(sinceStartMs / 1000).toFixed(1)}s`;

  if (providerEvent.message.includes("failed") || providerEvent.message.includes("exhausted")) {
    const failure =
      formatFailureCode(asRecord(context?.failure)) ?? formatProviderAttemptFailure(context);
    const stage = typeof context?.stage === "string" ? ` at ${context.stage}` : "";
    const attemptElapsedMs = asFiniteNumber(context?.elapsedMs);
    const resolvedDuration =
      duration ?? (attemptElapsedMs ? formatElapsedMs(attemptElapsedMs) : null);
    return {
      label: "Provider",
      detail: `${provider} · failed${stage}${resolvedDuration ? ` after ${resolvedDuration}` : ""}${failure ? ` · ${failure}` : ""}`,
      tone: "error",
    };
  }

  if (providerEvent.message.includes("cache hit") || providerEvent.message.includes("prefetched")) {
    return {
      label: "Provider",
      detail: `${provider} · cached stream ready`,
      tone: "success",
    };
  }

  if (providerEvent.message.includes("succeeded") || providerEvent.message.includes("completed")) {
    if (traceSummary) {
      return {
        label: "Provider",
        detail: traceSummary,
        tone: "success",
      };
    }

    const streamCandidates = asFiniteNumber(context?.streamCandidates);
    const subtitleCandidates = asFiniteNumber(context?.subtitleCandidates);
    const inventory =
      streamCandidates !== null
        ? ` · ${streamCandidates} streams${subtitleCandidates !== null ? ` · ${subtitleCandidates} subtitles` : ""}`
        : "";
    return {
      label: "Provider",
      detail: `${provider} · resolved${duration ? ` in ${duration}` : ""}${inventory}`,
      tone: "success",
    };
  }

  return {
    label: "Provider",
    detail: `${provider} · resolving`,
    tone: "info",
  };
}

export function summarizeRuntimeMemoryHealth(
  snapshot: RuntimeMemorySnapshot = collectRuntimeMemorySnapshot(),
): RuntimeHealthLine {
  const totalRssBytes = snapshot.appRssBytes + snapshot.playbackChildRssBytes;
  const swapBytes = (snapshot.appSwapBytes ?? 0) + snapshot.playbackChildSwapBytes;

  return {
    label: "Memory",
    detail: formatRuntimeMemory(snapshot),
    tone: totalRssBytes >= 3 * 1024 ** 3 || swapBytes > 0 ? "warning" : "success",
  };
}

export function summarizeRuntimeMemoryTrendHealth(
  samples: readonly RuntimeMemorySample[] = getRuntimeMemorySamples(),
): RuntimeHealthLine {
  return summarizeRuntimeMemoryTrend(samples);
}

function resolveDurationMs(
  recentEvents: readonly DiagnosticEvent[],
  completedEvent: DiagnosticEvent,
): number | null {
  const start = recentEvents.find((event) => event.message === "Resolve trace started");
  if (!start || completedEvent.timestamp < start.timestamp) return null;
  return completedEvent.timestamp - start.timestamp;
}

function appendProviderHealthResetHint(
  detail: string,
  status: EffectiveProviderHealthStatus | undefined,
): string {
  if (status !== "degraded" && status !== "down") return detail;
  return `${detail}  ·  /reset-provider-health`;
}

export function buildRuntimeHealthSnapshot(input: {
  readonly recentEvents: readonly DiagnosticEvent[];
  readonly currentProvider?: string | null;
  readonly memorySnapshot?: RuntimeMemorySnapshot;
  readonly memorySamples?: readonly RuntimeMemorySample[];
  readonly persistedProviderHealth?: ProviderHealth;
}): RuntimeHealthSnapshot {
  const telemetryProvider = summarizeProviderHealth(input.recentEvents, input.currentProvider);
  const effective = resolveEffectiveProviderHealth(input.persistedProviderHealth);
  const persistedBadge = formatProviderHealthBadge(effective ?? undefined);
  const healthDetail = persistedBadge
    ? appendProviderHealthResetHint(
        `${telemetryProvider.detail}  ·  health: ${persistedBadge}`,
        effective?.effectiveStatus,
      )
    : telemetryProvider.detail;
  const healthTone =
    effective?.effectiveStatus === "down"
      ? ("error" as const)
      : effective?.effectiveStatus === "degraded"
        ? ("warning" as const)
        : telemetryProvider.tone;
  const provider = persistedBadge
    ? {
        label: telemetryProvider.label,
        detail: healthDetail,
        tone: healthTone,
      }
    : telemetryProvider;

  return {
    network: summarizePlaybackNetworkHealth(input.recentEvents),
    provider,
    memory: summarizeRuntimeMemoryHealth(input.memorySnapshot),
    memoryTrend: summarizeRuntimeMemoryTrendHealth(input.memorySamples),
  };
}
