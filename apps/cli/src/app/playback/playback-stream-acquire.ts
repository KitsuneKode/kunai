// =============================================================================
// Playback stream acquisition
//
// Gets a playable stream for the iteration's episode. A verified local file is
// used as-is. For a provider: honour refresh/recover requests (with cooldown),
// then take a prefetched bundle, a fresh-enough recently played stream, or a
// full resolve — narrating its progress, guarding the per-title provider
// preference, recording the trace, and adopting a soft fallback provider.
// A resolve that ends without a stream is handed to the failure handling.
// =============================================================================

import { EpisodePrefetchHandle } from "@/app/playback/episode-prefetch";
import { dismissMpvTransitionOverlay } from "@/app/playback/mpv-session-lifecycle";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
  showPlaybackProblem,
} from "@/app/playback/playback-phase-feedback";
import {
  NEXT_ITERATION,
  type PlaybackIterationStep,
  type PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import {
  isProviderIdFallbackEligible,
  pickCompatibleFallbackProvider,
} from "@/app/playback/playback-provider-fallback";
import { resolveStreamProviderId } from "@/app/playback/playback-provider-switch";
import {
  acceptResolvedProviderForPlayback,
  resolvePlaybackResolvePolicy,
} from "@/app/playback/playback-resolve-policy";
import { invalidateEpisodePlaybackCaches } from "@/app/playback/playback-source-cache-invalidation";
import { capQualityPreference } from "@/app/playback/playback-source-failover";
import {
  isRecentPlaybackStreamFresh,
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  restoreRecentPlaybackStream,
  type RecentPlaybackStreamProvenance,
} from "@/app/playback/recent-playback-stream";
import {
  audioFallbackNoticeFromTrace,
  createResolveTraceStub,
  finalizeResolveTrace,
} from "@/app/playback/resolve-trace";
import { planEpisodeIterationDirective } from "@/app/playback/run-playback-episode-iteration";
import { applyPreferredStreamSelection } from "@/app/playback/source-quality";
import { resolveSourceRefreshDecision } from "@/app/playback/source-refresh-policy";
import { buildProviderResolveProblem } from "@/domain/playback/playback-problem";
import {
  describeProviderFallbackDetail,
  describeProviderFallbackHaltedDetail,
  describeProviderFallbackHaltedNote,
  describeProviderHedgeDetail,
  describeProviderHedgeNote,
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/domain/playback/provider-resolve-copy";
import { decideSoftFallbackOnResolve } from "@/domain/playback/soft-fallback-preference-policy";
import type { StreamInfo } from "@/domain/types";
import { observeResolveNetworkOutcome } from "@/services/network/network-observation";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ResolveAttempt } from "@kunai/core";
import { isStremioAddonProviderId } from "@kunai/providers";
import type { ProviderFailure, ProviderId } from "@kunai/types";

export type AcquiredEpisodeStream =
  | { readonly kind: "exit"; readonly step: PlaybackIterationStep }
  | {
      readonly kind: "stream";
      readonly stream: StreamInfo;
      readonly streamProvenance: RecentPlaybackStreamProvenance;
      /** The prefetched bundle this stream came from, if any. */
      readonly consumedBundle: ReturnType<EpisodePrefetchHandle["takeReadyFor"]>;
      /** The prefetched stream already went through playback preparation. */
      readonly prefetchWasPrepared: boolean;
    };

export async function acquireEpisodeStream(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
): Promise<AcquiredEpisodeStream> {
  const {
    context,
    host,
    title,
    run,
    selectionCoordinator,
    sourceRefreshCooldown,
    getPreferredStreamSelection,
    setPreferredStreamSelection,
    episodePrefetch,
    recentEpisodeStreams,
    deadStreamUrls,
    invalidateRecentEpisodeStream,
    recentStreamMatchesPreferred,
    prepareStreamSwitchRestart,
  } = loop;
  const { container } = context;
  const {
    providerRegistry,
    stateManager,
    logger,
    config,
    cacheStore,
    diagnosticsService,
    playerControl,
    workControl,
  } = container;
  const {
    currentEpisode,
    sourceAuthority,
    configuredProviderId,
    sourceProviderId,
    localPlayback,
    deadStreamScope,
    playbackCorrelation,
    recordStartupMark,
  } = attempt;
  const { controller: resolveController } = attempt.resolve;
  const { buildPrefetchTarget, profileContext } = episodeContext;
  let stream: StreamInfo | null =
    sourceAuthority.kind === "local" ? sourceAuthority.resolution.stream : null;
  let streamProvenance: RecentPlaybackStreamProvenance = localPlayback ? "local" : "fresh";
  let consumedBundle: ReturnType<EpisodePrefetchHandle["takeReadyFor"]> = null;
  let prefetchWasPrepared = false;
  if (sourceAuthority.kind === "local") {
    const local = sourceAuthority.resolution;
    run.localEpisodeTiming = local.timing;
    run.localPlaybackJobId = local.jobId;
    run.localPlaybackSource = local.source;
    run.pendingSourceRefreshAction = null;
    run.pendingRecomputeSources = false;
    diagnosticsService.record({
      ...playbackCorrelation,
      category: "playback",
      operation: "playback.source.local",
      message: "Using verified local file for episode playback",
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      context: { jobId: local.jobId },
    });
  }
  if (sourceAuthority.kind === "provider") {
    updatePlaybackFeedback(context, {
      detail: "Resolving provider stream",
      note: "Esc cancel · returns to results",
    });

    const sourceRefreshAction = run.pendingSourceRefreshAction;
    run.pendingSourceRefreshAction = null;
    const recomputeSources = run.pendingRecomputeSources;
    run.pendingRecomputeSources = false;
    await selectionCoordinator.hydrate(sourceProviderId, currentEpisode);
    const currentPreferredStreamSelection = getPreferredStreamSelection(
      sourceProviderId,
      currentEpisode,
    );
    const sourceRefreshDecision = sourceRefreshAction
      ? resolveSourceRefreshDecision(sourceRefreshCooldown, {
          action: sourceRefreshAction,
          scope: {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            providerId: sourceProviderId,
            sourceId: currentPreferredStreamSelection.sourceId,
            streamId: currentPreferredStreamSelection.streamId,
          },
          now: new Date(),
          cooldownMs: 30_000,
        })
      : null;

    if (sourceRefreshDecision?.kind === "cooldown") {
      updatePlaybackFeedback(context, {
        detail: sourceRefreshDecision.message,
        note: "The current stream can be reused without another provider lookup.",
      });
      diagnosticsService.record({
        ...playbackCorrelation,
        category: "playback",
        operation: "playback.refresh.cooldown",
        message: sourceRefreshDecision.message,
        providerId: sourceProviderId,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        context: { remainingMs: sourceRefreshDecision.remainingMs },
      });
    } else if (sourceRefreshDecision) {
      diagnosticsService.record({
        ...playbackCorrelation,
        category: "playback",
        operation:
          sourceRefreshDecision.kind === "recover"
            ? "playback.recover.requested"
            : "playback.refresh.requested",
        message:
          sourceRefreshDecision.kind === "recover"
            ? "Recovering current provider source"
            : "Refreshing current provider source",
        providerId: sourceProviderId,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
      });
    }

    // A user provider switch must not be answered by a bundle prefetched
    // for the provider they just left.
    const providerSwitchSeq = stateManager.getState().providerSwitchSeq;
    const pendingUserProviderSwitch = providerSwitchSeq !== loop.consumedProviderSwitchSeq;
    if (pendingUserProviderSwitch) {
      loop.consumedProviderSwitchSeq = providerSwitchSeq;
      run.sessionSoftProviderId = null;
    }

    // Use a prefetched bundle (resolve + optional subtitle prep during near-EOF)
    // or fall back to a full provider resolve. Explicit refresh/recover bypasses
    // prefetch so it can ask the provider for a fresh source.
    consumedBundle =
      sourceRefreshDecision || pendingUserProviderSwitch
        ? null
        : episodePrefetch.takeReadyFor(buildPrefetchTarget(currentEpisode, sourceProviderId));
    // A prefetched bundle — and later a recent-memory stream — can hold an
    // addon stream after the user disabled the experimental feature (possibly
    // from another process). Reuse it only while the producing addon is still
    // available; built-in providers are never touched by this gate.
    const canReuseProvider = (providerId: string | null | undefined): boolean =>
      !providerId ||
      !isStremioAddonProviderId(providerId) ||
      providerRegistry.get(providerId) !== undefined;
    if (
      consumedBundle &&
      (!canReuseProvider(consumedBundle.resolvedProviderId) ||
        !canReuseProvider(consumedBundle.stream.providerResolveResult?.providerId))
    ) {
      consumedBundle = null;
    }
    prefetchWasPrepared = consumedBundle?.prepared === true;

    stream = consumedBundle?.stream ?? null;
    streamProvenance = consumedBundle ? "prefetch" : "fresh";
    let resolveAttempts: readonly ResolveAttempt<StreamInfo>[] = [];
    if (stream) recordStartupMark("resolve-complete", stream);

    const resolveTrace = createResolveTraceStub({
      title,
      episode: currentEpisode,
      providerId: sourceProviderId,
      mode: stateManager.getState().mode,
    });
    diagnosticsService.record({
      ...playbackCorrelation,
      category: "provider",
      message: "Resolve trace started",
      context: { trace: resolveTrace },
    });

    if (consumedBundle) {
      attempt.resolvedProviderId = consumedBundle.resolvedProviderId;
      logger.info("Using prefetched stream for episode", {
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        prepared: prefetchWasPrepared,
        resolvedProviderId: attempt.resolvedProviderId,
      });
      diagnosticsService.record({
        ...playbackCorrelation,
        category: "provider",
        message: prefetchWasPrepared
          ? "Using prefetched prepared stream"
          : "Using prefetched stream",
        context: {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          prepared: prefetchWasPrepared,
          resolvedProviderId: attempt.resolvedProviderId,
        },
      });
    }

    // Check in-memory cache for recently played episodes (backward navigation).
    // This lets P-navigation reuse the exact same StreamInfo without any
    // provider resolve, cache lookup, or health check.
    if (!stream && !sourceRefreshDecision) {
      const recentKey = recentPlaybackStreamKey(title.id, currentEpisode);
      const recent = recentEpisodeStreams.get(recentKey);
      if (
        recent?.provenance !== "local" &&
        canReuseProvider(recent?.resolvedProviderId) &&
        canReuseProvider(recent?.stream.providerResolveResult?.providerId) &&
        recentPlaybackStreamMatchesProvider(recent, sourceProviderId, currentEpisode) &&
        recentStreamMatchesPreferred(recent, sourceProviderId, currentEpisode) &&
        isRecentPlaybackStreamFresh(recent)
      ) {
        const restored = restoreRecentPlaybackStream(recent);
        stream = restored.stream;
        attempt.resolvedProviderId = restored.resolvedProviderId;
        streamProvenance = restored.provenance;
        run.localPlaybackSource = restored.localPlaybackSource;
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "cache",
          operation: "playback.stream.reused",
          message: "Using in-memory recent episode stream (backward navigation)",
          providerId: recent.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          context: {
            provenance: "recent-memory",
            originalProvenance: recent.provenance,
            selectedProviderId: recent.selectedProviderId,
            resolvedProviderId: recent.resolvedProviderId,
          },
        });
      }
    }

    if (!stream) {
      recordStartupMark("resolve-started");
      const resolvePolicy = resolvePlaybackResolvePolicy({
        recomputeSources,
        pendingUserProviderSwitch,
        sourceRefreshDecision,
        configuredRecoveryMode: config.recoveryMode,
      });
      if (resolvePolicy.shouldInvalidateSuspectResolveState) {
        await invalidateEpisodePlaybackCaches({
          cacheStore,
          sourceInventory: container.sourceInventory,
          providerId: sourceProviderId,
          providerManifest: container.providerRegistry.getManifest(sourceProviderId),
          title,
          episode: currentEpisode,
          mode: stateManager.getState().mode,
          config,
          overrides: stateManager.getState().playbackTrackPreferences,
          selectedSourceId: currentPreferredStreamSelection.sourceId,
          selectedStreamId: currentPreferredStreamSelection.streamId,
        });
      }
      const resolveResult = await container.playbackResolveWork.resolve(
        {
          title,
          episode: currentEpisode,
          mode: stateManager.getState().mode,
          providerId: sourceProviderId,
          audioPreference: playbackAudioPreference(profileContext),
          subtitlePreference: playbackSubtitlePreference(profileContext),
          qualityPreference: playbackQualityPreference(profileContext),
          startupPriority: config.startupPriority,
          favoriteSourceNames: config.favoriteSources,
          selectedSourceId: currentPreferredStreamSelection.sourceId ?? undefined,
          selectedStreamId: currentPreferredStreamSelection.streamId ?? undefined,
          recoveryMode: resolvePolicy.recoveryMode,
          preferFreshStream: resolvePolicy.preferFreshStream,
          forceHealthCheck: resolvePolicy.forceHealthCheck,
          preserveCachedStreamOnFreshFailure: resolvePolicy.preserveCachedStreamOnFreshFailure,
          ignoreTitleHealthSuggestion: resolvePolicy.ignoreTitleHealthSuggestion,
          ignoreProviderHealth: resolvePolicy.ignoreProviderHealth,
          keepPrimaryFirst: resolvePolicy.keepPrimaryFirst,
          resolveIntent: resolvePolicy.resolveIntent,
          blockedStreamUrls: deadStreamUrls.list(deadStreamScope),
          signal: resolveController.signal,
          correlation: playbackCorrelation,
          onFeedback: (feedback) => {
            if (resolveController.signal.aborted) return;
            updatePlaybackFeedback(context, feedback);
          },
          onEvent: (event) => {
            if (event.type === "cache-hit" || event.type === "cache-miss") {
              const hit = event.type === "cache-hit";
              if (hit) {
                logger.info("Provider resolve cache hit", {
                  provider: event.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                });
              }
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "cache",
                message: hit ? "Provider resolve cache hit" : "Provider resolve cache miss",
                context: {
                  provider: event.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
              return;
            }

            if (event.type === "fresh-source-failed-using-cache") {
              updatePlaybackFeedback(context, {
                detail: "No fresher source found. Continuing current stream.",
                note: "The cached stream stayed available, so playback can resume.",
              });
              return;
            }

            if (event.type === "title-provider-suggestion") {
              const suggestedName =
                providerRegistry.get(event.suggestedProviderId)?.metadata.name ??
                event.suggestedProviderId;
              const strugglingName =
                providerRegistry.get(event.providerId)?.metadata.name ?? event.providerId;
              updatePlaybackFeedback(context, {
                note: `${strugglingName} struggled on this title before; ${suggestedName} worked here.`,
              });
              return;
            }

            if (event.type === "provider-engine-event") {
              // Live fallback progress — the post-hoc attempt/failure
              // replay below narrates history; this is what the screen
              // should say while the chain is still running.
              const engineEvent = event.event;
              const engineProviderName = (id: string) =>
                providerRegistry.get(id)?.metadata.name ?? id;
              if (engineEvent.type === "provider-fallback-started") {
                updatePlaybackFeedback(context, {
                  detail: describeProviderFallbackDetail({
                    fromProviderName: engineProviderName(engineEvent.fromProviderId),
                    toProviderName: engineProviderName(engineEvent.toProviderId),
                  }),
                  note: "⇧F skips ahead if this provider stalls too.",
                });
              } else if (engineEvent.type === "provider-hedge-started") {
                updatePlaybackFeedback(context, {
                  // Name the parallel provider in the detail slot: the
                  // previous fallback sentence ("X did not resolve —
                  // trying Y") would otherwise sit stale on screen
                  // while the hedged provider is the live attempt.
                  detail: describeProviderHedgeDetail({
                    toProviderName: engineProviderName(engineEvent.toProviderId),
                  }),
                  note: describeProviderHedgeNote({
                    toProviderName: engineProviderName(engineEvent.toProviderId),
                  }),
                });
              } else if (engineEvent.type === "provider-fallback-halted") {
                updatePlaybackFeedback(context, {
                  detail: describeProviderFallbackHaltedDetail(),
                  note: describeProviderFallbackHaltedNote(),
                });
              }
              return;
            }

            if (event.type === "cache-health-check") {
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "cache",
                message: event.healthy
                  ? "Cached stream health check passed"
                  : "Cached stream health check failed",
                context: {
                  provider: event.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  strategy: event.strategy,
                  ageMs: event.ageMs,
                },
              });
              return;
            }

            if (event.type === "attempt") {
              stateManager.dispatch({
                type: "SET_RESOLVE_RETRY_COUNT",
                count: Math.max(0, event.attempt - 1),
              });
              updatePlaybackFeedback(context, {
                detail: describeProviderResolveAttemptDetail(event),
                note: describeProviderResolveAttemptNote(event),
              });
              return;
            }

            if (event.type === "failure") {
              updatePlaybackFeedback(context, {
                detail: event.retryable
                  ? `Recoverable provider issue (${event.attempt}/${event.maxAttempts})`
                  : "Provider returned a non-recoverable issue",
                note: event.issue,
              });
            } else if (event.type === "cache-stale") {
              updatePlaybackFeedback(context, {
                detail: "Cached stream expired, refetching…",
                note: null,
              });
            }
          },
        },
        {
          intentKind: sourceRefreshDecision?.kind === "recover" ? "recovery" : "playback",
          budgetLane: "user-blocking",
        },
      );

      stream = resolveResult.stream;
      attempt.resolvedProviderId = resolveResult.providerId;
      observeResolveNetworkOutcome(container, resolveResult);
      // A saved per-title provider is where a resolve starts, not a lock. Only
      // a provider-only request (/recompute, or a switch in manual recovery
      // mode) may refuse what the engine's fallback found; in guided or
      // fallback-first mode a working alternative is the point of fallback.
      // Every explicit switch also saves a per-title preference, so the old
      // preference-based guard threw away the fallback after any switch.
      if (
        stream &&
        !acceptResolvedProviderForPlayback({
          policy: resolvePolicy,
          requestedProviderId: sourceProviderId,
          resolvedProviderId: attempt.resolvedProviderId,
        })
      ) {
        const requestedName =
          providerRegistry.get(sourceProviderId)?.metadata.name ?? sourceProviderId;
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "provider",
          level: "warn",
          message: "Rejected alternative provider for a provider-only resolve",
          context: {
            titleId: title.id,
            requestedProviderId: sourceProviderId,
            resolvedProviderId: attempt.resolvedProviderId,
          },
        });
        updatePlaybackFeedback(context, {
          detail: `${requestedName} did not resolve for this episode`,
          note: "Pick another provider, or set Settings → Recovery mode to Balanced recovery.",
        });
        stream = null;
      }
      streamProvenance =
        resolveResult.provenance === "prefetched"
          ? "prefetch"
          : resolveResult.provenance.startsWith("cache")
            ? "cache"
            : resolveResult.providerId !== sourceProviderId
              ? "fallback"
              : "fresh";
      resolveAttempts = resolveResult.attempts;
      if (resolveAttempts.length > 0) {
        // Every provider the chain touched this cycle — successes,
        // failures, and aborted in-flight candidates — is marked tried
        // so a later ⇧F walks forward instead of looping back.
        stateManager.dispatch({
          type: "RECORD_FALLBACK_TRIED_PROVIDERS",
          providerIds: resolveAttempts.map((resolveAttempt) => resolveAttempt.providerId),
        });
      }
      if (stream) recordStartupMark("resolve-complete", stream);

      for (const [attemptIndex, resolveAttempt] of resolveAttempts.entries()) {
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "provider",
          message: resolveAttempt.aborted
            ? "Provider resolve attempt aborted"
            : resolveAttempt.stream
              ? "Provider resolve attempt succeeded"
              : "Provider resolve attempt failed",
          context: {
            stage: "provider-resolve",
            attempt: attemptIndex + 1,
            provider: resolveAttempt.providerId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            hasTrace: Boolean(resolveAttempt.result?.trace),
            failure: resolveAttempt.failure ?? null,
          },
        });
      }

      const hop = decideSoftFallbackOnResolve({
        configuredProviderId: sourceProviderId,
        resolvedProviderId: attempt.resolvedProviderId,
      });
      // A discarded resolve must not move the session onto its provider.
      if (stream && hop.kind === "session-soft-hop") {
        logger.info("Resolved stream with fallback provider", {
          from: sourceProviderId,
          fallback: hop.providerId,
        });
        run.sessionSoftProviderId = hop.providerId;
        host.ledger.current?.alignProvider(hop.providerId);
        const fallbackName = providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
        updatePlaybackFeedback(context, {
          note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
        });
      } else if (pendingUserProviderSwitch) {
        const streamProviderId = resolveStreamProviderId(stream);
        if (streamProviderId && streamProviderId === configuredProviderId) {
          updatePlaybackFeedback(context, {
            note: `Resolving via ${providerRegistry.get(configuredProviderId)?.metadata.name ?? configuredProviderId}.`,
          });
        }
      }

      if (stream?.providerResolveResult) {
        // Surface a silent audio downgrade (e.g. dub requested, only sub
        // available) so the user is told why the language changed rather
        // than just hearing the wrong one.
        const audioFallbackNote = audioFallbackNoticeFromTrace(
          stream.providerResolveResult.trace.events,
        );
        if (audioFallbackNote) {
          updatePlaybackFeedback(context, { note: audioFallbackNote });
        }
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "provider",
          message: "Provider resolve trace completed",
          context: {
            trace: stream.providerResolveResult.trace,
            streamCandidates: stream.providerResolveResult.streams.length,
            subtitleCandidates: stream.providerResolveResult.subtitles.length,
            cachePolicy: stream.providerResolveResult.cachePolicy,
          },
        });
      }
    }

    if (stream) recordStartupMark("resolve-complete", stream);

    // Esc/cancel during resolve must not hand off a late-arriving stream to mpv.
    if (stream && resolveController.signal.aborted && !context.signal.aborted) stream = null;

    // Every resolve path — prefetch, recent-stream reuse, and fresh or
    // fallback resolve — converges here, so each is recorded exactly
    // once. Recorded after the cancel guard above so an abandoned
    // resolve is not filed as a success. An empty `resolveAttempts` is
    // itself the signal that nothing was resolved live.
    container.resolveTraceSink.record(
      finalizeResolveTrace(resolveTrace, {
        endedAt: new Date().toISOString(),
        selectedProviderId: attempt.resolvedProviderId ?? sourceProviderId,
        selectedStreamId: stream?.providerResolveResult?.streams?.[0]?.id,
        cacheHit: streamProvenance === "cache",
        failures: resolveAttempts
          .map((resolveAttempt) => resolveAttempt.failure)
          .filter((failure): failure is ProviderFailure => failure !== undefined),
      }),
    );

    // TypeScript cannot narrow `stream` across the conditional mutation above.
    if (!stream) {
      workControl.setActive(null);
      const resolveAborted = resolveController.signal.aborted && !context.signal.aborted;
      const streamSwitchAction = resolveAborted ? playerControl.consumeLastAction() : null;
      const streamSwitchSelection =
        streamSwitchAction === "pick-source" ||
        streamSwitchAction === "pick-stream" ||
        streamSwitchAction === "pick-quality"
          ? playerControl.consumePendingStreamSelection()
          : null;
      const titleSwitchSelection =
        streamSwitchAction === "switch-title" ? playerControl.consumePendingTitleSelection() : null;
      // Health-aware and tried-aware: a provider marked down or already
      // attempted in this cycle is not a viable fallback target even
      // though it stays selectable explicitly.
      const triedProviderIds = new Set(stateManager.getState().fallbackTriedProviderIds);
      const eligibleFallbackExists = providerRegistry
        .getCompatible(title, stateManager.getState().mode)
        .some(
          (candidate) =>
            candidate.metadata.id !== sourceProviderId &&
            !triedProviderIds.has(candidate.metadata.id) &&
            isProviderFallbackEligible(
              resolveEffectiveProviderHealth(
                // SAFETY: candidate.metadata.id comes from a registered provider module — it is a ProviderId by contract.
                container.providerHealth?.get(candidate.metadata.id as ProviderId),
              ),
            ),
        );
      const hasCompatibleFallbackProvider =
        resolveAborted && attempt.resolve.abortIntent === "fallback"
          ? eligibleFallbackExists
          : false;

      let problemAction: "dismiss" | "retry" | null = null;
      if (!resolveAborted) {
        const problem = buildProviderResolveProblem({
          attempts: resolveAttempts,
          capabilitySnapshot: container.capabilitySnapshot,
          fallbackAvailable: eligibleFallbackExists,
          hasStreamCandidates: resolveAttempts.some(
            (resolveAttempt) =>
              (resolveAttempt.result?.streams.length ?? 0) > 0 ||
              (resolveAttempt.result?.sources?.length ?? 0) > 0,
          ),
        });
        run.playbackSession = transitionPlaybackSession(
          context,
          run.playbackSession,
          "failure-shown",
          {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            cause: problem.cause,
          },
        );
        problemAction = await showPlaybackProblem(context, problem);
      }

      const iterationDirective = planEpisodeIterationDirective({
        streamResolved: false,
        resolveAborted,
        sessionAborted: context.signal.aborted,
        streamSwitchSelection,
        resolveAbortIntent: attempt.resolve.abortIntent,
        hasCompatibleFallbackProvider,
        problemAction,
      });

      if (iterationDirective.kind === "continue") return { kind: "exit", step: NEXT_ITERATION };

      if (iterationDirective.kind === "restart") {
        if (iterationDirective.reason === "stream-switch-during-resolve" && streamSwitchSelection) {
          await setPreferredStreamSelection(
            sourceProviderId,
            currentEpisode,
            streamSwitchSelection,
          );
          await prepareStreamSwitchRestart(currentEpisode);
          diagnosticsService.record({
            ...playbackCorrelation,
            category: "playback",
            message: "Stream selection applied during bootstrap resolve",
            providerId: sourceProviderId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            context: {
              action: streamSwitchAction,
              sourceId: streamSwitchSelection.sourceId,
              streamId: streamSwitchSelection.streamId,
            },
          });
          return { kind: "exit", step: NEXT_ITERATION };
        }

        if (iterationDirective.reason === "provider-fallback-skip") {
          // An explicit provider choice made while the resolve was in
          // flight (the picker dispatches SET_PROVIDER then cancels the
          // work) outranks the automatic "next untried" walk — the user
          // told us exactly where to go.
          const configuredProviderNow = stateManager.getState().provider;
          const explicitPick =
            configuredProviderNow !== sourceProviderId
              ? providerRegistry.get(configuredProviderNow)
              : undefined;
          const fallback =
            explicitPick ??
            pickCompatibleFallbackProvider({
              providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
              currentProviderId: sourceProviderId,
              excludedProviderIds: triedProviderIds,
              isFallbackEligible: (providerId) =>
                isProviderIdFallbackEligible(container, providerId),
            });
          if (fallback) {
            run.sessionSoftProviderId = null;
            stateManager.dispatch({
              type: "SET_PROVIDER",
              provider: fallback.metadata.id,
              forceFreshResolve: !explicitPick,
            });
            updatePlaybackFeedback(context, {
              detail: `Trying ${fallback.metadata.name ?? fallback.metadata.id}…`,
              note: "Fallback provider selected for the rest of this session",
            });
            diagnosticsService.record({
              category: "provider",
              message: "Skipping current provider during playback bootstrap",
              context: {
                from: sourceProviderId,
                fallback: fallback.metadata.id,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
            return { kind: "exit", step: NEXT_ITERATION };
          }
        }

        if (iterationDirective.reason === "resolve-retry") {
          run.pendingSourceRefreshAction = "recover";
          run.pendingRecomputeSources = true;
          run.autoSourceRecoverAttempts = 0;
          invalidateRecentEpisodeStream(currentEpisode);
          updatePlaybackFeedback(context, {
            detail: "Retrying with fresh provider sources…",
            note: "Cached failures and stale source inventory are bypassed for this attempt.",
          });
          return { kind: "exit", step: NEXT_ITERATION };
        }
      }

      if (resolveAborted) {
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
        stateManager.dispatch({ type: "SET_STREAM", stream: null });
        updatePlaybackFeedback(context, { detail: null, note: null });
        await dismissMpvTransitionOverlay(playerControl);
        if (titleSwitchSelection) {
          return {
            kind: "exit",
            step: {
              status: "success",
              value: {
                type: "history_entry",
                title: titleSwitchSelection.title,
                episode: titleSwitchSelection.episode,
              },
            },
          };
        }
      } else {
        stateManager.dispatch({ type: "SET_STREAM", stream: null });
      }
      return { kind: "exit", step: { status: "success", value: "back_to_results" } };
    }

    if (stream && streamProvenance !== "local") {
      const hop = decideSoftFallbackOnResolve({
        configuredProviderId: sourceProviderId,
        resolvedProviderId: attempt.resolvedProviderId,
      });
      if (hop.kind === "session-soft-hop" && run.sessionSoftProviderId !== hop.providerId) {
        logger.info("Resolved stream with fallback provider", {
          from: sourceProviderId,
          fallback: hop.providerId,
        });
        run.sessionSoftProviderId = hop.providerId;
        host.ledger.current?.alignProvider(hop.providerId);
        const fallbackName = providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
        updatePlaybackFeedback(context, {
          note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
        });
      }
    }

    stream = applyPreferredStreamSelection(
      stream,
      getPreferredStreamSelection(sourceProviderId, currentEpisode),
      // A recovery step-down caps quality for the rest of this episode.
      capQualityPreference(playbackQualityPreference(profileContext), run.recoveryQualityCeiling),
      playbackSubtitlePreference(profileContext),
      config.hdrMode,
    );
  }
  if (!stream || resolveController.signal.aborted) {
    stateManager.dispatch({ type: "SET_STREAM", stream: null });
    return { kind: "exit", step: { status: "success", value: "back_to_results" } };
  }
  return { kind: "stream", stream, streamProvenance, consumedBundle, prefetchWasPrepared };
}
