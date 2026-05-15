import { describeProviderResolveProviderNote } from "@/app/provider-resolve-copy";
import {
  createProviderAttemptTimeline,
  type ProviderAttemptTimelineSnapshot,
} from "@/domain/provider/ProviderAttemptTimeline";
import {
  classifyProviderFailure,
  fallbackPolicyForProviderFailureClass,
} from "@/domain/provider/ProviderFailureClassifier";
import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import type { CacheStore } from "@/services/persistence/CacheStore";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import { type ProviderEngine, type ResolveAttempt } from "@kunai/core";
import type { ProviderHealthRepository } from "@kunai/storage";
import type { ProviderHealthDelta } from "@kunai/types";

import { StreamHealthService } from "./StreamHealthService";

export type PlaybackResolveFeedback = {
  readonly detail?: string | null;
  readonly note?: string | null;
};

export type PlaybackResolveEvent =
  | {
      readonly type: "cache-hit";
      readonly providerId: string;
    }
  | {
      readonly type: "cache-miss";
      readonly providerId: string;
    }
  | {
      readonly type: "cache-stale";
      readonly providerId: string;
    }
  | {
      readonly type: "cache-hit-validated";
      readonly providerId: string;
    }
  | {
      readonly type: "cache-health-check";
      readonly providerId: string;
      readonly strategy: "hls-manifest-get" | "head-then-range";
      readonly healthy: boolean;
      readonly ageMs?: number;
    }
  | {
      readonly type: "attempt";
      readonly providerId: string;
      readonly providerName: string;
      readonly attempt: number;
      readonly maxAttempts: number;
    }
  | {
      readonly type: "failure";
      readonly providerId: string;
      readonly providerName: string;
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly issue: string;
      readonly retryable: boolean;
    };

export type PlaybackResolveInput = {
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly signal: AbortSignal;
  readonly prefetchedStream?: StreamInfo | null;
  readonly onFeedback?: (feedback: PlaybackResolveFeedback) => void;
  readonly onEvent?: (event: PlaybackResolveEvent) => void;
};

export type StreamHealthChecker = (
  url: string,
  headers?: Record<string, string>,
) => Promise<boolean>;

export type PlaybackResolveOutput = {
  readonly stream: StreamInfo | null;
  readonly providerId: string;
  readonly attempts: readonly ResolveAttempt<StreamInfo>[];
  readonly providerTimeline?: ProviderAttemptTimelineSnapshot;
  readonly cacheStatus: "hit" | "miss" | "prefetched";
  readonly cacheProvenance: "fresh" | "cached" | "revalidated" | "refetched" | "prefetched";
};

export class PlaybackResolveService {
  constructor(
    private readonly deps: {
      readonly engine: ProviderEngine;
      readonly cacheStore: CacheStore;
      readonly providerHealth?: ProviderHealthRepository;
      readonly streamHealth?: StreamHealthChecker;
      readonly streamHealthService?: StreamHealthService;
    },
  ) {}

