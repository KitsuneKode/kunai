import { summarizeProviderAttemptTimeline } from "@/domain/provider/ProviderAttemptTimeline";
import type { StreamInfo } from "@/domain/types";
import { withDiagnosticCorrelation } from "@/services/diagnostics/correlation";
import {
  buildDiagnosticEvent,
  buildRecoveryDiagnosticEvent,
  mapFailureToRecommendedAction,
  type DiagnosticFailureClass,
} from "@/services/diagnostics/diagnostic-event-helpers";
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
import type { ProviderEndpointHealthService } from "./ProviderEndpointHealthService";
import type { SourceInventoryService } from "./SourceInventoryService";
import type { StreamHealthService } from "./StreamHealthService";
import type { TitlePlaybackSourceService } from "./TitlePlaybackSourceService";
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
  readonly endpointHealth?: Pick<ProviderEndpointHealthService, "isQuarantined">;
  readonly titlePlaybackSource?: Pick<TitlePlaybackSourceService, "delete">;
};

export class PlaybackResolveCoordinator {
  constructor(private readonly deps: PlaybackResolveCoordinatorDeps) {}

  async resolve(input: PlaybackResolveInput): Promise<PlaybackResolveCoordinatorOutput> {
    const events: PlaybackResolveEvent[] = [];
    const resolver = this.createResolver();
    const resolveInput: PlaybackResolveInput = {
      ...input,
      cancellationReasonRef: input.cancellationReasonRef ?? {
        current: input.cancellationReason,
      },
      onEvent: (event: PlaybackResolveEvent) => {
        events.push(event);
        this.recordEvent(input, event);
        input.onEvent?.(event);
      },
    };
    const result = await resolver.resolve(resolveInput);
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
      endpointHealth: this.deps.endpointHealth,
      titlePlaybackSource: this.deps.titlePlaybackSource,
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
      this.deps.diagnostics.record(
        buildDiagnosticEvent({
          category: "cache",
          operation: operationByType[event.type],
          stage: event.type,
          status:
            event.type === "cache-miss" || event.type === "cache-stale" ? "progress" : "succeeded",
          severity: "healthy",
          recommendedAction: "none",
          spanFamily:
            event.type === "source-inventory-hit" ? "source.inventory" : "provider.resolve",
          message: `Playback resolve ${event.type}`,
          correlation: input.correlation,
          providerId: event.providerId,
          titleId: input.title.id,
          season: input.episode.season,
          episode: input.episode.episode,
        }),
      );
      return;
    }

    if (event.type === "cache-health-check") {
      this.deps.diagnostics.record(
        buildDiagnosticEvent({
          category: "cache",
          operation: "stream-health-check",
          stage: event.strategy,
          status: event.healthy ? "succeeded" : "failed",
          severity: event.healthy ? "healthy" : "recoverable",
          failureClass: event.healthy ? undefined : "http",
          recommendedAction: event.healthy ? "none" : "refresh-source",
          spanFamily: "provider.resolve",
          message: event.healthy
            ? "Cached stream health check passed"
            : "Cached stream health check failed",
          correlation: input.correlation,
          providerId: event.providerId,
          titleId: input.title.id,
          season: input.episode.season,
          episode: input.episode.episode,
          context: {
            strategy: event.strategy,
            ageMs: event.ageMs,
          },
        }),
      );
      return;
    }

    if (event.type === "recovery-decision") {
      this.deps.diagnostics.record({
        ...buildRecoveryDiagnosticEvent({
          operation: "playback-recovery-decision",
          stage: event.decision,
          status: event.userVisible ? "progress" : "skipped",
          severity: event.userVisible ? "recoverable" : "healthy",
          recommendedAction: event.userVisible ? "recover" : "none",
          message: `Playback recovery decision: ${event.decision}`,
          correlation: input.correlation,
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
        }),
        level: event.userVisible ? "info" : "debug",
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
      this.deps.diagnostics.record(
        buildDiagnosticEvent({
          category: "provider",
          operation: "provider.resolve.started",
          stage: "provider-start",
          status: "started",
          severity: "healthy",
          recommendedAction: "none",
          spanFamily: "provider.resolve",
          message: "Provider resolution started",
          correlation: input.correlation,
          providerId: event.providerId,
          titleId: input.title.id,
          season: input.episode.season,
          episode: input.episode.episode,
          context: {
            candidateCount: event.candidateCount,
          },
        }),
      );
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
          buildDiagnosticEvent({
            category: "provider",
            operation: "provider.resolve.fallback",
            stage: "fallback",
            status: "progress",
            severity: "recoverable",
            failureClass: "unknown",
            recommendedAction: "fallback-provider",
            spanFamily: "provider.resolve",
            message: "Provider fallback started",
            correlation: input.correlation,
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
        buildDiagnosticEvent({
          category: "provider",
          operation: "provider.resolve.attempt",
          stage: engineEvent.type,
          status: engineEvent.type === "provider-attempt-failed" ? "failed" : "progress",
          severity: engineEvent.type === "provider-attempt-failed" ? "recoverable" : "healthy",
          failureClass: engineEvent.type === "provider-attempt-failed" ? "unknown" : undefined,
          recommendedAction:
            engineEvent.type === "provider-attempt-failed" ? "fallback-provider" : "none",
          spanFamily: "provider.resolve",
          message: describeProviderEngineEvent(engineEvent.type),
          level: engineEvent.type === "provider-attempt-failed" ? "warn" : "debug",
          correlation: input.correlation,
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
    const failureClassRaw = failedAttempt?.failureClass ?? "none";
    const failureClass =
      failureClassRaw === "none" ? undefined : (failureClassRaw as DiagnosticFailureClass);
    this.deps.diagnostics.record(
      withDiagnosticCorrelation(input.correlation, {
        ...buildDiagnosticEvent({
          category: "provider",
          operation: "provider.resolve.timeline",
          stage: summary.status,
          status: summary.status === "failed" ? "failed" : "succeeded",
          severity: summary.status === "failed" ? "recoverable" : "healthy",
          failureClass,
          recommendedAction:
            summary.status === "failed"
              ? mapFailureToRecommendedAction(failureClass ?? "unknown")
              : "none",
          message: summary.currentUserMessage,
          spanFamily: "provider.resolve",
          correlation: {
            sessionId: input.correlation?.sessionId,
            playbackCycleId: input.correlation?.playbackCycleId,
            providerAttemptId: input.correlation?.providerAttemptId ?? summary.traceId,
            traceId: summary.traceId,
          },
          subject: {
            providerId: result.providerId,
            titleId: input.title.id,
          },
          providerId: result.providerId,
          titleId: input.title.id,
          season: input.episode.season,
          episode: input.episode.episode,
          context: {
            primaryFailure: summary.primaryFailure,
            attempts: summary.attempts.length,
            attemptTimeline: summary.attempts.slice(0, 6).map((attempt) => ({
              attemptId: attempt.attemptId,
              reason: attempt.reason,
              providerId: attempt.providerId,
              status: attempt.status,
              failureClass: attempt.failureClass ?? null,
              summary: attempt.userSummary ?? null,
            })),
            truncated: result.providerTimeline.truncated,
            sourceAttemptCount: sourceTrace.sourceAttempts.length,
            sourceAttempts: sourceTrace.sourceAttempts.slice(0, 8),
            lastTraceEvent: sourceTrace.lastEvent,
          },
        }),
        traceId: summary.traceId,
        providerAttemptId: input.correlation?.providerAttemptId ?? summary.traceId,
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
