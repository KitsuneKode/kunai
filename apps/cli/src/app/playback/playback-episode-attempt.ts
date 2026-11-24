// =============================================================================
// Playback episode attempt
//
// One loop iteration's identity: the cancellable resolve (and why it was
// cancelled), which source owns the episode (verified local file or provider
// adapter), its diagnostic correlation and startup timeline, the provider that
// actually ends up serving it, and the track-pick helpers bound to all that.
// Every later stage of the iteration reads these from one `EpisodeAttempt`.
// =============================================================================
import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import { playbackDeadStreamScopeKey } from "@/app/playback/playback-dead-stream-ledger";
import { updatePlaybackFeedback } from "@/app/playback/playback-phase-feedback";
import type {
  PlaybackIterationStep,
  PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import {
  resolvePlaybackSourceAuthority,
  type PlaybackSourceAuthority,
} from "@/app/playback/playback-source-authority";
import {
  type PlaybackStartIntent,
  startEpisodeNavigation,
} from "@/app/playback/playback-start-intent";
import {
  applyPlaybackControlTrackSelection,
  buildTrackOverrideDiagnosticContext,
} from "@/app/playback/playback-track-selection-policy";
import { summarizeStartupStreamSource } from "@/app/playback/policies/startup-stage-policy";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import { applyTrackPickRestart } from "@/app/playback/track-pick-restart";
import { buildOfflineFileUnavailableProblem } from "@/domain/playback/playback-problem";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import type { EpisodeInfo, StreamInfo } from "@/domain/types";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
  formatStartupPhaseBreakdown,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";

export type EpisodeResolveControl = {
  readonly controller: AbortController;
  /** Why the user cancelled the in-flight resolve; read when it comes back empty. */
  abortIntent: "cancel" | "fallback" | "retry" | null;
  /** The session-stop listener, detached when the iteration ends. */
  readonly abortOnSessionStop: () => void;
};

/**
 * Starts this episode's cancellable resolve: a session stop aborts it, and the
 * work-control entry lets Esc / provider skip / recover cancel it with intent.
 */
export function armEpisodeResolve(
  loop: PlaybackLoopState,
  currentEpisode: EpisodeInfo,
): EpisodeResolveControl {
  const { context, title } = loop;
  const { workControl } = context.container;
  const resolveController = new AbortController();
  // Abort reasons ride on the signal (as AbortError so fetch-failure
  // classification is unchanged) — the resolve commit policy reads them
  // to decide whether a late result is kept or discarded.
  const abortResolve = (reason: string) =>
    resolveController.abort(new DOMException(reason, "AbortError"));
  const abortOnSessionStop = () =>
    abortResolve(
      typeof context.signal.reason === "string" ? context.signal.reason : "session-shutdown",
    );
  const control: EpisodeResolveControl = {
    controller: resolveController,
    abortIntent: null,
    abortOnSessionStop,
  };
  context.signal.addEventListener("abort", abortOnSessionStop, { once: true });
  resolveController.signal.addEventListener(
    "abort",
    () => {
      if (!context.signal.aborted) {
        updatePlaybackFeedback(context, {
          detail:
            control.abortIntent === "fallback"
              ? "Skipping current provider…"
              : control.abortIntent === "retry"
                ? "Restarting resolve…"
                : "Cancelling…",
          note:
            control.abortIntent === "fallback"
              ? "Trying the next compatible provider"
              : control.abortIntent === "retry"
                ? "Refreshing provider sources"
                : "Returning to results",
        });
      }
    },
    { once: true },
  );
  workControl.setActive({
    id: `playback-resolve:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
    label: `${title.name} S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`,
    cancel: (reason) => {
      control.abortIntent = reason?.includes("fallback")
        ? "fallback"
        : reason?.includes("recover") || reason?.includes("recompute")
          ? "retry"
          : "cancel";
      abortResolve(reason ?? "user-requested");
    },
  });
  return control;
}

export type EpisodeSourceAuthority = Extract<
  PlaybackSourceAuthority,
  { readonly kind: "local" } | { readonly kind: "provider" }
>;

/** Decides whether this episode plays from a verified local file or a provider. */
export async function resolveEpisodeSourceAuthority(
  loop: PlaybackLoopState,
  currentEpisode: EpisodeInfo,
): Promise<
  | { readonly kind: "exit"; readonly step: PlaybackIterationStep }
  | {
      readonly kind: "ready";
      readonly sourceAuthority: EpisodeSourceAuthority;
      readonly configuredProviderId: string;
    }
> {
  const { context, title, run, isOfflineLaunch } = loop;
  const { container } = context;
  const { providerRegistry, stateManager, diagnosticsService } = container;
  const configuredProviderId = stateManager.getState().provider;
  if (run.sessionSoftProviderId && run.sessionSoftProviderId !== configuredProviderId) {
    run.sessionSoftProviderId = null;
  }
  const sourceAuthority = await resolvePlaybackSourceAuthority({
    configuredProviderId: run.sessionSoftProviderId ?? configuredProviderId,
    offlineOnly: isOfflineLaunch,
    resolveLocal: () =>
      resolveLocalEpisodePlayback(container, title, currentEpisode, {
        entrypoint: isOfflineLaunch
          ? "offline-library"
          : title.launchSource === "continue"
            ? "continue"
            : "online-search",
        forceOnline:
          !isOfflineLaunch &&
          (run.episodePlaybackSourceOverride === "online" ||
            run.pendingSourceRefreshAction !== null),
        forceLocal: isOfflineLaunch || run.episodePlaybackSourceOverride === "local",
      }),
    getProvider: (id) => providerRegistry.get(id),
  });
  run.episodePlaybackSourceOverride = null;
  if (sourceAuthority.kind === "provider-unavailable") {
    return {
      kind: "exit",
      step: {
        status: "error",
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: `Provider ${sourceAuthority.providerId} not found`,
          retryable: false,
        },
      },
    };
  }
  if (sourceAuthority.kind === "offline-unavailable") {
    stateManager.dispatch({ type: "SET_STREAM", stream: null });
    const problem = buildOfflineFileUnavailableProblem();
    stateManager.dispatch({ type: "SET_PLAYBACK_PROBLEM", problem });
    diagnosticsService.record({
      category: "playback",
      operation: "playback.source.local.unavailable",
      message: problem.userMessage,
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      context: { cause: problem.cause, recommendedAction: problem.recommendedAction },
    });
    return { kind: "exit", step: { status: "success", value: "back_to_results" } };
  }
  return { kind: "ready", sourceAuthority, configuredProviderId };
}

export type EpisodeAttempt = {
  readonly currentEpisode: EpisodeInfo;
  /** Aborted when the loop moves past this iteration (late subtitle work). */
  readonly playbackIterationAbort: AbortController;
  readonly resolve: EpisodeResolveControl;
  readonly sourceAuthority: EpisodeSourceAuthority;
  /** The shell's provider when this iteration started. */
  readonly configuredProviderId: string;
  /** The provider this iteration resolves with (or the local file's provenance). */
  readonly sourceProviderId: string;
  readonly localPlayback: boolean;
  readonly deadStreamScope: string;
  readonly playbackCorrelation: DiagnosticCorrelation;
  /** The provider actually serving the episode; moves on fallback, soft hop and source picks. */
  resolvedProviderId: string;
  readonly completeSourceTrackPick: (
    pickedEpisode: EpisodeInfo,
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent | null,
    resumeSeconds: number,
    reason: string,
  ) => Promise<PlaybackStartIntent | null>;
  readonly applyConfirmedPlaybackTrackSelection: (
    action: "pick-source" | "pick-stream" | "pick-quality",
    selection: StreamSelectionIntent,
    resumeSeconds: number,
  ) => Promise<PlaybackStartIntent>;
  readonly recordTrackOverrideSelected: (
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent,
  ) => void;
  readonly recordStartupMark: (stage: PlaybackStartupStage, activeStream?: StreamInfo) => void;
};

export function createEpisodeAttempt(
  loop: PlaybackLoopState,
  input: {
    readonly currentEpisode: EpisodeInfo;
    readonly playbackIterationAbort: AbortController;
    readonly resolve: EpisodeResolveControl;
    readonly sourceAuthority: EpisodeSourceAuthority;
    readonly configuredProviderId: string;
  },
): EpisodeAttempt {
  const {
    context,
    title,
    run,
    selectionCoordinator,
    setPreferredStreamSelection,
    invalidateRecentEpisodeStream,
    prepareStreamSwitchRestart,
  } = loop;
  const { container } = context;
  const { config, diagnosticsService } = container;
  const { currentEpisode, sourceAuthority } = input;
  // Stored provider identity remains provenance for history/share; only
  // the provider arm below owns a registered runtime adapter.
  const sourceProviderId =
    sourceAuthority.kind === "local"
      ? sourceAuthority.resolution.source.providerId
      : sourceAuthority.provider.metadata.id;
  const localPlayback = sourceAuthority.kind === "local";

  const deadStreamScope = playbackDeadStreamScopeKey({
    titleId: title.id,
    season: currentEpisode.season,
    episode: currentEpisode.episode,
    providerEpisodeIdentity: currentEpisode.providerEpisodeIdentity,
    providerId: sourceProviderId,
  });
  const providerAttemptId = createCorrelationId("provider");
  const playbackCorrelation: DiagnosticCorrelation = {
    sessionId: container.sessionId,
    playbackCycleId: createCorrelationId("playback"),
    providerAttemptId,
    traceId: providerAttemptId,
  };
  const startupTimeline = createPlaybackStartupTimeline({
    source: { providerId: localPlayback ? "local" : sourceProviderId },
  });
  const completeSourceTrackPick = async (
    pickedEpisode: EpisodeInfo,
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent | null,
    resumeSeconds: number,
    reason: string,
  ): Promise<ReturnType<typeof startEpisodeNavigation> | null> => {
    const { resolveTracksPanelPick } = await import("@/app/playback/tracks-panel-pick");
    const resolved = await resolveTracksPanelPick(picked, selection, {
      container,
      title,
      episode: pickedEpisode,
      currentProviderId: attempt.resolvedProviderId,
      playbackSourceKind: sourceAuthority.kind,
      resumeSeconds,
      reason,
    });

    if (resolved.kind === "noop" && sourceAuthority.kind === "local") return null;

    const restart = await applyTrackPickRestart({
      resolved,
      currentProviderId: attempt.resolvedProviderId,
      episode: pickedEpisode,
      resumeSeconds,
      effects: {
        applyManualSourcePick: (providerId, targetEpisode, sourceId) =>
          selectionCoordinator.applyManualSourcePick(providerId, targetEpisode, sourceId),
        applyEpisodeSelection: (providerId, targetEpisode, streamSelection) =>
          selectionCoordinator.applyEpisodeSelection(providerId, targetEpisode, streamSelection),
        invalidateRecentEpisodeStream,
        prepareStreamSwitchRestart,
      },
    });

    attempt.resolvedProviderId = restart.resolvedProviderId;
    if (restart.requiresFreshResolve) {
      run.pendingSourceRefreshAction = "recover";
      run.pendingRecomputeSources = false;
    }
    if (restart.notice) {
      updatePlaybackFeedback(context, { note: restart.notice });
    }
    return restart.startIntent;
  };
  const applyConfirmedPlaybackTrackSelection = async (
    action: "pick-source" | "pick-stream" | "pick-quality",
    selection: StreamSelectionIntent,
    resumeSeconds: number,
  ) => {
    const outcome = await applyPlaybackControlTrackSelection({
      action,
      providerId: attempt.resolvedProviderId,
      episode: currentEpisode,
      selection,
      resumeSeconds,
      effects: {
        applyManualSourcePick: (providerId, targetEpisode, sourceId) =>
          selectionCoordinator.applyManualSourcePick(providerId, targetEpisode, sourceId),
        applyEpisodeSelection: (providerId, targetEpisode, streamSelection) =>
          setPreferredStreamSelection(providerId, targetEpisode, streamSelection),
        prepareStreamSwitchRestart,
      },
    });

    diagnosticsService.record({
      category: "playback",
      message: outcome.diagnostic.message,
      context: {
        ...outcome.diagnostic.context,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
      },
    });

    return outcome.startIntent;
  };
  const recordTrackOverrideSelected = (
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent,
  ) => {
    diagnosticsService.record({
      category: "playback",
      message: "Track override selected",
      context: {
        ...buildTrackOverrideDiagnosticContext({
          section: picked.section,
          selection,
        }),
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
      },
    });
  };
  const recordStartupMark = (stage: PlaybackStartupStage, activeStream?: StreamInfo) => {
    if (!startupTimeline.mark(stage)) return;
    const snapshot = startupTimeline.snapshot();
    diagnosticsService.record({
      ...playbackCorrelation,
      category: "playback",
      operation: "playback.startup.timeline",
      message: `Playback startup ${stage}`,
      providerId: activeStream?.providerResolveResult?.providerId ?? attempt.resolvedProviderId,
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      context: {
        stage,
        summary: formatPlaybackStartupTimeline(snapshot),
        timeline: snapshot,
        source: summarizeStartupStreamSource(activeStream),
      },
    });
    // Once the first frame lands, emit a single phase-bucketed breakdown
    // (resolve vs prepare vs spawn vs first-frame) naming the dominant
    // cost — this is the autonext "stall" instrument. `autoNext` flags
    // whether this startup was an auto-advance vs a manual start.
    if (stage === "first-progress") {
      const phases = summarizeStartupPhases(snapshot);
      if (phases) {
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "playback",
          operation: "playback.startup.phases",
          message: `Playback startup phases (${phases.dominant} dominant)`,
          providerId: attempt.resolvedProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          context: {
            autoNext: config.autoNext,
            breakdown: formatStartupPhaseBreakdown(phases),
            ...phases,
          },
        });
      }
    }
  };
  const attempt: EpisodeAttempt = {
    ...input,
    sourceProviderId,
    localPlayback,
    deadStreamScope,
    playbackCorrelation,
    resolvedProviderId: sourceProviderId,
    completeSourceTrackPick,
    applyConfirmedPlaybackTrackSelection,
    recordTrackOverrideSelected,
    recordStartupMark,
  };
  return attempt;
}
