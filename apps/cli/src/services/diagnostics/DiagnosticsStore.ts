import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";

export type { DiagnosticEvent, DiagnosticEventInput };

export interface DiagnosticsStore {
  record(event: DiagnosticEventInput): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  /** Oldest-first snapshot for exports (bounded buffer, same backing store as getRecent). */
  getSnapshot(): readonly DiagnosticEvent[];
  clear(): void;
}
