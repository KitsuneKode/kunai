import { describeProviderResolveProviderNote } from "@/domain/playback/provider-resolve-copy";
import {
  createProviderAttemptTimeline,
  type ProviderAttemptTimelineSnapshot,
} from "@/domain/provider/ProviderAttemptTimeline";
import {
  classifyProviderFailure,
  fallbackPolicyForProviderFailureClass,
} from "@/domain/provider/ProviderFailureClassifier";
import {
  decideRecovery,
  type RecoveryMode,
  type RecoveryPolicyDecision,
} from "@/domain/recovery/RecoveryPolicy";
import type { EpisodeInfo, ShellMode, StreamInfo, TitleInfo } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import type { CacheStore } from "@/services/persistence/CacheStore";
import { providerResolveResultToStreamInfo } from "@/services/providers/provider-result-adapter";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import {
  type ProviderEngine,
  type ProviderEngineEvent,
  type ProviderEngineResolveAttempt,
  type ProviderPriorityInput,
  type ResolveAttempt,
  isOfflineNetworkFailure,
  orderProviderModulesByPriority,
} from "@kunai/core";
import { isOrgOnlyProviderResolveResult } from "@kunai/providers";
import type { StreamHealthPhase } from "@kunai/providers";
import type { ProviderHealthRepository } from "@kunai/storage";
import type {
  ProviderFailure,
  ProviderHealthDelta,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderSelectionDecision,
  StartupPriority,
} from "@kunai/types";

import { resolveEffectiveProviderHealth } from "./provider-health-policy";
import { planProviderCandidates } from "./ProviderCandidatePlanner";
import {
  decideResolveResultCommit,
  type ResolveCancellationReason,
} from "./ResolveResultCommitPolicy";
import type { SourceInventoryService } from "./SourceInventoryService";
import { StreamHealthService } from "./StreamHealthService";
import type {
  CountableTitleProviderFailure,
  TitleProviderHealthService,
} from "./TitleProviderHealthService";

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
      readonly type: "source-inventory-hit";
      readonly providerId: string;
    }
  | {
      readonly type: "provider-resolve-started";
      readonly providerId: string;
      readonly candidateCount: number;
    }
  | {
      readonly type: "selection-decision";
      readonly providerId: string;
      readonly decision: ProviderSelectionDecision;
    }
  | {
      readonly type: "provider-engine-event";
      readonly event: ProviderEngineEvent;
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
    }
  | {
      readonly type: "recovery-decision";
      readonly providerId: string;
      readonly decision: RecoveryPolicyDecision["decision"];
      readonly reason: RecoveryPolicyDecision["reason"];
      readonly recoveryMode: RecoveryMode;
      readonly userVisible: boolean;
    }
  | {
      readonly type: "fresh-source-failed-using-cache";
      readonly providerId: string;
    }
  | {
      readonly type: "title-provider-suggestion";
      readonly providerId: string;
      readonly suggestedProviderId: string;
    }
  | {
      readonly type: "provider-health-skipped";
      readonly providerId: string;
      readonly effectiveStatus: string;
      readonly storedStatus: string;
      readonly consecutiveFailures?: number;
      readonly healedByTtl: boolean;
    };

export type PlaybackResolveInput = {
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly favoriteSourceNames?: readonly string[];
  readonly signal: AbortSignal;
  readonly prefetchedStream?: StreamInfo | null;
  readonly forceHealthCheck?: boolean;
  readonly preferFreshStream?: boolean;
  readonly preserveCachedStreamOnFreshFailure?: boolean;
  readonly blockedStreamUrls?: readonly string[];
  readonly ignoreTitleHealthSuggestion?: boolean;
  readonly ignoreProviderHealth?: boolean;
  readonly resolveIntent?: ProviderResolveInput["intent"];
  readonly recoveryMode?: RecoveryMode;
  readonly cancellationReason?: ResolveCancellationReason;
  readonly correlation?: DiagnosticCorrelation;
  readonly onFeedback?: (feedback: PlaybackResolveFeedback) => void;
  readonly onEvent?: (event: PlaybackResolveEvent) => void;
};

