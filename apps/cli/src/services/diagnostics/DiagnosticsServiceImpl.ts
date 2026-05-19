import type { Logger } from "@/infra/logger/Logger";

import type { DebugTraceReporter } from "./DebugTraceReporter";
import type { DiagnosticEvent, DiagnosticEventInput } from "./diagnostic-event";
import { buildDiagnosticsBundle } from "./DiagnosticsBundleBuilder";
import type { DiagnosticsService } from "./DiagnosticsService";
import type { DiagnosticsStore } from "./DiagnosticsStore";

export type DiagnosticsServiceDeps = {
  readonly store: DiagnosticsStore;
  readonly logger: Logger;
  readonly appVersion?: string;
  readonly debug?: boolean;
  readonly now?: () => Date;
  readonly traceReporter?: DebugTraceReporter;
};

export class DiagnosticsServiceImpl implements DiagnosticsService {
  constructor(private readonly deps: DiagnosticsServiceDeps) {}

  record(event: DiagnosticEventInput): void {
    this.deps.store.record(event);
    this.log(event);
    this.deps.traceReporter?.record(event);
  }

  getRecent(limit?: number): readonly DiagnosticEvent[] {
    return this.deps.store.getRecent(limit);
  }

  getSnapshot(): readonly DiagnosticEvent[] {
    return this.deps.store.getSnapshot();
  }

  clear(): void {
    this.deps.store.clear();
  }

  buildSupportBundle(
    input?: Parameters<DiagnosticsService["buildSupportBundle"]>[0],
  ): ReturnType<DiagnosticsService["buildSupportBundle"]> {
    return buildDiagnosticsBundle({
      appVersion: this.deps.appVersion ?? "unknown",
      debug: this.deps.debug ?? false,
      capabilities: input?.capabilities ?? {},
      playbackSourceInventory: input?.playbackSourceInventory ?? null,
      events: this.deps.store.getSnapshot(),
      now: this.deps.now,
    });
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
