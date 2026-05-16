import { randomUUID } from "node:crypto";

export type DiagnosticCorrelation = {
  readonly sessionId?: string;
  readonly playbackCycleId?: string;
  readonly providerAttemptId?: string;
  readonly traceId?: string;
};

export function createCorrelationId(prefix: string): string {
  return `${prefix}:${randomUUID()}`;
}

export function withDiagnosticCorrelation<T extends object>(
  correlation: DiagnosticCorrelation | undefined,
  value: T,
): T & DiagnosticCorrelation {
  return {
    ...correlation,
    ...value,
  };
}
