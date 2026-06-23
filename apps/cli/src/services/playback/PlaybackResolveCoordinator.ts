import { summarizeProviderAttemptTimeline } from "@/domain/provider/ProviderAttemptTimeline";
import type { StreamInfo } from "@/domain/types";
import { withDiagnosticCorrelation } from "@/services/diagnostics/correlation";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import {
  summarizeProviderTraceEvents,
  type ProviderEngine,
  type ProviderEngineEvent,
  type ProviderPriorityInput,
} from "@kunai/core";
import type { ProviderHealthRepository } from "@kunai/storage";

import {
  PlaybackResolveService,
  type PlaybackResolveEvent,
  type PlaybackResolveInput,
  type PlaybackResolveOutput,
  type StreamHealthChecker,
} from "./PlaybackResolveService";
import type { SourceInventoryService } from "./SourceInventoryService";
import type { StreamHealthService } from "./StreamHealthService";
import type { TitleProviderHealthService } from "./TitleProviderHealthService";

export type PlaybackResolveProvenance =
  | "fresh"
  | "cache-hit"
  | "cache-hit-validated"
  | "cache-hit-unvalidated"
  | "cache-refetched"
  | "prefetched";

export type PlaybackResolveCoordinatorOutput = PlaybackResolveOutput & {
  readonly provenance: PlaybackResolveProvenance;
};

export type PlaybackResolveCoordinatorDeps = {
  readonly engine: ProviderEngine;
  readonly cacheStore: CacheStore;
  readonly providerHealth?: ProviderHealthRepository;
  readonly streamHealth?: StreamHealthChecker;
  readonly streamHealthService?: StreamHealthService;
  readonly diagnostics?: DiagnosticsService;
  readonly getProviderPriority?: () => ProviderPriorityInput;
  readonly sourceInventory?: Pick<SourceInventoryService, "get" | "set" | "delete">;
  readonly titleProviderHealth?: Pick<
    TitleProviderHealthService,
    "recordFailure" | "recordCleanSuccess"
  >;
};

export class PlaybackResolveCoordinator {
  constructor(private readonly deps: PlaybackResolveCoordinatorDeps) {}

  async resolve(input: PlaybackResolveInput): Promise<PlaybackResolveCoordinatorOutput> {
    const events: PlaybackResolveEvent[] = [];
    const resolver = this.createResolver();
    const result = await resolver.resolve({
      ...input,
      onEvent: (event) => {
        events.push(event);
        this.recordEvent(input, event);
        input.onEvent?.(event);
      },
    });
    this.recordProviderTimeline(input, result);

    return {
      ...result,
      provenance: toResolveProvenance(result, events),
    };
  }

  async prefetch(
    input: Omit<PlaybackResolveInput, "prefetchedStream">,
  ): Promise<StreamInfo | null> {
    const result = await this.resolve(input);
    if (!result.stream) return null;
    return { ...result.stream, cacheProvenance: result.cacheProvenance };
  }

  private createResolver(): PlaybackResolveService {
    return new PlaybackResolveService({
      engine: this.deps.engine,
      cacheStore: this.deps.cacheStore,
      providerHealth: this.deps.providerHealth,
      streamHealth: this.deps.streamHealth,
      streamHealthService: this.deps.streamHealthService,
      sourceInventory: this.deps.sourceInventory,
      titleProviderHealth: this.deps.titleProviderHealth,
      getProviderPriority: this.deps.getProviderPriority,
    });
  }

