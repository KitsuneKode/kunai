// =============================================================================
// Post-playback recovery
//
// Runs right after the player returns. A dead or failed provider stream has its
// URL blocked and caches invalidated; the player's control action is read once;
// the result policy then decides between relaunching a local file, refreshing
// or recovering the provider source (with startup failover across catalog
// sources, bounded by MAX_AUTO_SOURCE_RECOVER_ATTEMPTS), hopping to a fallback
// provider, or handing the action on to the control/post-play stages.
// =============================================================================

import {
  MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
  releasePersistentMpvForTerminalFailure,
  shouldReleasePersistentMpvBeforePostPlay,
} from "@/app/playback/mpv-session-lifecycle";
import { playbackDeadStreamScopeKey } from "@/app/playback/playback-dead-stream-ledger";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import {
  buildPlaybackFailoverNotice,
  playbackSourceDisplayLabel,
  providerDisplayName,
} from "@/app/playback/playback-failover-copy";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import {
  NEXT_ITERATION,
  type PlaybackIterationStep,
  type PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import {
  isProviderIdFallbackEligible,
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import {
  didPlaybackFailToStart,
  resolvePlaybackResultDecision,
  syncPlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import { invalidateEpisodePlaybackCaches } from "@/app/playback/playback-source-cache-invalidation";
import {
  listOrderedPlaybackSourceIds,
  planQualityStepDown,
  planStartupFailover,
  shouldUseProviderPlaybackRecovery,
} from "@/app/playback/playback-source-failover";
import {
  recoveryStartIntent,
  startAtResumePoint,
  startEpisodeNavigation,
} from "@/app/playback/playback-start-intent";
import type { AcquiredStream, ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import { toHistoryTimestamp } from "@/domain/playback/playback-history";
import {
  buildLocalPlaybackFailureProblem,
  buildPlayerFailureProblem,
} from "@/domain/playback/playback-problem";
import type { EpisodeInfo, PlaybackResult } from "@/domain/types";
import { classifyPlaybackFailureFromResult } from "@/infra/player/playback-failure-classifier";
import { buildRecoveryDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";

export type QuitThresholdMode =
  PlaybackLoopState["context"]["container"]["config"]["quitNearEndThresholdMode"];

/** The player's control action, read once after playback and handed to later stages. */
export type PlaybackControlIntent = {
  readonly playbackControlAction: ReturnType<
    PlaybackLoopState["context"]["container"]["playerControl"]["consumeLastAction"]
  >;
  readonly confirmedStreamSelection: StreamSelectionIntent | null;
  readonly confirmedEpisodeSelection: EpisodeInfo | null;
};

export type PlaybackRecoveryOutcome =
  | { readonly kind: "exit"; readonly step: PlaybackIterationStep }
  | ({ readonly kind: "proceed" } & PlaybackControlIntent);

/** A stream that had played tells the user it stopped, not that it never started. */
function recoveryExhaustedDetail(result: PlaybackResult): string {
  const played = Math.max(result.lastReliableProgressSeconds ?? 0, result.watchedSeconds);
  return played > 0
    ? "Playback stopped and no other source could continue it"
    : "Could not start playback";
}

export async function recoverAfterPlayback(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  acquired: AcquiredStream,
  ready: ReadyEpisodeStream,
  result: PlaybackResult,
  quitThresholdMode: QuitThresholdMode,
): Promise<PlaybackRecoveryOutcome> {
  const {
    context,
    title,
    run,
    selectionCoordinator,
    getPreferredStreamSelection,
    deadStreamUrls,
    invalidateRecentEpisodeStream,
  } = loop;
  const { container } = context;
  const {
    providerRegistry,
    stateManager,
    config,
    cacheStore,
    diagnosticsService,
    playerControl,
    player,
  } = container;
  const { currentEpisode, sourceAuthority, playbackCorrelation } = attempt;
  const { streamProvenance, consumedBundle } = acquired;
  const { providerHandoff, effectiveTiming, preparedStream } = ready;
  const providerRecoveryAllowed =
    sourceAuthority.kind === "provider" && shouldUseProviderPlaybackRecovery(streamProvenance);
  const shouldInvalidateStreamCache =
    providerRecoveryAllowed &&
    (result.endReason === "error" ||
      result.suspectedDeadStream === true ||
      didPlaybackFailToStart(result));
  if (shouldInvalidateStreamCache) {
    const invalidateProviderId = providerHandoff.successfulProviderId;
    const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
      (candidate) => candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
    );
    deadStreamUrls.record(
      playbackDeadStreamScopeKey({
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        providerEpisodeIdentity: currentEpisode.providerEpisodeIdentity,
        providerId: invalidateProviderId,
      }),
      preparedStream.url,
    );
    await invalidateEpisodePlaybackCaches({
      cacheStore,
      sourceInventory: container.sourceInventory,
      providerId: invalidateProviderId,
      providerManifest: container.providerRegistry.getManifest(invalidateProviderId),
      title,
      episode: currentEpisode,
      mode: stateManager.getState().mode,
      config,
      overrides: stateManager.getState().playbackTrackPreferences,
      selectedSourceId: selectedResolveStream?.sourceId,
      selectedStreamId: preparedStream.providerResolveResult?.selectedStreamId,
    });
    invalidateRecentEpisodeStream(currentEpisode);
    if (result.suspectedDeadStream === true && result.streamRejectedBeforePlayerLaunch !== true) {
      container.titleProviderHealth.recordFailure(
        title.id,
        invalidateProviderId,
        undefined,
        "dead-stream",
      );
    }
    diagnosticsService.record({
      category: "playback",
      message: result.suspectedDeadStream
        ? "Stream ended early — cached URL invalidated for next resolve"
        : "Stream died — cache entry invalidated for next resolve",
      context: {
        provider: invalidateProviderId,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        exitCode: result.playerExitCode,
        exitSignal: result.playerExitSignal,
        suspectedDeadStream: result.suspectedDeadStream === true,
        wasPrefetched: Boolean(consumedBundle),
      },
    });
  }

  const playbackControlAction = playerControl.consumeLastAction();
  const confirmedStreamSelection =
    playbackControlAction === "pick-source" ||
    playbackControlAction === "pick-stream" ||
    playbackControlAction === "pick-quality"
      ? playerControl.consumePendingStreamSelection()
      : null;
  const confirmedEpisodeSelection =
    playbackControlAction === "pick-episode"
      ? playerControl.consumePendingEpisodeSelection()
      : null;
  if (playbackControlAction === "switch-title") {
    // A notification (or other handoff) asked to leave this title's
    // session entirely: the file stop already landed, so exit with the
    // target and let SessionController re-enter playback for it.
    const titleSelection = playerControl.consumePendingTitleSelection();
    if (titleSelection) {
      diagnosticsService.record({
        category: "playback",
        message: "Switching to a different title from active playback",
        context: {
          fromTitleId: title.id,
          toTitleId: titleSelection.title.id,
        },
      });
      return {
        kind: "exit",
        step: {
          status: "success",
          value: {
            type: "history_entry",
            title: titleSelection.title,
            episode: titleSelection.episode,
          },
        },
      };
    }
  }
  run.playbackSession = syncPlaybackSessionState(run.playbackSession, {
    autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
    stopAfterCurrent: stateManager.getState().stopAfterCurrent,
  });
  const playbackDecision = resolvePlaybackResultDecision({
    result,
    controlAction: playbackControlAction,
    session: run.playbackSession,
    timing: effectiveTiming.current,
    endPolicy: {
      quitNearEndBehavior: config.quitNearEndBehavior,
      quitNearEndThresholdMode: config.quitNearEndThresholdMode,
    },
  });
  run.playbackSession = playbackDecision.session;
  // The "interrupted" pause is an internal, per-episode guard so quitting
  // mid-episode does not immediately auto-advance. It is deliberately NOT
  // pushed into shell state: doing so rendered "autoplay paused" as if the
  // user's session preference had changed just because they closed mpv.
  // Only an explicit toggle changes the visible autoplay setting.
  let shouldAutoFallbackProvider =
    playbackDecision.shouldFallbackProvider && sourceAuthority.kind === "provider";
  if (!providerRecoveryAllowed && playbackDecision.shouldRefreshSource) {
    const isExplicitLocalRelaunch =
      playbackControlAction === "refresh" || playbackControlAction === "recover";
    if (isExplicitLocalRelaunch) {
      run.pendingStart = startAtResumePoint(
        toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
        { suppressResumePrompt: true },
      );
      run.episodePlaybackSourceOverride = "local";
      return { kind: "exit", step: NEXT_ITERATION };
    }

    const localProblem = buildLocalPlaybackFailureProblem();
    stateManager.dispatch({
      type: "SET_PLAYBACK_PROBLEM",
      problem: localProblem,
    });
    diagnosticsService.record({
      ...playbackCorrelation,
      category: "playback",
      operation: "playback.source.local.failed",
      level: "error",
      message: localProblem.userMessage,
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      context: {
        cause: localProblem.cause,
        endReason: result.endReason,
        playerExitCode: result.playerExitCode,
      },
    });
    await releasePersistentMpvForTerminalFailure({
      player,
      playerControl,
      userMessage: localProblem.userMessage,
      reason: `local-playback:${classifyPlaybackFailureFromResult(result)}`,
      diagnostics: diagnosticsService,
    });
    return { kind: "exit", step: { status: "success", value: "back_to_results" } };
  }

  if (providerRecoveryAllowed && playbackDecision.shouldRefreshSource) {
    const isExplicitSourceRefresh =
      playbackControlAction === "refresh" || playbackControlAction === "recover";
    const isAutoSourceRecover =
      !isExplicitSourceRefresh &&
      (result.suspectedDeadStream === true || didPlaybackFailToStart(result));

    const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
      (candidate) => candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
    );
    const currentSourceId =
      selectedResolveStream?.sourceId ??
      getPreferredStreamSelection(attempt.resolvedProviderId, currentEpisode).sourceId ??
      null;

    let skipRefreshContinue = false;
    // Only consulted when the budget still allows a recovery (the branch order below).
    const stepDown = isAutoSourceRecover
      ? planQualityStepDown(preparedStream.providerResolveResult, run.recoveryQualityCeiling)
      : null;

    if (isAutoSourceRecover && run.autoSourceRecoverAttempts >= MAX_AUTO_SOURCE_RECOVER_ATTEMPTS) {
      diagnosticsService.record({
        category: "playback",
        level: "warn",
        message:
          "Auto-recover already attempted for this episode; opening post-play instead of looping",
        context: {
          provider: attempt.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          endReason: result.endReason,
          watchedSeconds: result.watchedSeconds,
        },
      });
      if (shouldReleasePersistentMpvBeforePostPlay(result, true)) {
        const failureClass = classifyPlaybackFailureFromResult(result);
        const playerProblem = buildPlayerFailureProblem(failureClass);
        await releasePersistentMpvForTerminalFailure({
          player,
          playerControl,
          userMessage: playerProblem.userMessage,
          reason: `playback-auto-recover-exhausted:${failureClass}`,
          diagnostics: diagnosticsService,
        });
      }
      updatePlaybackFeedback(context, {
        detail: recoveryExhaustedDetail(result),
        note: "Press o for sources, ⇧F for fallback, r to retry, or /diagnostics for details",
      });
      skipRefreshContinue = true;
    } else if (stepDown) {
      // Same source, 1080p: the source is not abandoned yet, so it is not
      // marked tried. The attempt still counts against the recovery budget.
      run.recoveryQualityCeiling = stepDown;
      await selectionCoordinator.applyAutomaticSourceFailover(
        attempt.resolvedProviderId,
        currentEpisode,
        stepDown.sourceId,
      );
      diagnosticsService.record({
        category: "playback",
        message: "Failing 4K stream stepping down to 1080p on the same source",
        context: {
          operation: "playback.auto-recovery.quality-step-down",
          sourceId: stepDown.sourceId,
          fromQuality: selectedResolveStream?.qualityRank ?? null,
          maxQuality: stepDown.maxRank,
          provider: attempt.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
        },
      });
      void playerControl
        .getActive()
        ?.setEpisodeTransitionLoading?.(
          "Kunai · 4K stream failed, trying 1080p on the same server…",
        );
    } else if (isAutoSourceRecover) {
      if (currentSourceId && !run.triedFailoverSourceIds.includes(currentSourceId)) {
        run.triedFailoverSourceIds.push(currentSourceId);
      }

      const failoverPlan = planStartupFailover({
        sourceIds: listOrderedPlaybackSourceIds(preparedStream.providerResolveResult),
        currentSourceId,
        triedSourceIds: new Set(run.triedFailoverSourceIds),
        // `manual` never hops providers on its own; the user drives ⇧F/fallback.
        hasFallbackProvider:
          config.recoveryMode !== "manual" &&
          Boolean(
            pickCompatibleFallbackProvider({
              providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
              currentProviderId: attempt.resolvedProviderId,
              excludedProviderIds: new Set(stateManager.getState().fallbackTriedProviderIds),
              isFallbackEligible: (providerId) =>
                isProviderIdFallbackEligible(container, providerId),
            }),
          ),
        failoverAttempts: run.autoSourceRecoverAttempts,
        maxFailoverAttempts: MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
        providerHopUsed: run.startupProviderHopUsed,
      });

      if (failoverPlan.kind === "advance-source") {
        // Record the target, not only what played. A provider may refuse the
        // requested source and land on the previous one, and only noting the
        // played source let recovery bounce A→B→A until the budget ran out.
        if (!run.triedFailoverSourceIds.includes(failoverPlan.sourceId)) {
          run.triedFailoverSourceIds.push(failoverPlan.sourceId);
        }
        await selectionCoordinator.applyAutomaticSourceFailover(
          attempt.resolvedProviderId,
          currentEpisode,
          failoverPlan.sourceId,
        );
        diagnosticsService.record({
          category: "playback",
          message: "Startup stall failover advancing to next catalog source",
          context: {
            operation: "playback.startup-stall.failover",
            fromSourceId: currentSourceId,
            toSourceId: failoverPlan.sourceId,
            provider: attempt.resolvedProviderId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
          },
        });
        const failoverNotice = buildPlaybackFailoverNotice({
          phase: result.suspectedDeadStream === true ? "mid-stream" : "startup",
          fromLabel: playbackSourceDisplayLabel({
            sourceId: currentSourceId,
            inventory: preparedStream.providerResolveResult,
            providerName: providerDisplayName(
              providerRegistry.get(attempt.resolvedProviderId)?.metadata.name,
            ),
          }),
          toLabel: playbackSourceDisplayLabel({
            sourceId: failoverPlan.sourceId,
            inventory: preparedStream.providerResolveResult,
            providerName: providerDisplayName(
              providerRegistry.get(attempt.resolvedProviderId)?.metadata.name,
            ),
          }),
          preservedSeconds:
            result.suspectedDeadStream === true
              ? (result.lastNonZeroPositionSeconds ?? result.watchedSeconds)
              : null,
        });
        stateManager.dispatch({ type: "SET_PLAYBACK_FAILOVER", failover: failoverNotice });
        const failoverLine = failoverNotice.toLabel
          ? `Kunai · Switching from ${failoverNotice.fromLabel} to ${failoverNotice.toLabel}…`
          : `Kunai · Switching from ${failoverNotice.fromLabel}…`;
        void playerControl.getActive()?.setEpisodeTransitionLoading?.(failoverLine);
      } else if (failoverPlan.kind === "fallback-provider") {
        shouldAutoFallbackProvider = true;
        skipRefreshContinue = true;
      } else {
        diagnosticsService.record({
          category: "playback",
          level: "warn",
          message: "Startup failover exhausted catalog sources and provider hops",
          context: {
            provider: attempt.resolvedProviderId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            triedSourceIds: run.triedFailoverSourceIds,
          },
        });
        if (shouldReleasePersistentMpvBeforePostPlay(result, true)) {
          const failureClass = classifyPlaybackFailureFromResult(result);
          const playerProblem = buildPlayerFailureProblem(failureClass);
          await releasePersistentMpvForTerminalFailure({
            player,
            playerControl,
            userMessage: playerProblem.userMessage,
            reason: `playback-startup-failover-exhausted:${failureClass}`,
            diagnostics: diagnosticsService,
          });
        }
        updatePlaybackFeedback(context, {
          detail: recoveryExhaustedDetail(result),
          note: "Press o for sources, ⇧F for fallback, r to retry, or /diagnostics for details",
        });
        skipRefreshContinue = true;
      }
    }

    if (!skipRefreshContinue) {
      run.pendingRecomputeSources = playbackControlAction === "recompute";
      run.pendingStart = recoveryStartIntent(
        toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
        run.pendingStart,
      );
      run.pendingSourceRefreshAction =
        playbackControlAction === "recompute"
          ? "recover"
          : result.suspectedDeadStream === true ||
              didPlaybackFailToStart(result) ||
              playbackControlAction === "recover"
            ? "recover"
            : "refresh";
      if (isAutoSourceRecover) {
        run.autoSourceRecoverAttempts += 1;
      }
      diagnosticsService.record(
        buildRecoveryDiagnosticEvent({
          operation: "playback.source-refresh.requested",
          stage: run.pendingSourceRefreshAction,
          status: "started",
          severity: isAutoSourceRecover ? "recoverable" : "degraded",
          recommendedAction:
            run.pendingSourceRefreshAction === "recover" ? "recover" : "refresh-source",
          message:
            run.pendingSourceRefreshAction === "recover"
              ? "Recovery requested for current provider source"
              : "Refresh requested for current provider source",
          providerId: attempt.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          context: {
            provider: attempt.resolvedProviderId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            resumeSeconds: run.pendingStart.startAt,
            action: run.pendingSourceRefreshAction,
            recomputeSources: run.pendingRecomputeSources,
            autoRecover: isAutoSourceRecover,
            autoRecoverAttempts: run.autoSourceRecoverAttempts,
          },
        }),
      );
      run.playbackSession = transitionPlaybackSession(
        context,
        run.playbackSession,
        "recovery-started",
        {
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          provider: attempt.resolvedProviderId,
          action: run.pendingSourceRefreshAction,
        },
      );
      return { kind: "exit", step: NEXT_ITERATION };
    }
  }

  if (shouldAutoFallbackProvider) {
    const reached = toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode);
    // A hop after a failure continues where the stream stopped; a hop the user
    // asked for offers the position, since another provider's cut can differ.
    run.pendingStart =
      result.suspectedDeadStream === true || didPlaybackFailToStart(result)
        ? recoveryStartIntent(reached, run.pendingStart)
        : startEpisodeNavigation({ targetResumeSeconds: reached });
    const fallback = pickCompatibleFallbackProvider({
      providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
      currentProviderId: attempt.resolvedProviderId,
      excludedProviderIds: new Set(stateManager.getState().fallbackTriedProviderIds),
      isFallbackEligible: (providerId) => isProviderIdFallbackEligible(container, providerId),
    });

    if (fallback) {
      run.sessionSoftProviderId = null;
      const switched = await switchPlaybackProviderFallback({
        container,
        fromProviderId: attempt.resolvedProviderId,
        toProviderId: fallback.metadata.id,
        title,
        episode: currentEpisode,
        mode: stateManager.getState().mode,
        invalidateRecentEpisodeStream,
      });
      attempt.resolvedProviderId = switched.providerId;
      const providerNotice = buildPlaybackFailoverNotice({
        phase: result.suspectedDeadStream === true ? "mid-stream" : "startup",
        fromLabel: providerDisplayName(
          providerRegistry.get(switched.fromProviderId)?.metadata.name,
        ),
        toLabel: providerDisplayName(fallback.metadata.name),
        preservedSeconds:
          result.suspectedDeadStream === true
            ? (result.lastNonZeroPositionSeconds ?? result.watchedSeconds)
            : null,
      });
      stateManager.dispatch({ type: "SET_PLAYBACK_FAILOVER", failover: providerNotice });
      run.pendingSourceRefreshAction = "recover";
      run.pendingRecomputeSources = false;
      run.startupProviderHopUsed = true;
      run.triedFailoverSourceIds = [];
      if (playbackControlAction !== "fallback") {
        run.autoSourceRecoverAttempts += 1;
      }
      diagnosticsService.record(
        buildRecoveryDiagnosticEvent({
          operation:
            playbackControlAction === "fallback"
              ? "playback.provider-fallback.started"
              : "playback.startup-stall.failover",
          stage: "fallback-provider",
          status: "started",
          severity: "recoverable",
          recommendedAction: "fallback-provider",
          message:
            playbackControlAction === "fallback"
              ? "Switching to fallback provider after playback control request"
              : "Startup stall failover hopping to next compatible provider",
          providerId: switched.providerId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          context: {
            from: switched.fromProviderId,
            fallback: switched.providerId,
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            resumeSeconds: Math.max(run.pendingStart.startAt, run.pendingStart.resumePromptAt),
            autoFailover: playbackControlAction !== "fallback",
          },
        }),
      );
      return { kind: "exit", step: NEXT_ITERATION };
    }

    diagnosticsService.record(
      buildRecoveryDiagnosticEvent({
        operation: "playback.provider-fallback.unavailable",
        stage: "fallback-provider",
        status: "failed",
        severity: "blocked",
        failureClass: "not-found",
        message: "Fallback playback control requested but no compatible provider was available",
        providerId: attempt.resolvedProviderId,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        context: {
          provider: attempt.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
        },
      }),
    );
    updatePlaybackFeedback(context, {
      note: "No untried provider left to fall back to. Press o for sources or /diagnostics.",
    });
    // Keep the pending start intent for this episode; re-resolve instead of falling
    // through to auto-advance / post-playback with a poisoned resume offset.
    return { kind: "exit", step: NEXT_ITERATION };
  }
  return {
    kind: "proceed",
    playbackControlAction,
    confirmedStreamSelection,
    confirmedEpisodeSelection,
  };
}
