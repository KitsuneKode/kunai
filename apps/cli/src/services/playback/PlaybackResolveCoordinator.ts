import { summarizeProviderAttemptTimeline } from "@/domain/provider/ProviderAttemptTimeline";
import type { StreamInfo } from "@/domain/types";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { ProviderEngine } from "@kunai/core";
import type { ProviderHealthRepository } from "@kunai/storage";

import {
  PlaybackResolveService,
  type PlaybackResolveEvent,
  type PlaybackResolveInput,
  type PlaybackResolveOutput,
  type StreamHealthChecker,
} from "./PlaybackResolveService";
import type { StreamHealthService } from "./StreamHealthService";

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
    });
  }

  private recordEvent(input: PlaybackResolveInput, event: PlaybackResolveEvent): void {
    if (!this.deps.diagnostics) return;

    if (
      event.type === "cache-hit" ||
      event.type === "cache-miss" ||
      event.type === "cache-stale" ||
      event.type === "cache-hit-validated"
    ) {
      this.deps.diagnostics.record({
        category: "cache",
        operation: "playback-resolve",
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
    }
  }

  private recordProviderTimeline(input: PlaybackResolveInput, result: PlaybackResolveOutput): void {
    if (!this.deps.diagnostics || !result.providerTimeline) return;

    const summary = summarizeProviderAttemptTimeline(result.providerTimeline);
    const failedAttempt = result.providerTimeline.attempts.find(
      (attempt) => attempt.status === "failed",
    );
    this.deps.diagnostics.record({
      category: "provider",
      operation: "provider.resolve.timeline",
      level: summary.status === "failed" ? "warn" : "info",
      message: summary.currentUserMessage,
      traceId: summary.traceId,
      providerId: result.providerId,
      titleId: input.title.id,
      season: input.episode.season,
      episode: input.episode.episode,
      context: {
        status: summary.status,
        primaryFailure: summary.primaryFailure,
        attempts: summary.attempts.length,
        failureClass: failedAttempt?.failureClass ?? "none",
        truncated: result.providerTimeline.truncated,
      },
    });
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
