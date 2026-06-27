export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticCategory =
  | "session"
  | "search"
  | "provider"
  | "subtitle"
  | "playback"
  | "cache"
  | "ui"
  | "network"
  | "runtime"
  | "presence"
  | "download"
  | "offline"
  | "update";

export type DiagnosticEvent = {
  readonly timestamp: number;
  readonly level: DiagnosticLevel;
  readonly category: DiagnosticCategory;
  readonly operation: string;
  readonly message: string;
  readonly sessionId?: string;
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly titleId?: string;
  readonly providerId?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly context?: Record<string, unknown>;
};

export type DiagnosticEventInput = Omit<DiagnosticEvent, "timestamp" | "level" | "operation"> &
  Partial<Pick<DiagnosticEvent, "level" | "operation">>;

export function normalizeDiagnosticEvent(
  event: DiagnosticEventInput,
  timestamp = Date.now(),
): DiagnosticEvent {
  const operation = event.operation ?? `${event.category}.event`;
  return {
    ...event,
    timestamp,
    level: event.level ?? "info",
    operation,
    context: normalizeDiagnosticContext(event),
  };
}

function normalizeDiagnosticContext(event: DiagnosticEventInput): Record<string, unknown> {
  return {
    status: event.context?.status ?? defaultStatusForLevel(event.level),
    severity: event.context?.severity ?? defaultSeverityForLevel(event.level),
    recommendedAction:
      event.context?.recommendedAction ?? defaultRecommendedActionForLevel(event.level),
    spanFamily: event.context?.spanFamily ?? defaultSpanFamily(event.category),
    ...event.context,
  };
}

function defaultStatusForLevel(level: DiagnosticEventInput["level"] | undefined): string {
  return level === "error" ? "failed" : level === "warn" ? "skipped" : "succeeded";
}

function defaultSeverityForLevel(level: DiagnosticEventInput["level"] | undefined): string {
  return level === "error" ? "blocked" : level === "warn" ? "recoverable" : "healthy";
}

function defaultRecommendedActionForLevel(
  level: DiagnosticEventInput["level"] | undefined,
): string {
  return level === "error" ? "export-diagnostics" : level === "warn" ? "retry" : "none";
}

function defaultSpanFamily(category: DiagnosticCategory): string {
  switch (category) {
    case "provider":
      return "provider.resolve";
    case "subtitle":
      return "subtitle.attach";
    case "download":
    case "offline":
      return "download.job";
    case "cache":
      return "cache.maintenance";
    case "search":
      return "search.routing";
    case "presence":
      return "presence.session";
    case "ui":
    case "session":
    case "runtime":
    case "update":
      return "shell.overlay";
    case "network":
      return "provider.resolve";
    case "playback":
    default:
      return "playback.startup";
  }
}
