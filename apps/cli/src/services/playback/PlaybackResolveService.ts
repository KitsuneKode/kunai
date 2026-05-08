import { describeProviderResolveProviderNote } from "@/app/provider-resolve-copy";
import { resolveProviderStreamWithRetries } from "@/app/provider-resolve-retry";
import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { Provider } from "@/services/providers/Provider";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";
import { resolveWithFallback, type ResolveAttempt } from "@kunai/core";

const DEFAULT_PROVIDER_RESOLVE_MAX_ATTEMPTS = 3;
const DEFAULT_PROVIDER_RESOLVE_ATTEMPT_TIMEOUT_MS = 30_000;

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
  readonly subLang: string;
  readonly animeLang: "sub" | "dub";
  readonly signal: AbortSignal;
  readonly prefetchedStream?: StreamInfo | null;
  readonly onFeedback?: (feedback: PlaybackResolveFeedback) => void;
  readonly onEvent?: (event: PlaybackResolveEvent) => void;
};

export type PlaybackResolveOutput = {
  readonly stream: StreamInfo | null;
  readonly providerId: string;
  readonly attempts: readonly ResolveAttempt<StreamInfo>[];
  readonly cacheStatus: "hit" | "miss" | "prefetched";
};

export class PlaybackResolveService {
  constructor(
    private readonly deps: {
      readonly providerRegistry: ProviderRegistry;
      readonly cacheStore: CacheStore;
      readonly maxAttempts?: number;
      readonly attemptTimeoutMs?: number;
    },
  ) {}

  async resolve(input: PlaybackResolveInput): Promise<PlaybackResolveOutput> {
    const currentProvider = this.deps.providerRegistry.get(input.providerId);
    if (!currentProvider) {
      return {
        stream: null,
        providerId: input.providerId,
        attempts: [],
        cacheStatus: "miss",
      };
    }

    if (input.prefetchedStream) {
      return {
        stream: input.prefetchedStream,
        providerId: currentProvider.metadata.id,
        attempts: [],
        cacheStatus: "prefetched",
      };
    }

    const cacheKey = this.buildCacheKey(input, currentProvider.metadata.id);
    const cachedStream = await this.deps.cacheStore.get(cacheKey);
    if (cachedStream) {
      input.onEvent?.({ type: "cache-hit", providerId: currentProvider.metadata.id });
      return {
        stream: { ...cachedStream, cacheProvenance: "cached" },
        providerId: currentProvider.metadata.id,
        attempts: [],
        cacheStatus: "hit",
      };
    }

    input.onEvent?.({ type: "cache-miss", providerId: currentProvider.metadata.id });
    const compatibleProviders = this.deps.providerRegistry.getCompatible(input.title, input.mode);
    let providerAttemptCount = 0;
    const resolveResult = await resolveWithFallback<StreamInfo>({
      signal: input.signal,
      candidates: compatibleProviders.map((provider) => ({
        providerId: provider.metadata.id,
        preferred: provider.metadata.id === currentProvider.metadata.id,
        resolve: () => {
          providerAttemptCount++;
          this.emitProviderFeedback(input, provider, providerAttemptCount > 1);
          return resolveProviderStreamWithRetries({
            providerId: provider.metadata.id,
            providerName: provider.metadata.name ?? provider.metadata.id,
            maxAttempts: this.deps.maxAttempts ?? DEFAULT_PROVIDER_RESOLVE_MAX_ATTEMPTS,
            timeoutMs: this.deps.attemptTimeoutMs ?? DEFAULT_PROVIDER_RESOLVE_ATTEMPT_TIMEOUT_MS,
            signal: input.signal,
            onAttempt: (attempt) => input.onEvent?.({ type: "attempt", ...attempt }),
            onFailure: (failure) => input.onEvent?.({ type: "failure", ...failure }),
            resolve: (attemptSignal) =>
              provider.resolveStream(
                {
                  title: input.title,
                  episode: input.episode,
                  subLang: input.subLang,
                  animeLang: input.animeLang,
                },
                attemptSignal,
              ),
          });
        },
      })),
    });

    const resolvedProviderId = resolveResult.providerId ?? currentProvider.metadata.id;
    if (resolveResult.stream && !input.signal.aborted) {
      await this.persistResolvedStream(input, resolvedProviderId, resolveResult.stream);
    }

    return {
      stream: resolveResult.stream,
      providerId: resolvedProviderId,
      attempts: resolveResult.attempts,
      cacheStatus: "miss",
    };
  }

  private emitProviderFeedback(
    input: PlaybackResolveInput,
    provider: Provider,
    isFallback: boolean,
  ): void {
    const providerName = provider.metadata.name ?? provider.metadata.id;
    input.onFeedback?.({
      detail: isFallback
        ? `Trying fallback provider ${providerName}…`
        : `Resolving via ${providerName}`,
      note: describeProviderResolveProviderNote(isFallback),
    });
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

  private buildCacheKey(input: PlaybackResolveInput, providerId: string): string {
    return buildApiStreamResolveCacheKey({
      providerId,
      title: input.title,
      episode: input.episode,
      mode: input.mode,
      subLang: input.subLang,
      animeLang: input.animeLang,
    });
  }
}
