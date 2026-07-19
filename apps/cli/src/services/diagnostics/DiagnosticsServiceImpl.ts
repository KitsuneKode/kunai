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
  flush(): void;
  clear(): void;
}

export type DiagnosticsServiceDeps = {
  readonly store: DiagnosticsStore;
  readonly logger: Logger;
  readonly appVersion?: string;
  readonly debug?: boolean;
  readonly now?: () => Date;
  readonly traceReporter?: DebugTraceReporter;
  readonly durableSink?: DurableDiagnosticsSink;
};

export class DiagnosticsServiceImpl implements DiagnosticsService {
  private static readonly MAX_RESOLVE_WORK_LEDGERS = 20;
  private readonly resolveWorkLedgers: ResolveWorkLedgerSnapshot[] = [];
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(private readonly deps: DiagnosticsServiceDeps) {}

  getRevision(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  record(event: DiagnosticEventInput): void {
    const redactedEvent = redactDiagnosticValue(event, {
      homeDir: process.env.HOME,
    }) as DiagnosticEventInput;
    const normalizedEvent = normalizeDiagnosticEvent(redactedEvent, this.deps.now?.().getTime());
    this.deps.store.record(normalizedEvent);
    this.persist(normalizedEvent);
    this.log(normalizedEvent);
    this.deps.traceReporter?.record(normalizedEvent);
    this.emitChange();
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
    const durableEvents = this.readDurable((sink) => sink.getRecent(limit));
    if (durableEvents && durableEvents.length > 0) return durableEvents;
    return this.deps.store.getRecent(limit);
  }

  getSnapshot(): readonly DiagnosticEvent[] {
    const durableEvents = this.readDurable((sink) => sink.getSnapshot());
    if (durableEvents && durableEvents.length > 0) return durableEvents;
    return this.deps.store.getSnapshot();
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
    this.emitChange();
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
      environment: input?.environment ?? null,
      maxBytes: input?.maxBytes,
      now: this.deps.now,
    });
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
