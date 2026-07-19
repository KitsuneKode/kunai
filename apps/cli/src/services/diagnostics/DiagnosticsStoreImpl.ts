import { normalizeDiagnosticEvent } from "@/services/diagnostics/diagnostic-event";
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticsStore,
} from "@/services/diagnostics/DiagnosticsStore";
import { redactDiagnosticValue } from "@/services/diagnostics/redaction";

const MAX_EVENTS = 500;
const MAX_MESSAGE_LENGTH = 500;

export class DiagnosticsStoreImpl implements DiagnosticsStore {
  private events: DiagnosticEvent[] = [];

  record(event: DiagnosticEventInput): void {
    const existingTimestamp = (event as DiagnosticEventInput & { readonly timestamp?: number })
      .timestamp;
    this.events.push(
      normalizeDiagnosticEvent(
        redactEventInput(event),
        typeof existingTimestamp === "number" ? existingTimestamp : undefined,
      ),
    );

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

function redactEventInput(event: DiagnosticEventInput): DiagnosticEventInput {
  const redacted = redactDiagnosticValue(event, {
    homeDir: process.env.HOME,
    maxStringLength: 1_000,
  }) as DiagnosticEventInput;

  return {
    ...redacted,
    message: truncate(redacted.message, MAX_MESSAGE_LENGTH),
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
