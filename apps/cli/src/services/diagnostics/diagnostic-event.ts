export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticCategory =
  | "session"
  | "search"
  | "provider"
  | "subtitle"
  | "playback"
  | "cache"
  | "ui"
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
  return {
    ...event,
    timestamp,
    level: event.level ?? "info",
    operation: event.operation ?? event.category,
  };
}
