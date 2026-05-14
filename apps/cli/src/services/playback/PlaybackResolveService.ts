import { describeProviderResolveProviderNote } from "@/app/provider-resolve-copy";
import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import type { CacheStore } from "@/services/persistence/CacheStore";
import { checkStreamHealth } from "@/services/playback/stream-health-check";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import { type ProviderEngine, type ResolveAttempt } from "@kunai/core";
import type { ProviderHealthRepository } from "@kunai/storage";
import type { ProviderHealthDelta } from "@kunai/types";

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
  readonly cacheStatus: "hit" | "miss" | "prefetched";
};

export class PlaybackResolveService {
  constructor(
    private readonly deps: {
      readonly engine: ProviderEngine;
      readonly cacheStore: CacheStore;
      readonly providerHealth?: ProviderHealthRepository;
      readonly streamHealth?: StreamHealthChecker;
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
      };
    }

    const cacheKey = this.buildCacheKey(input, input.providerId);
    const cachedStream = await this.deps.cacheStore.get(cacheKey);
    if (cachedStream) {
      const cacheAgeMs = Date.now() - (cachedStream.timestamp ?? 0);
      const shouldValidate = cacheAgeMs > 2 * 60 * 60 * 1000;

      if (shouldValidate) {
        // Current cache TTL is shorter than this validation threshold; Phase 2 will
        // move the age policy into a shared stream-health policy.
        const healthy = await this.checkCachedStreamHealth(cachedStream);
        if (!healthy) {
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
          };
        }
      } else {
        input.onEvent?.({ type: "cache-hit", providerId: input.providerId });
        return {
          stream: { ...cachedStream, cacheProvenance: "cached" },
          providerId: input.providerId,
          attempts: [],
          cacheStatus: "hit",
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
          cacheStatus: "miss",
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
      cacheStatus: "miss",
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

  private checkCachedStreamHealth(stream: StreamInfo): Promise<boolean> {
    const checker =
      this.deps.streamHealth ??
      ((url: string, headers?: Record<string, string>) =>
        checkStreamHealth({
          url,
          headers,
        }));
    return checker(stream.url, stream.headers);
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
