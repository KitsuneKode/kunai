import { normalizeDiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticsStore,
} from "@/services/diagnostics/DiagnosticsStore";

const MAX_EVENTS = 200;

export class DiagnosticsStoreImpl implements DiagnosticsStore {
  private events: DiagnosticEvent[] = [];

  record(event: DiagnosticEventInput): void {
    this.events.push(normalizeDiagnosticEvent(event));

    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  getRecent(limit = 20): readonly DiagnosticEvent[] {
    return this.events.slice(-limit).reverse();
  }

  getSnapshot(): readonly DiagnosticEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
