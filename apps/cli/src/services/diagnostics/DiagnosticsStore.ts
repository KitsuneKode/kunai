// =============================================================================
// Diagnostics Store
//
// Lightweight in-memory event buffer for runtime inspection.
// =============================================================================

export interface DiagnosticEvent {
  readonly timestamp: number;
  readonly category: "session" | "search" | "provider" | "subtitle" | "playback" | "cache" | "ui";
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

export interface DiagnosticsStore {
  record(event: Omit<DiagnosticEvent, "timestamp">): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  clear(): void;
}