  private recordEvent(input: PlaybackResolveInput, event: PlaybackResolveEvent): void {
    if (!this.deps.diagnostics) return;

    if (
      event.type === "cache-hit" ||
      event.type === "cache-miss" ||
      event.type === "cache-stale" ||
      event.type === "cache-hit-validated" ||
      event.type === "fresh-source-failed-using-cache" ||
      event.type === "source-inventory-hit"
    ) {
      const operationByType = {
        "cache-hit": "resolve.cache.hit",
        "cache-miss": "resolve.cache.miss",
        "cache-stale": "resolve.cache.stale",
        "cache-hit-validated": "resolve.cache.hit.validated",
        "fresh-source-failed-using-cache": "resolve.refetch.failed.cached-fallback",
        "source-inventory-hit": "source-inventory.cache.hit",
      } as const;
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "cache",
        operation: operationByType[event.type],
        message: `Playback resolve ${event.type}`,
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
      });
      return;
    }

    if (event.type === "cache-health-check") {
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "cache",
        operation: "stream-health-check",
        message: event.healthy
          ? "Cached stream health check passed"
          : "Cached stream health check failed",
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          strategy: event.strategy,
          ageMs: event.ageMs,
        },
      });
      return;
    }

    if (event.type === "recovery-decision") {
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "playback",
        operation: "playback-recovery-decision",
        level: event.userVisible ? "info" : "debug",
        message: `Playback recovery decision: ${event.decision}`,
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          decision: event.decision,
          reason: event.reason,
          recoveryMode: event.recoveryMode,
          userVisible: event.userVisible,
        },
      });
      return;
    }

    if (event.type === "provider-health-skipped") {
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "provider",
        operation: "provider.health.skipped",
        level: "warn",
        message: `Provider skipped in auto-fallback: ${event.providerId}`,
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          effectiveStatus: event.effectiveStatus,
          storedStatus: event.storedStatus,
          consecutiveFailures: event.consecutiveFailures ?? null,
          healedByTtl: event.healedByTtl,
        },
      });
      return;
    }

    if (event.type === "provider-resolve-started") {
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "provider",
        operation: "provider.resolve.started",
        message: "Provider resolution started",
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          candidateCount: event.candidateCount,
        },
      });
      return;
    }

    if (event.type === "selection-decision") {
      this.deps.diagnostics.record({
        ...input.correlation,
        category: "provider",
        operation: "provider.selection.decision",
        message: "Provider startup selection decision recorded",
        providerId: event.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          startupPriority: event.decision.startupPriority,
          reason: event.decision.reason,
          waitBudgetMs: event.decision.waitBudgetMs,
          selectedQualityRank: event.decision.selectedQualityRank,
          enrichmentLane: event.decision.enrichmentLane,
        },
      });
      return;
    }

    if (event.type === "provider-engine-event") {
      const engineEvent = event.event;
      if (engineEvent.type === "provider-fallback-started") {
        this.deps.diagnostics.record(
          withDiagnosticCorrelation(input.correlation, {
            category: "provider",
            operation: "provider.resolve.fallback",
            level: "warn",
            message: "Provider fallback started",
            providerAttemptId: input.correlation?.providerAttemptId,
            providerId: engineEvent.toProviderId,
            titleId: input.title.id,
            season: input.episode.season,
            episode: input.episode.episode,
            context: {
              fromProviderId: engineEvent.fromProviderId,
              toProviderId: engineEvent.toProviderId,
              failureCode: engineEvent.failure.code,
              failureMessage: engineEvent.failure.message,
              retryable: engineEvent.failure.retryable,
              at: engineEvent.at,
            },
          }),
        );
        return;
      }

      this.deps.diagnostics.record(
        withDiagnosticCorrelation(input.correlation, {
          category: "provider",
          operation: "provider.resolve.attempt",
          level: engineEvent.type === "provider-attempt-failed" ? "warn" : "debug",
          message: describeProviderEngineEvent(engineEvent.type),
          providerAttemptId: input.correlation?.providerAttemptId,
          providerId: engineEvent.providerId,
          titleId: input.title.id,
          season: input.episode.season,
          episode: input.episode.episode,
          context: providerEngineEventContext(engineEvent),
        }),
      );
    }
  }

  private recordProviderTimeline(input: PlaybackResolveInput, result: PlaybackResolveOutput): void {
    if (!this.deps.diagnostics || !result.providerTimeline) return;

    const summary = summarizeProviderAttemptTimeline(result.providerTimeline);
    const failedAttempt = result.providerTimeline.attempts.find(
      (attempt) => attempt.status === "failed",
    );
    const sourceTrace = summarizeResolveSourceTrace(result);
    this.deps.diagnostics.record(
      withDiagnosticCorrelation(input.correlation, {
        category: "provider",
        operation: "provider.resolve.timeline",
        level: summary.status === "failed" ? "warn" : "info",
        message: summary.currentUserMessage,
        traceId: summary.traceId,
        providerAttemptId: input.correlation?.providerAttemptId ?? summary.traceId,
        providerId: result.providerId,
        titleId: input.title.id,
        season: input.episode.season,
        episode: input.episode.episode,
        context: {
          status: summary.status,
          primaryFailure: summary.primaryFailure,
          attempts: summary.attempts.length,
          attemptTimeline: summary.attempts.slice(0, 6).map((attempt) => ({
            reason: attempt.reason,
            providerId: attempt.providerId,
            status: attempt.status,
            failureClass: attempt.failureClass ?? null,
            summary: attempt.userSummary ?? null,
          })),
          failureClass: failedAttempt?.failureClass ?? "none",
          truncated: result.providerTimeline.truncated,
          sourceAttemptCount: sourceTrace.sourceAttempts.length,
          sourceAttempts: sourceTrace.sourceAttempts.slice(0, 8),
          lastTraceEvent: sourceTrace.lastEvent,
        },
      }),
    );
  }
}

