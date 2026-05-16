import type { DiagnosticCorrelation } from "./correlation";
import type { DiagnosticCategory } from "./diagnostic-event";
import type { DiagnosticsStore } from "./DiagnosticsStore";

type BackgroundTaskLogger = {
  warn(message: string, context?: Record<string, unknown>): void;
};

export type BackgroundTaskInput = {
  readonly task: string;
  readonly category: DiagnosticCategory;
  readonly diagnosticsStore?: DiagnosticsStore;
  readonly logger?: BackgroundTaskLogger;
  readonly context?: Record<string, unknown> & DiagnosticCorrelation;
  readonly run: Promise<unknown> | (() => Promise<unknown>);
};

export function runBackgroundTask(input: BackgroundTaskInput): void {
  let task: Promise<unknown>;
  try {
    task = typeof input.run === "function" ? input.run() : input.run;
  } catch (error) {
    task = Promise.reject(error);
  }

  task.catch((error: unknown) => {
    const failureContext = {
      ...normalizeErrorForDiagnostics(error),
      ...contextWithoutPromotedFields(input.context),
    };

    if (input.diagnosticsStore) {
      input.diagnosticsStore.record({
        level: "warn",
        category: input.category,
        operation: `background.${input.task}`,
        message: `Background task failed: ${input.task}`,
        providerId:
          typeof input.context?.providerId === "string" ? input.context.providerId : undefined,
        titleId: typeof input.context?.titleId === "string" ? input.context.titleId : undefined,
        season: typeof input.context?.season === "number" ? input.context.season : undefined,
        episode: typeof input.context?.episode === "number" ? input.context.episode : undefined,
        sessionId:
          typeof input.context?.sessionId === "string" ? input.context.sessionId : undefined,
        playbackCycleId:
          typeof input.context?.playbackCycleId === "string"
            ? input.context.playbackCycleId
            : undefined,
        providerAttemptId:
          typeof input.context?.providerAttemptId === "string"
            ? input.context.providerAttemptId
            : undefined,
        traceId: typeof input.context?.traceId === "string" ? input.context.traceId : undefined,
        context: failureContext,
      });
      return;
    }

    input.logger?.warn("Background task failed", {
      task: input.task,
      category: input.category,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function contextWithoutPromotedFields(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {};
  const {
    providerId: _providerId,
    titleId: _titleId,
    season: _season,
    episode: _episode,
    sessionId: _sessionId,
    playbackCycleId: _playbackCycleId,
    providerAttemptId: _providerAttemptId,
    traceId: _traceId,
    ...rest
  } = context;
  return rest;
}

function normalizeErrorForDiagnostics(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    errorName: typeof error,
    errorMessage: String(error),
  };
}