  async resolve(input: PlaybackResolveInput): Promise<PlaybackResolveOutput> {
    const manifest = this.deps.engine.getManifest(input.providerId);
    const providerName = manifest?.displayName ?? input.providerId;

    if (input.prefetchedStream) {
      return {
        stream: input.prefetchedStream,
        providerId: input.providerId,
        attempts: [],
        cacheStatus: "prefetched",
        cacheProvenance: "prefetched",
      };
    }

    const cacheKey = this.buildCacheKey(input, input.providerId);
    const cachedStream = await this.deps.cacheStore.get(cacheKey);
    if (cachedStream) {
      const health = await this.checkCachedStreamHealth(cachedStream);
      if (health.checked) {
        input.onEvent?.({
          type: "cache-health-check",
          providerId: input.providerId,
          strategy: health.strategy === "hls-manifest-get" ? "hls-manifest-get" : "head-then-range",
          healthy: health.healthy,
          ageMs: health.ageMs,
        });
      }

      if (health.checked) {
        if (!health.healthy) {
          await this.deps.cacheStore.delete(cacheKey);
          input.onEvent?.({ type: "cache-stale", providerId: input.providerId });
          // Fall through to refetch below
        } else {
          input.onEvent?.({ type: "cache-hit-validated", providerId: input.providerId });
          return {
            stream: { ...cachedStream, cacheProvenance: "revalidated" },
            providerId: input.providerId,
            attempts: [],
            cacheStatus: "hit",
            cacheProvenance: "revalidated",
          };
        }
      } else {
        input.onEvent?.({ type: "cache-hit", providerId: input.providerId });
        return {
          stream: { ...cachedStream, cacheProvenance: "cached" },
          providerId: input.providerId,
          attempts: [],
          cacheStatus: "hit",
          cacheProvenance: "cached",
        };
      }
    }

    input.onEvent?.({ type: "cache-miss", providerId: input.providerId });

    const resolveInput = streamRequestToResolveInput(
      {
        title: input.title,
        episode: input.episode,
        audioPreference: input.audioPreference,
        subtitlePreference: input.subtitlePreference,
      },
      input.mode,
    );

    const compatibleIds = [input.providerId];
    // Add fallback provider ids if different from primary
    for (const module of this.deps.engine.modules) {
      if (module.providerId !== input.providerId) {
        compatibleIds.push(module.providerId);
      }
    }

    input.onFeedback?.({
      detail: `Resolving via ${providerName}`,
      note: describeProviderResolveProviderNote(false),
    });

    const engineResult = await this.deps.engine.resolveWithFallback(
      resolveInput,
      compatibleIds,
      input.signal,
    );
    const providerTimeline = buildProviderTimeline(engineResult, input.providerId);

    // Persist provider health deltas from all attempts
    for (const attempt of engineResult.attempts) {
      if (attempt.result?.healthDelta) {
        this.persistProviderHealthDelta(attempt.result.healthDelta);
      }
    }

    if (engineResult.result && !input.signal.aborted) {
      const stream = providerResolveResultToStreamInfo({
        result: engineResult.result,
        title: input.title.name,
        subtitlePreference: input.subtitlePreference,
      });

      if (stream) {
        await this.persistResolvedStream(
          input,
          engineResult.providerId ?? input.providerId,
          stream,
        );

        return {
          stream,
          providerId: engineResult.providerId ?? input.providerId,
          attempts: engineResult.attempts.map((a) => ({
            providerId: a.providerId,
            stream: a.result
              ? providerResolveResultToStreamInfo({
                  result: a.result,
                  title: input.title.name,
                  subtitlePreference: input.subtitlePreference,
                })
              : null,
            result: a.result,
            failure: a.failure,
          })),
          providerTimeline,
          cacheStatus: "miss",
          cacheProvenance: cachedStream ? "refetched" : "fresh",
        };
      }
    }

    return {
      stream: null,
      providerId: input.providerId,
      attempts: engineResult.attempts.map((a) => ({
        providerId: a.providerId,
        stream: null,
        result: a.result,
        failure: a.failure,
      })),
      providerTimeline,
      cacheStatus: "miss",
      cacheProvenance: cachedStream ? "refetched" : "fresh",
    };
  }

  private async persistResolvedStream(
    input: PlaybackResolveInput,
    providerId: string,
    stream: StreamInfo,
  ): Promise<void> {
    const persistKey = this.buildCacheKey(input, providerId);
    try {
      await this.deps.cacheStore.set(persistKey, stream);
    } catch {
      // Cache persistence is best-effort; playback already succeeded.
    }
  }

  private persistProviderHealthDelta(delta: ProviderHealthDelta): void {
    if (!this.deps.providerHealth) return;
    try {
      const status: "healthy" | "degraded" | "down" =
        delta.outcome === "success" ? "healthy" : "degraded";
      this.deps.providerHealth.set({
        providerId: delta.providerId,
        status,
        checkedAt: delta.at,
        medianResolveMs: delta.resolveMs,
        recentFailureRate: delta.outcome === "failure" ? 1 : 0,
        subtitleSuccessRate: undefined,
        streamSurvivalRate: undefined,
      });
    } catch {
      // Health persistence is best-effort
    }
  }