function summarizeResolveSourceTrace(result: PlaybackResolveOutput) {
  return summarizeProviderTraceEvents(
    result.attempts.flatMap((attempt) => [...(attempt.result?.trace.events ?? [])]),
  );
}

function describeProviderEngineEvent(eventType: ProviderEngineEvent["type"]): string {
  switch (eventType) {
    case "provider-attempt-started":
      return "Provider resolve attempt started";
    case "provider-attempt-succeeded":
      return "Provider resolve attempt succeeded";
    case "provider-attempt-failed":
      return "Provider resolve attempt failed";
    case "provider-retry-scheduled":
      return "Provider resolve retry scheduled";
    default:
      return "Provider resolve attempt changed";
  }
}

function providerEngineEventContext(event: ProviderEngineEvent): Record<string, unknown> {
  switch (event.type) {
    case "provider-attempt-started":
      return {
        phase: "started",
        physicalAttempt: event.attempt,
        at: event.at,
      };
    case "provider-attempt-succeeded":
      return {
        phase: "succeeded",
        physicalAttempt: event.attempt,
        elapsedMs: event.elapsedMs,
        at: event.at,
      };
    case "provider-attempt-failed":
      return {
        phase: "failed",
        physicalAttempt: event.attempt,
        elapsedMs: event.elapsedMs,
        failureCode: event.failure.code,
        failureMessage: event.failure.message,
        retryable: event.failure.retryable,
        at: event.at,
      };
    case "provider-retry-scheduled":
      return {
        phase: "retry-scheduled",
        nextPhysicalAttempt: event.nextAttempt,
        delayMs: event.delayMs,
        at: event.at,
      };
    case "provider-fallback-started":
      return {
        phase: "fallback-started",
        fromProviderId: event.fromProviderId,
        toProviderId: event.toProviderId,
        failureCode: event.failure.code,
        failureMessage: event.failure.message,
        retryable: event.failure.retryable,
        at: event.at,
      };
  }
}

function toResolveProvenance(
  result: PlaybackResolveOutput,
  events: readonly PlaybackResolveEvent[],
): PlaybackResolveProvenance {
  if (result.cacheStatus === "prefetched") return "prefetched";
  if (result.cacheStatus === "hit") {
    if (events.some((event) => event.type === "cache-hit-validated")) {
      return "cache-hit-validated";
    }
    return result.cacheProvenance === "cached" ? "cache-hit" : "cache-hit-unvalidated";
  }
  if (events.some((event) => event.type === "cache-stale")) return "cache-refetched";
  return "fresh";
}
