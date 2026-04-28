import type { DiagnosticEvent, DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";

const MAX_EVENTS = 200;

export class DiagnosticsStoreImpl implements DiagnosticsStore {
  private events: DiagnosticEvent[] = [];

  record(event: Omit<DiagnosticEvent, "timestamp">): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });

    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  getRecent(limit = 20): readonly DiagnosticEvent[] {
    return this.events.slice(-limit).reverse();
  }

  clear(): void {
    this.events = [];
  }
}
