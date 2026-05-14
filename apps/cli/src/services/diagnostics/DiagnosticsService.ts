import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import type { DiagnosticsSupportBundle } from "./support-bundle";

export interface DiagnosticsService {
  record(event: DiagnosticEventInput): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  getSnapshot(): readonly DiagnosticEvent[];
  clear(): void;
  buildSupportBundle(input?: {
    readonly capabilities?: Record<string, unknown> | null;
  }): DiagnosticsSupportBundle;
}