export type StreamHealthChecker = (
  url: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
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
      readonly sourceInventory?: Pick<SourceInventoryService, "get" | "set" | "delete">;
      readonly getProviderPriority?: () => ProviderPriorityInput;
      readonly titleProviderHealth?: Pick<
        TitleProviderHealthService,
        "recordFailure" | "recordCleanSuccess"
      > &
        Partial<Pick<TitleProviderHealthService, "getSwitchSuggestion">>;
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
    let cachedStream =
      (await this.deps.cacheStore.get(cacheKey)) ??
      (input.providerId === "videasy"
        ? await this.deps.cacheStore.get(this.buildCacheKey(input, "vidking"))
        : null);
    let cacheBecameStale = false;
    if (cachedStream?.deferredLocator) {
      await this.deps.cacheStore.delete(cacheKey);
      cachedStream = null;
      cacheBecameStale = true;
    } else if (cachedStream && isBlockedStreamUrl(cachedStream.url, input.blockedStreamUrls)) {
      await this.deps.cacheStore.delete(cacheKey);
      cachedStream = null;
      cacheBecameStale = true;
      input.onEvent?.({ type: "cache-stale", providerId: input.providerId });
    } else if (cachedStream && !cachedStreamMatchesSelection(cachedStream, input)) {
      await this.deps.cacheStore.delete(cacheKey);
      cachedStream = null;
      cacheBecameStale = true;
      input.onEvent?.({ type: "cache-stale", providerId: input.providerId });
    } else if (cachedStream && input.preferFreshStream !== true) {
      const health = await this.checkCachedStreamHealth(cachedStream, {
        force: input.forceHealthCheck === true,
        signal: input.signal,
        phase: "cache-revalidate",
      });
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
          cacheBecameStale = true;
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

    if (!cachedStream || cacheBecameStale) {
      input.onEvent?.({ type: "cache-miss", providerId: input.providerId });
    }

    const resolveInput = streamRequestToResolveInput(
      {
        title: input.title,
        episode: input.episode,
        audioPreference: input.audioPreference,
        subtitlePreference: input.subtitlePreference,
        qualityPreference: input.qualityPreference,
        startupPriority: input.startupPriority,
        selectedSourceId: input.selectedSourceId,
        selectedStreamId: input.selectedStreamId,
        favoriteSourceNames: input.favoriteSourceNames,
      },
      input.mode,
      input.resolveIntent ?? "play",
    );

    const inventoryInput = {
      providerId: input.providerId,
      mediaKind: resolveInput.mediaKind,
      titleId: input.title.id,
      season: input.episode.season,
      episode: input.episode.episode,
      audioMode: input.audioPreference,
      subtitleLanguage: input.subtitlePreference,
      startupPriority: input.startupPriority,
    };
    const inventoryResult = await this.deps.sourceInventory?.get(inventoryInput);
    if (inventoryResult && inventoryMatchesSelection(inventoryResult, input)) {
      if (
        (input.providerId === "videasy" || input.providerId === "vidking") &&
        isOrgOnlyProviderResolveResult(inventoryResult)
      ) {
        await this.deps.sourceInventory?.delete(inventoryInput);
        input.onFeedback?.({
          note: "Stale ORG-only cache cleared — try o source or purge episode cache",
        });
        input.onEvent?.({ type: "cache-stale", providerId: input.providerId });
      } else if (providerResultHasDeferredStream(inventoryResult)) {
        await this.deps.sourceInventory?.delete(inventoryInput);
      } else {
        const inventoryStream = providerResolveResultToStreamInfo({
          result: inventoryResult,
          title: input.title.name,
          subtitlePreference: input.subtitlePreference,
          selectedSourceId: input.selectedSourceId,
          selectedStreamId: input.selectedStreamId,
          blockedStreamUrls: input.blockedStreamUrls,
        });
        if (inventoryStream) {
          input.onEvent?.({ type: "source-inventory-hit", providerId: input.providerId });
          const health = await this.checkCachedStreamHealth(inventoryStream, {
            force: true,
            signal: input.signal,
            phase: "cache-revalidate",
          });
          if (health.checked) {
            input.onEvent?.({
              type: "cache-health-check",
              providerId: input.providerId,
              strategy:
                health.strategy === "hls-manifest-get" ? "hls-manifest-get" : "head-then-range",
              healthy: health.healthy,
              ageMs: health.ageMs,
            });
          }
          if (health.healthy) {
            emitSelectionDecision(input, input.providerId, inventoryResult);
            input.onEvent?.({ type: "cache-hit-validated", providerId: input.providerId });
            await this.persistResolvedStream(input, input.providerId, inventoryStream);
            return {
              stream: { ...inventoryStream, cacheProvenance: "revalidated" },
              providerId: input.providerId,
              attempts: [],
              cacheStatus: "hit",
              cacheProvenance: "revalidated",
            };
          }
          await this.deps.sourceInventory?.delete(inventoryInput);
        } else if (
          inventoryResult.streams.some((stream) =>
            isBlockedStreamUrl(stream.url, input.blockedStreamUrls),
          )
        ) {
          await this.deps.sourceInventory?.delete(inventoryInput);
        }
      }
    }

    const recoveryMode = input.recoveryMode ?? "guided";
    const primaryStoredHealth =
      input.ignoreProviderHealth === true
        ? undefined
        : this.deps.providerHealth?.get(input.providerId);
    const primaryEffectiveHealth = resolveEffectiveProviderHealth(primaryStoredHealth);
    const primaryHealth =
      primaryEffectiveHealth && primaryEffectiveHealth.effectiveStatus !== "unknown"
        ? { status: primaryEffectiveHealth.effectiveStatus as "healthy" | "degraded" | "down" }
        : undefined;
    const titleSuggestion =
      input.ignoreTitleHealthSuggestion === true
        ? null
        : typeof this.deps.titleProviderHealth?.getSwitchSuggestion === "function"
          ? this.deps.titleProviderHealth.getSwitchSuggestion(input.title.id, input.providerId)
          : null;
    const candidatePlan = planProviderCandidates({
      primaryProviderId: input.providerId as ProviderId,
      mediaKind: resolveInput.mediaKind,
      recoveryMode,
      modules: this.getPriorityOrderedModules(),
      getProviderHealth:
        input.ignoreProviderHealth === true
          ? undefined
          : (providerId) => this.deps.providerHealth?.get(providerId),
      ignoreProviderHealth: input.ignoreProviderHealth,
      suggestion: titleSuggestion,
    });
    const recoveryDecision = decideRecovery({
      mode: recoveryMode,
      intent: "automatic",
      network: "unknown",
      cache: cachedStream ? "health-failed" : "none",
      providerHealth: primaryHealth,
      compatibleProviderAvailable: candidatePlan.hasCompatibleFallback,
    });
    input.onEvent?.({
      type: "recovery-decision",
      providerId: input.providerId,
      decision: recoveryDecision.decision,
      reason: recoveryDecision.reason,
      recoveryMode,
      userVisible: recoveryDecision.userVisible,
    });

    if (titleSuggestion) {
      input.onEvent?.({
        type: "title-provider-suggestion",
        providerId: titleSuggestion.providerId,
        suggestedProviderId: titleSuggestion.suggestedProviderId,
      });
    }

    for (const skipped of candidatePlan.skippedFallbackProviders) {
      input.onEvent?.({
        type: "provider-health-skipped",
        providerId: skipped.providerId,
        effectiveStatus: skipped.effectiveHealth.effectiveStatus,
        storedStatus: skipped.effectiveHealth.stored?.status ?? "unknown",
        consecutiveFailures: skipped.effectiveHealth.consecutiveFailures,
        healedByTtl: skipped.effectiveHealth.healedByTtl,
      });
    }
    if (candidatePlan.skippedFallbackProviders.length > 0) {
      const skippedNames = candidatePlan.skippedFallbackProviders
        .map((skipped) => {
          const name =
            this.deps.engine.getManifest(skipped.providerId)?.displayName ?? skipped.providerId;
          return `${name} (${skipped.effectiveHealth.effectiveStatus})`;
        })
        .join(", ");
      input.onFeedback?.({
        note: `${skippedNames} skipped in auto-fallback — /reset-provider-health to retry`,
      });
    }

    const compatibleIds = [...candidatePlan.candidateIds];

    input.onFeedback?.({
      detail: `Resolving via ${providerName}`,
      note: describeProviderResolveProviderNote(false),
    });
    input.onEvent?.({
      type: "provider-resolve-started",
      providerId: input.providerId,
      candidateCount: compatibleIds.length,
    });

    let engineResult = await this.deps.engine.resolveWithFallback(
      resolveInput,
      compatibleIds,
      input.signal,
      (event) => input.onEvent?.({ type: "provider-engine-event", event }),
    );
    const emitAttempts = (
      attempts: readonly ProviderEngineResolveAttempt[],
      offset = 0,
      maxAttempts = compatibleIds.length,
    ) => {
      attempts.forEach((attempt, index) => {
        const attemptedName =
          this.deps.engine.getManifest(attempt.providerId)?.displayName ?? attempt.providerId;
        input.onEvent?.({
          type: "attempt",
          providerId: attempt.providerId,
          providerName: attemptedName,
          attempt: offset + index + 1,
          maxAttempts,
        });
        const failure = attempt.failure ?? attempt.result?.failures[0];
        if (failure) {
          input.onEvent?.({
            type: "failure",
            providerId: attempt.providerId,
            providerName: attemptedName,
            attempt: offset + index + 1,
            maxAttempts,
            issue: classifyProviderFailure(failure).failureClass,
            retryable: failure.retryable,
          });
        }
      });
    };
    emitAttempts(engineResult.attempts);
    let combinedAttempts = [...engineResult.attempts];
    let resolvedStream: StreamInfo | null = null;
    while (engineResult.result) {
      const resolvedProviderId = engineResult.providerId ?? input.providerId;
      const selection = providerScopedSelection(input, resolvedProviderId);
      const candidateStream = providerResolveResultToStreamInfo({
        result: engineResult.result,
        title: input.title.name,
        subtitlePreference: input.subtitlePreference,
        selectedSourceId: selection.selectedSourceId,
        selectedStreamId: selection.selectedStreamId,
        blockedStreamUrls: input.blockedStreamUrls,
      });

      if (!candidateStream) break;

      if (
        candidateStream.deferredLocator ||
        (!this.deps.streamHealth && !this.deps.streamHealthService)
      ) {
        resolvedStream = candidateStream;
        break;
      }
      const health = await this.checkCachedStreamHealth(candidateStream, {
        force: true,
        signal: input.signal,
        phase: "resolve-gate",
      });
      if (health.checked) {
        input.onEvent?.({
          type: "cache-health-check",
          providerId: resolvedProviderId,
          strategy: health.strategy === "hls-manifest-get" ? "hls-manifest-get" : "head-then-range",
          healthy: health.healthy,
          ageMs: health.ageMs,
        });
      }
      if (health.healthy) {
        resolvedStream = candidateStream;
        break;
      }

      const failure = createResolvedStreamPreflightFailure(resolvedProviderId);
      const markedAttempt = markAttemptFailedByPreflight(
        combinedAttempts,
        resolvedProviderId,
        failure,
      );
      combinedAttempts = markedAttempt.attempts;
      input.onEvent?.({
        type: "failure",
        providerId: resolvedProviderId,
        providerName:
          this.deps.engine.getManifest(resolvedProviderId)?.displayName ?? resolvedProviderId,
        attempt: markedAttempt.index + 1,
        maxAttempts: compatibleIds.length,
        issue: "dead-stream",
        retryable: true,
      });
      await this.deps.cacheStore.delete(this.buildCacheKey(input, resolvedProviderId));
      await this.deps.sourceInventory?.delete({
        ...inventoryInput,
        providerId: resolvedProviderId,
      });
      this.deps.titleProviderHealth?.recordFailure(
        input.title.id,
        resolvedProviderId,
        undefined,
        "dead-stream",
      );

      const triedProviders = new Set([
        input.providerId as ProviderId,
        resolvedProviderId as ProviderId,
        ...combinedAttempts.map((attempt) => attempt.providerId),
      ]);
      const remainingCandidateIds = compatibleIds.filter(
        (candidateId) => !triedProviders.has(candidateId),
      );
      if (!remainingCandidateIds.length || input.signal.aborted) {
        engineResult = { result: null, providerId: null, attempts: combinedAttempts };
        break;
      }

      const nextProviderId = remainingCandidateIds[0] as ProviderId;
      input.onFeedback?.({
        detail: `Trying ${this.deps.engine.getManifest(nextProviderId)?.displayName ?? nextProviderId} after a dead stream`,
        note: "The resolved HLS manifest was not reachable before playback.",
      });
      const retryResult = await this.deps.engine.resolveWithFallback(
        resolveInput,
        remainingCandidateIds,
        input.signal,
        (event) => input.onEvent?.({ type: "provider-engine-event", event }),
      );
      emitAttempts(retryResult.attempts, combinedAttempts.length);
      combinedAttempts = [...combinedAttempts, ...retryResult.attempts];
      engineResult = { ...retryResult, attempts: combinedAttempts };
    }
    const providerTimeline = buildProviderTimeline(
      engineResult,
      input.providerId,
      input.correlation,
    );

    // Persist provider health deltas from all attempts
    for (const attempt of engineResult.attempts) {
      if (
        attempt.result?.healthDelta &&
        !attempt.result.failures.some((failure) => isOfflineNetworkFailure(failure))
      ) {
        this.persistProviderHealthDelta(attempt.result.healthDelta);
      }
    }

    if (engineResult.result) {
      const stream = resolvedStream;

      if (stream) {
        if (!providerResultHasDeferredStream(engineResult.result)) {
          await this.deps.sourceInventory?.set(
            { ...inventoryInput, providerId: engineResult.providerId ?? input.providerId },
            engineResult.result,
          );
        }
        const resolvedProviderId = engineResult.providerId ?? input.providerId;
        const primaryFailureKind = titleProviderFailureFromAttempts(
          engineResult.attempts,
          input.providerId,
        );
        if (primaryFailureKind && resolvedProviderId !== input.providerId) {
          this.deps.titleProviderHealth?.recordFailure(
            input.title.id,
            input.providerId,
            resolvedProviderId,
            primaryFailureKind,
          );
        } else if (resolvedProviderId === input.providerId) {
          this.deps.titleProviderHealth?.recordCleanSuccess(input.title.id, input.providerId);
        }
        const commitDecision = decideResolveResultCommit({
          hasResolvedStream: true,
          signalAborted: input.signal.aborted,
          cancellationReason: input.cancellationReason,
        });

        if (commitDecision.action !== "discard") {
          await this.persistResolvedStream(
            input,
            engineResult.providerId ?? input.providerId,
            stream,
          );
        }

        if (commitDecision.action === "persist-and-return") {
          emitSelectionDecision(input, resolvedProviderId, engineResult.result);
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
                    selectedSourceId: providerScopedSelection(input, a.providerId).selectedSourceId,
                    selectedStreamId: providerScopedSelection(input, a.providerId).selectedStreamId,
                    blockedStreamUrls: input.blockedStreamUrls,
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
    }

    const primaryFailureKind = titleProviderFailureFromAttempts(
      engineResult.attempts,
      input.providerId,
    );
    if (primaryFailureKind) {
      this.deps.titleProviderHealth?.recordFailure(
        input.title.id,
        input.providerId,
        undefined,
        primaryFailureKind,
      );
    }

    if (cachedStream && input.preserveCachedStreamOnFreshFailure === true) {
      input.onEvent?.({ type: "fresh-source-failed-using-cache", providerId: input.providerId });
      return {
        stream: { ...cachedStream, cacheProvenance: "cached" },
        providerId: input.providerId,
        attempts: engineResult.attempts.map((a) => ({
          providerId: a.providerId,
          stream: null,
          result: a.result,
          failure: a.failure,
        })),
        providerTimeline,
        cacheStatus: "hit",
        cacheProvenance: "cached",
      };
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

  private getPriorityOrderedModules() {
    const priority = this.deps.getProviderPriority?.();
    return priority
      ? orderProviderModulesByPriority(this.deps.engine.modules, priority)
      : this.deps.engine.modules;
  }

  private async persistResolvedStream(
    input: PlaybackResolveInput,
    providerId: string,
    stream: StreamInfo,
  ): Promise<void> {
    if (stream.deferredLocator) {
      return;
    }
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
      const existing = this.deps.providerHealth.get(delta.providerId);
      const consecutiveFailures =
        delta.outcome === "success" || delta.outcome === "stalled"
          ? 0
          : (existing?.consecutiveFailures ?? 0) + 1;
      const status: "healthy" | "degraded" | "down" =
        consecutiveFailures >= 5 ? "down" : consecutiveFailures >= 2 ? "degraded" : "healthy";
      const recentFailureRate =
        existing?.recentFailureRate !== undefined
          ? existing.recentFailureRate * 0.7 + (delta.outcome === "success" ? 0 : 0.3)
          : delta.outcome === "success"
            ? 0
            : 1;
      this.deps.providerHealth.set({
        providerId: delta.providerId,
        status,
        checkedAt: delta.at,
        medianResolveMs: delta.resolveMs,
        recentFailureRate: Math.max(0, Math.min(1, recentFailureRate)),
        consecutiveFailures,
        subtitleSuccessRate: undefined,
        streamSurvivalRate: undefined,
      });
    } catch {
      // Health persistence is best-effort
    }
  }

  private async checkCachedStreamHealth(
    stream: StreamInfo,
    options: {
      readonly force?: boolean;
      readonly signal?: AbortSignal;
      readonly phase?: StreamHealthPhase;
    } = {},
  ): Promise<{
    readonly healthy: boolean;
    readonly checked: boolean;
    readonly strategy: "none" | "hls-manifest-get" | "head-then-range";
    readonly ageMs?: number;
  }> {
    const healthService = this.deps.streamHealthService ?? new StreamHealthService();
    const checkOptions = {
      force: options.force,
      signal: options.signal,
      phase: options.phase,
    };
    if (this.deps.streamHealth) {
      const policy = await healthService.check(stream, checkOptions);
      if (!policy.checked) return policy;
      if (options.signal?.aborted) {
        return { healthy: false, checked: true, strategy: policy.strategy };
      }
      return {
        ...policy,
        healthy: await this.deps.streamHealth(stream.url, stream.headers, options.signal),
      };
    }
    return healthService.check(stream, checkOptions);
  }

  private buildCacheKey(input: PlaybackResolveInput, providerId: string): string {
    const providerManifest = this.deps.engine.getManifest(providerId);
    const selection = providerScopedSelection(input, providerId);
    return buildApiStreamResolveCacheKey({
      providerId,
      providerManifest,
      title: input.title,
      episode: input.episode,
      mode: input.mode,
      audioPreference: input.audioPreference,
      subtitlePreference: input.subtitlePreference,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
      selectedSourceId: selection.selectedSourceId,
      selectedStreamId: selection.selectedStreamId,
    });
  }
}

function providerScopedSelection(
  input: Pick<PlaybackResolveInput, "providerId" | "selectedSourceId" | "selectedStreamId">,
  providerId: string,
): Pick<PlaybackResolveInput, "selectedSourceId" | "selectedStreamId"> {
  if (providerId !== input.providerId) return {};
  return {
    selectedSourceId: input.selectedSourceId,
    selectedStreamId: input.selectedStreamId,
  };
}

function inventoryMatchesSelection(
  inventory: { readonly streams: readonly { readonly id: string; readonly sourceId?: string }[] },
  input: Pick<PlaybackResolveInput, "selectedSourceId" | "selectedStreamId">,
): boolean {
  if (
    input.selectedStreamId &&
    !inventory.streams.some((stream) => stream.id === input.selectedStreamId)
  ) {
    return false;
  }
  if (
    input.selectedSourceId &&
    !inventory.streams.some((stream) => stream.sourceId === input.selectedSourceId)
  ) {
    return false;
  }
  return true;
}

function cachedStreamMatchesSelection(
  stream: StreamInfo,
  input: Pick<PlaybackResolveInput, "selectedSourceId" | "selectedStreamId">,
): boolean {
  const result = stream.providerResolveResult;
  if (!result) return true;
  if (input.selectedStreamId && result.selectedStreamId !== input.selectedStreamId) {
    return false;
  }
  if (input.selectedSourceId) {
    const selected = result.streams.find((candidate) => candidate.id === result.selectedStreamId);
    if (selected?.sourceId !== input.selectedSourceId) {
      return false;
    }
  }
  return true;
}

function providerResultHasDeferredStream(result: ProviderResolveResult): boolean {
  return result.streams.some((stream) => Boolean(stream.deferredLocator));
}

function isBlockedStreamUrl(
  url: string | undefined,
  blockedStreamUrls?: readonly string[],
): boolean {
  return Boolean(url && blockedStreamUrls?.includes(url));
}

function createResolvedStreamPreflightFailure(providerId: string): ProviderFailure {
  return {
    providerId: providerId as ProviderId,
    code: "expired",
    message: "Resolved stream manifest was not reachable before playback",
    retryable: true,
    at: new Date().toISOString(),
  };
}

function markAttemptFailedByPreflight(
  attempts: readonly ProviderEngineResolveAttempt[],
  providerId: string,
  failure: ProviderFailure,
): { readonly attempts: ProviderEngineResolveAttempt[]; readonly index: number } {
  const index = attempts.findLastIndex((attempt) => attempt.providerId === providerId);
  if (index === -1) {
    return {
      attempts: [...attempts, { providerId: providerId as ProviderId, failure }],
      index: attempts.length,
    };
  }
  return {
    attempts: attempts.map((attempt, attemptIndex) =>
      attemptIndex === index
        ? {
            providerId: attempt.providerId,
            failure,
          }
        : attempt,
    ),
    index,
  };
}

function emitSelectionDecision(
  input: PlaybackResolveInput,
  providerId: string,
  result: ProviderResolveResult,
): void {
  if (!result.selectionDecision) return;
  input.onEvent?.({
    type: "selection-decision",
    providerId,
    decision: result.selectionDecision,
  });
}

function titleProviderFailureFromAttempts(
  attempts: readonly ProviderEngineResolveAttempt[],
  providerId: string,
): CountableTitleProviderFailure | null {
  const attempt = attempts.find((candidate) => candidate.providerId === providerId);
  const failure = attempt?.failure ?? attempt?.result?.failures[0];
  if (!failure) return null;
  switch (classifyProviderFailure(failure).failureClass) {
    case "timeout":
      return "timeout";
    case "provider-parse":
      return "parse";
    case "provider-empty":
      return "no-streams";
    case "expired-stream":
      return "dead-stream";
    default:
      return null;
  }
}

function buildProviderTimeline(
  engineResult: {
    readonly providerId?: string | null;
    readonly result?: unknown;
    readonly attempts: readonly ProviderEngineResolveAttempt[];
  },
  primaryProviderId: string,
  correlation?: DiagnosticCorrelation,
): ProviderAttemptTimelineSnapshot {
  const traceId = correlation?.providerAttemptId ?? createCorrelationId("provider");
  const timeline = createProviderAttemptTimeline({ traceId });
  let lastFailureClass: ReturnType<typeof classifyProviderFailure>["failureClass"] | null = null;
  let lastFailedProviderId: string | null = null;
  let timelineOrder = 0;
  const nextTimelineOrder = () => timelineOrder++;

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
        at: nextTimelineOrder(),
      });
    } else {
      timeline.record({
        type: "attempt-started",
        attemptId,
        providerId: attempt.providerId,
        reason: attempt.providerId === primaryProviderId ? "primary" : "fallback",
        at: nextTimelineOrder(),
      });
    }

    const resolvedProviderId = engineResult.providerId ?? null;
    const succeeded =
      Boolean(attempt.result?.streams.length) ||
      (resolvedProviderId !== null && attempt.providerId === resolvedProviderId);

    if (succeeded) {
      timeline.record({
        type: "attempt-succeeded",
        attemptId,
        providerId: attempt.providerId,
        at: nextTimelineOrder(),
        cacheHit: attempt.result?.trace.cacheHit,
        streamCount: attempt.result?.streams.length,
      });
      lastFailureClass = null;
      lastFailedProviderId = null;
      return;
    }

    const failure = attempt.failure ?? attempt.result?.failures[0];
    const classification = classifyProviderFailure(
      failure ?? {
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
      at: nextTimelineOrder(),
      failureClass: classification.failureClass,
      retryable: classification.fallbackPolicy === "auto-fallback",
      userSummary: failure?.message ?? classification.userSummary,
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
      at: nextTimelineOrder(),
      userSummary:
        policy === "guided-action"
          ? "Provider needs your choice before Kunai can continue."
          : "No playable stream found after trying available providers.",
    });
  }

  return timeline.snapshot();
}
