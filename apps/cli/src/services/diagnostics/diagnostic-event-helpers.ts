import type { DiagnosticCategory, DiagnosticEventInput } from "./diagnostic-event";
import type { DiagnosticSeverity, RecommendedAction } from "./diagnostics-insight";
import { redactDiagnosticValue } from "./redaction";

export const DIAGNOSTIC_SPAN_FAMILIES = [
  "playback.startup",
  "provider.resolve",
  "source.inventory",
  "subtitle.attach",
  "download.job",
  "recovery.attempt",
  "cache.maintenance",
  "search.routing",
  "presence.session",
  "shell.overlay",
] as const;

export type DiagnosticSpanFamily = (typeof DIAGNOSTIC_SPAN_FAMILIES)[number];

export type DiagnosticEventStatus =
  | "started"
  | "progress"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "timed-out";

export type DiagnosticFailureClass =
  | "timeout"
  | "http"
  | "parse"
  | "dependency"
  | "not-found"
  | "rate-limited"
  | "cancelled"
  | "storage"
  | "ipc"
  | "unknown";

export type DiagnosticCorrelation = {
  readonly sessionId?: string;
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly downloadJobId?: string;
  readonly notificationId?: string;
};

export type BuildDiagnosticEventInput = {
  readonly category: DiagnosticCategory;
  readonly operation: string;
  readonly stage?: string;
  readonly status?: DiagnosticEventStatus;
  readonly severity?: DiagnosticSeverity;
  readonly durationMs?: number;
  readonly failureClass?: DiagnosticFailureClass;
  readonly recommendedAction?: RecommendedAction;
  readonly message: string;
  readonly level?: DiagnosticEventInput["level"];
  readonly correlation?: DiagnosticCorrelation;
  readonly subject?: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
  readonly providerId?: string;
  readonly titleId?: string;
  readonly season?: number;
  readonly episode?: number;
  readonly spanFamily?: DiagnosticSpanFamily;
};

type BuildSubsystemDiagnosticEventInput = Omit<
  BuildDiagnosticEventInput,
  "category" | "spanFamily"
> & {
  readonly spanFamily?: DiagnosticSpanFamily;
};

export function buildDiagnosticEvent(input: BuildDiagnosticEventInput): DiagnosticEventInput {
  const correlation = input.correlation ?? {};
  const envelopeContext = redactDiagnosticValue(
    omitUndefinedFields({
      stage: input.stage,
      status: input.status,
      severity: input.severity,
      durationMs: input.durationMs,
      failureClass: input.failureClass,
      recommendedAction: input.recommendedAction,
      spanFamily: input.spanFamily,
      subject: input.subject,
      ...input.context,
    }),
    { homeDir: process.env.HOME },
  ) as Record<string, unknown>;

  return redactDiagnosticValue(
    omitUndefinedFields({
      category: input.category,
      operation: input.operation,
      message: input.message,
      level: input.level ?? levelForStatus(input.status),
      sessionId: correlation.sessionId,
      playbackCycleId: correlation.playbackCycleId,
      providerAttemptId: correlation.providerAttemptId,
      traceId: correlation.traceId,
      spanId: correlation.spanId,
      providerId: input.providerId ?? (input.subject?.providerId as string | undefined),
      titleId: input.titleId ?? (input.subject?.titleId as string | undefined),
      season: input.season,
      episode: input.episode,
      context: envelopeContext,
    }),
    { homeDir: process.env.HOME },
  ) as DiagnosticEventInput;
}

export function buildPlaybackDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "playback",
    spanFamily: input.spanFamily ?? "playback.startup",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildRecoveryDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "playback",
    spanFamily: "recovery.attempt",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildSubtitleDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "subtitle",
    spanFamily: "subtitle.attach",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildDownloadDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "download",
    spanFamily: "download.job",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildSearchDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "search",
    spanFamily: "search.routing",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildPresenceDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "presence",
    spanFamily: "presence.session",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildUiDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "ui",
    spanFamily: "shell.overlay",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function buildCacheMaintenanceDiagnosticEvent(
  input: BuildSubsystemDiagnosticEventInput,
): DiagnosticEventInput {
  return buildDiagnosticEvent({
    ...input,
    category: "cache",
    spanFamily: "cache.maintenance",
    recommendedAction:
      input.recommendedAction ??
      (input.failureClass ? mapFailureToRecommendedAction(input.failureClass) : undefined),
  });
}

export function mapFailureToRecommendedAction(
  failureClass: DiagnosticFailureClass,
): RecommendedAction {
  switch (failureClass) {
    case "timeout":
    case "http":
    case "parse":
    case "not-found":
    case "rate-limited":
      return "fallback-provider";
    case "dependency":
      return "check-dependency";
    case "storage":
      return "retry-download";
    case "cancelled":
      return "none";
    case "ipc":
      return "recover";
    default:
      return "export-diagnostics";
  }
}

export function mapSeverityToHealthLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "healthy":
      return "OK";
    case "degraded":
    case "recoverable":
      return "Needs attention";
    case "blocked":
      return "Failed";
    default:
      return "Unknown";
  }
}

function levelForStatus(status: DiagnosticEventStatus | undefined): DiagnosticEventInput["level"] {
  switch (status) {
    case "failed":
    case "timed-out":
      return "error";
    case "cancelled":
    case "skipped":
      return "warn";
    case "progress":
      return "debug";
    default:
      return "info";
  }
}

function omitUndefinedFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