  private async checkCachedStreamHealth(stream: StreamInfo): Promise<{
    readonly healthy: boolean;
    readonly checked: boolean;
    readonly strategy: "none" | "hls-manifest-get" | "head-then-range";
    readonly ageMs?: number;
  }> {
    if (this.deps.streamHealth) {
      const service = new StreamHealthService();
      const policy = await service.check(stream);
      if (!policy.checked) return policy;
      return {
        ...policy,
        healthy: await this.deps.streamHealth(stream.url, stream.headers),
      };
    }
    return (this.deps.streamHealthService ?? new StreamHealthService()).check(stream);
  }

  private buildCacheKey(input: PlaybackResolveInput, providerId: string): string {
    const providerManifest = this.deps.engine.getManifest(providerId);
    return buildApiStreamResolveCacheKey({
      providerId,
      providerManifest,
      title: input.title,
      episode: input.episode,
      mode: input.mode,
      audioPreference: input.audioPreference,
      subtitlePreference: input.subtitlePreference,
    });
  }
}

function buildProviderTimeline(
  engineResult: {
    readonly providerId?: string | null;
    readonly result?: unknown;
    readonly attempts: readonly ResolveAttempt<StreamInfo>[];
  },
  primaryProviderId: string,
): ProviderAttemptTimelineSnapshot {
  const traceId = `provider:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const timeline = createProviderAttemptTimeline({ traceId });
  let lastFailureClass: ReturnType<typeof classifyProviderFailure>["failureClass"] | null = null;
  let lastFailedProviderId: string | null = null;

  engineResult.attempts.forEach((attempt, index) => {
    const attemptId = `provider-attempt-${index + 1}`;
    const isFallback = index > 0;

    if (isFallback && lastFailureClass && lastFailedProviderId) {
      timeline.record({
        type: "fallback-started",
        attemptId,
        fromProviderId: lastFailedProviderId,
        toProviderId: attempt.providerId,
        reason: lastFailureClass,
        at: index * 2,
      });
    } else {
      timeline.record({
        type: "attempt-started",
        attemptId,
        providerId: attempt.providerId,
        reason: attempt.providerId === primaryProviderId ? "primary" : "fallback",
        at: index * 2,
      });
    }

    const resolvedProviderId = engineResult.providerId ?? null;
    const succeeded =
      Boolean(attempt.stream) ||
      Boolean(attempt.result?.streams.length) ||
      (resolvedProviderId !== null && attempt.providerId === resolvedProviderId);

    if (succeeded) {
      timeline.record({
        type: "attempt-succeeded",
        attemptId,
        providerId: attempt.providerId,
        at: index * 2 + 1,
        cacheHit: attempt.result?.trace.cacheHit,
        streamCount: attempt.result?.streams.length,
      });
      lastFailureClass = null;
      lastFailedProviderId = null;
      return;
    }

    const classification = classifyProviderFailure(
      attempt.failure ?? {
        providerId: attempt.providerId,
        code: "not-found",
        message: "Provider returned no playable stream candidates",
        retryable: true,
      },
    );
    timeline.record({
      type: "attempt-failed",
      attemptId,
      providerId: attempt.providerId,
      at: index * 2 + 1,
      failureClass: classification.failureClass,
      retryable: classification.fallbackPolicy === "auto-fallback",
      userSummary: attempt.failure?.message ?? classification.userSummary,
      developerDetail: classification.developerDetail,
    });
    lastFailureClass = classification.failureClass;
    lastFailedProviderId = attempt.providerId;
  });

  if (!engineResult.providerId && !engineResult.result) {
    const lastAttempt = engineResult.attempts.at(-1);
    const classification = classifyProviderFailure(lastAttempt?.failure);
    const policy = fallbackPolicyForProviderFailureClass(classification.failureClass);
    timeline.record({
      type: "final-failed",
      at: engineResult.attempts.length * 2 + 1,
      userSummary:
        policy === "guided-action"
          ? "Provider needs your choice before Kunai can continue."
          : "No playable stream found after trying available providers.",
    });
  }

  return timeline.snapshot();
}
