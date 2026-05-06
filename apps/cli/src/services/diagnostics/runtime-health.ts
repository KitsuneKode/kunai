import type { DiagnosticEvent } from "@/services/diagnostics/DiagnosticsStore";

export type RuntimeHealthTone = "neutral" | "info" | "success" | "warning" | "error";

export type RuntimeHealthLine = {
  readonly label: string;
  readonly detail: string;
  readonly tone: RuntimeHealthTone;
};

export type RuntimeHealthSnapshot = {
  readonly network: RuntimeHealthLine;
  readonly provider: RuntimeHealthLine;
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

function summarizeTraceContext(context: Record<string, unknown>): string | null {
  const trace = asRecord(context.trace);
  if (!trace) return null;

  const runtime = typeof trace.runtime === "string" ? trace.runtime : null;
  const selectedProvider =
    (typeof trace.selectedProviderId === "string" ? trace.selectedProviderId : null) ??
    (typeof context.provider === "string" ? context.provider : null) ??
    (typeof context.providerId === "string" ? context.providerId : null);
  const cacheHit = asBoolean(trace.cacheHit);
  const streamCandidates = asFiniteNumber(context.streamCandidates);
  const subtitleCandidates = asFiniteNumber(context.subtitleCandidates);
  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const latestStep = steps
    .map((step) => asRecord(step))
    .find((step): step is Record<string, unknown> => Boolean(step));
  const stage = typeof latestStep?.stage === "string" ? latestStep.stage : null;

  const parts = [
    selectedProvider,
    runtime,
    stage,
    cacheHit === null ? null : cacheHit ? "cache hit" : "cache miss",
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
  const providerEvent = recentEvents.find((event) => {
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
    return {
      label: "Provider",
      detail: `${provider} · no resolve telemetry yet`,
      tone: "neutral",
    };
  }

  const sinceStartMs = resolveDurationMs(recentEvents, providerEvent);
  const duration = sinceStartMs === null ? null : `${(sinceStartMs / 1000).toFixed(1)}s`;

  if (providerEvent.message.includes("failed") || providerEvent.message.includes("exhausted")) {
    const failure = formatFailureCode(asRecord(context?.failure));
    const stage = typeof context?.stage === "string" ? ` at ${context.stage}` : "";
    return {
      label: "Provider",
      detail: `${provider} · failed${stage}${duration ? ` after ${duration}` : ""}${failure ? ` · ${failure}` : ""}`,
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

function resolveDurationMs(
  recentEvents: readonly DiagnosticEvent[],
  completedEvent: DiagnosticEvent,
): number | null {
  const start = recentEvents.find((event) => event.message === "Resolve trace started");
  if (!start || completedEvent.timestamp < start.timestamp) return null;
  return completedEvent.timestamp - start.timestamp;
}

export function buildRuntimeHealthSnapshot(input: {
  readonly recentEvents: readonly DiagnosticEvent[];
  readonly currentProvider?: string | null;
}): RuntimeHealthSnapshot {
  return {
    network: summarizePlaybackNetworkHealth(input.recentEvents),
    provider: summarizeProviderHealth(input.recentEvents, input.currentProvider),
  };
}
