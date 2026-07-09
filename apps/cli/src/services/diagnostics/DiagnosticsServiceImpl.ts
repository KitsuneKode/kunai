import type { Logger } from "@/infra/logger/Logger";
import type { ResolveWorkLedgerSnapshot } from "@/services/playback/ResolveWorkLedger";

import type { DebugTraceReporter } from "./DebugTraceReporter";
import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import { normalizeDiagnosticEvent } from "./diagnostic-event";
import { buildDiagnosticsBundle } from "./DiagnosticsBundleBuilder";
import type { DiagnosticsService } from "./DiagnosticsService";
import type { DiagnosticsStore } from "./DiagnosticsStore";
import { redactDiagnosticValue } from "./redaction";

export interface DurableDiagnosticsSink {
  enqueue(event: DiagnosticEvent): void;
  getRecent(limit?: number): readonly DiagnosticEvent[];
  getSnapshot(limit?: number): readonly DiagnosticEvent[];
  listBySession?(sessionId: string, limit?: number): readonly DiagnosticEvent[];
  /** True when durable writes failed and reads should not mask the in-memory ring. */
  isFailed?(): boolean;
  flush(): void;
  clear(): void;
}

export type DiagnosticsServiceDeps = {
  readonly store: DiagnosticsStore;
  readonly logger: Logger;
  readonly appVersion?: string;
  readonly debug?: boolean;
  readonly sessionId?: string;
  readonly now?: () => Date;
  readonly traceReporter?: DebugTraceReporter;
  readonly durableSink?: DurableDiagnosticsSink;
};

export class DiagnosticsServiceImpl implements DiagnosticsService {
  private static readonly MAX_RESOLVE_WORK_LEDGERS = 20;
  private readonly resolveWorkLedgers: ResolveWorkLedgerSnapshot[] = [];

  constructor(private readonly deps: DiagnosticsServiceDeps) {}

  record(event: DiagnosticEventInput): void {
    const redactedEvent = redactDiagnosticValue(event, {
      homeDir: process.env.HOME,
    }) as DiagnosticEventInput;
    const normalizedEvent = normalizeDiagnosticEvent(redactedEvent, this.deps.now?.().getTime());
    this.deps.store.record(normalizedEvent);
    this.persist(normalizedEvent);
    this.log(normalizedEvent);
    this.deps.traceReporter?.record(normalizedEvent);
  }

  recordResolveWorkLedger(ledger: ResolveWorkLedgerSnapshot): void {
    this.resolveWorkLedgers.push(ledger);
    if (this.resolveWorkLedgers.length > DiagnosticsServiceImpl.MAX_RESOLVE_WORK_LEDGERS) {
      this.resolveWorkLedgers.splice(
        0,
        this.resolveWorkLedgers.length - DiagnosticsServiceImpl.MAX_RESOLVE_WORK_LEDGERS,
      );
    }
  }

  getRecent(limit?: number): readonly DiagnosticEvent[] {
    return this.mergeRecentEvents(limit);
  }

  getSnapshot(): readonly DiagnosticEvent[] {
    return [...this.mergeRecentEvents(500)].reverse();
  }

  flush(): void {
    try {
      this.deps.durableSink?.flush();
    } catch (error) {
      this.deps.logger.warn("Diagnostics durable flush failed", {
        category: "runtime",
        operation: "diagnostics.flush.failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  clear(): void {
    this.deps.store.clear();
    this.deps.durableSink?.clear();
    this.resolveWorkLedgers.length = 0;
  }

  buildSupportBundle(
    input?: Parameters<DiagnosticsService["buildSupportBundle"]>[0],
  ): ReturnType<DiagnosticsService["buildSupportBundle"]> {
    return buildDiagnosticsBundle({
      appVersion: this.deps.appVersion ?? "unknown",
      debug: this.deps.debug ?? false,
      capabilities: input?.capabilities ?? {},
      playbackSourceInventory: input?.playbackSourceInventory ?? null,
      resolveWorkLedgers: this.resolveWorkLedgers,
      events: this.getSnapshot(),
      sessionState: input?.sessionState ?? null,
      downloadSummary: input?.downloadSummary ?? null,
      releaseSummary: input?.releaseSummary ?? null,
      releaseDiagnostics: input?.releaseDiagnostics ?? null,
      presenceSnapshot: input?.presenceSnapshot ?? null,
      memorySamples: input?.memorySamples,
      getProviderHealth: input?.getProviderHealth,
      now: this.deps.now,
    });
  }

  /**
   * Prefer current-session memory + durable session rows over a global durable
   * recent list. Stale prior-session DB rows previously masked live events and
   * made `/diagnostics` disagree with what just happened.
   */
  private mergeRecentEvents(limit = 20): readonly DiagnosticEvent[] {
    const capped = Math.max(1, limit);
    const memory = this.deps.store.getRecent(capped);
    const sessionId = this.deps.sessionId;
    const durableFailed = this.deps.durableSink?.isFailed?.() === true;

    if (durableFailed || !this.deps.durableSink) {
      return memory;
    }

    const durable = this.readDurable((sink) => {
      if (sessionId && sink.listBySession) {
        return sink.listBySession(sessionId, capped);
      }
      return sink.getRecent(capped);
    });

    if (!durable || durable.length === 0) {
      return memory;
    }

    return mergeDiagnosticEventsByKey(memory, durable, capped);
  }

  private persist(event: DiagnosticEvent): void {
    try {
      this.deps.durableSink?.enqueue(event);
    } catch (error) {
      this.deps.logger.warn("Diagnostics durable sink failed", {
        category: "runtime",
        operation: "diagnostics.persist.failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private readDurable(
    read: (sink: DurableDiagnosticsSink) => readonly DiagnosticEvent[],
  ): readonly DiagnosticEvent[] | undefined {
    const sink = this.deps.durableSink;
    if (!sink) return undefined;
    try {
      return read(sink);
    } catch (error) {
      this.deps.logger.warn("Diagnostics durable read failed", {
        category: "runtime",
        operation: "diagnostics.read.failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private log(event: DiagnosticEventInput): void {
    const level = event.level ?? "info";
    const context = {
      category: event.category,
      operation: event.operation ?? event.category,
      sessionId: event.sessionId,
      playbackCycleId: event.playbackCycleId,
      providerAttemptId: event.providerAttemptId,
      traceId: event.traceId,
      spanId: event.spanId,
      titleId: event.titleId,
      providerId: event.providerId,
      season: event.season,
      episode: event.episode,
      ...event.context,
    };

    if (level === "debug") this.deps.logger.debug(event.message, context);
    else if (level === "warn") this.deps.logger.warn(event.message, context);
    else if (level === "error") this.deps.logger.error(event.message, context);
    else this.deps.logger.info(event.message, context);
  }
}

function diagnosticEventKey(event: DiagnosticEvent): string {
  return [
    event.timestamp,
    event.operation,
    event.message,
    event.sessionId ?? "",
    event.playbackCycleId ?? "",
    event.providerAttemptId ?? "",
    event.traceId ?? "",
  ].join("|");
}

/** Newest-first merge of memory + durable rows, deduped by event identity. */
export function mergeDiagnosticEventsByKey(
  memoryNewestFirst: readonly DiagnosticEvent[],
  durableNewestFirst: readonly DiagnosticEvent[],
  limit: number,
): readonly DiagnosticEvent[] {
  const seen = new Set<string>();
  const merged: DiagnosticEvent[] = [];
  let memoryIndex = 0;
  let durableIndex = 0;

  while (
    merged.length < limit &&
    (memoryIndex < memoryNewestFirst.length || durableIndex < durableNewestFirst.length)
  ) {
    const memoryEvent = memoryNewestFirst[memoryIndex];
    const durableEvent = durableNewestFirst[durableIndex];
    const pickMemory =
      !durableEvent ||
      (memoryEvent !== undefined && memoryEvent.timestamp >= durableEvent.timestamp);
    const next = pickMemory ? memoryEvent : durableEvent;
    if (pickMemory) memoryIndex += 1;
    else durableIndex += 1;
    if (!next) continue;
    const key = diagnosticEventKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(next);
  }

  return merged;
}
