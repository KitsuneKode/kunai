// =============================================================================
// Playback player launch
//
// Hands one prepared stream to the player for one iteration: starts the late
// subtitle lookup, opens the history ledger, and wires the session hooks
// (feedback, startup marks, presence, status, track changes, share copy).
// Resolves with the player's result when the file ends.
// =============================================================================

import { startLateSubtitleResolver } from "@/app/playback/late-subtitle-resolver";
import { episodeIdentityForHistory } from "@/app/playback/playback-history-identity";
import type { PlaybackLedgerSlot } from "@/app/playback/playback-ledger-slot";
import {
  updatePlaybackFeedback,
  applyPlaybackStatusSignal,
} from "@/app/playback/playback-phase-feedback";
import { updatePresenceInBackground } from "@/app/playback/playback-presence-writer";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import { STARTUP_STALL_TIMEOUT_MS } from "@/app/playback/playback-source-failover";
import { runPlaybackSession } from "@/app/playback/run-playback-session";
import { describePlaybackSubtitleStatus } from "@/app/playback/subtitle-status";
import type { PhaseContext } from "@/app/session/Phase";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import type {
  TitleInfo,
  EpisodeInfo,
  PlaybackTimingMetadata,
  StreamInfo,
  PlaybackResult,
} from "@/domain/types";
import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import { type DiagnosticCorrelation } from "@/services/diagnostics/correlation";
import { buildPlaybackDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import { type PlaybackStartupStage } from "@/services/playback/playback-startup-timeline";

export type PlayerLaunchInput = {
  readonly stream: StreamInfo;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly context: PhaseContext;
  /** The phase's ledger slot; filled when the player reports progress events. */
  readonly ledger: PlaybackLedgerSlot;
  readonly startAt?: number;
  readonly resumePromptAt?: number;
  readonly playbackMode?: "manual" | "autoplay-chain";
  readonly timing?: PlaybackTimingMetadata | null;
  readonly onNearEof?: () => void;
  readonly suppressResumePrompt?: boolean;
  readonly correlation?: DiagnosticCorrelation;
  readonly onStartupMark?: (stage: PlaybackStartupStage) => void;
  readonly successfulProviderId?: string;
  /** Aborted when the phase loop moves past this iteration. */
  readonly playbackIterationSignal?: AbortSignal;
  readonly onConfirmedPlaybackStart?: () => void;
  readonly localPlaybackSource?: LocalPlaybackSource;
};

export async function launchPlayback(input: PlayerLaunchInput): Promise<PlaybackResult> {
  const {
    title,
    episode,
    context,
    ledger: ledgerSlot,
    startAt = 0,
    resumePromptAt = 0,
    playbackMode = "manual",
    timing = null,
    onNearEof,
    suppressResumePrompt = false,
    correlation,
    onStartupMark,
    successfulProviderId,
    playbackIterationSignal,
    onConfirmedPlaybackStart,
    localPlaybackSource,
  } = input;
  let { stream } = input;
  const {
    player,
    stateManager,
    config,
    historyRepository,
    playbackEventRepository,
    playerControl,
    diagnosticsService,
  } = context.container;

  if (stream.playbackSubtitle) {
    stream = { ...stream, playbackSubtitle: undefined };
    stateManager.dispatch({ type: "SET_STREAM", stream });
  }
  const subtitleStatus = describePlaybackSubtitleStatus(
    stream,
    playbackSubtitlePreference({
      overrides: stateManager.getState().playbackTrackPreferences,
      mode: stateManager.getState().mode,
      title,
      config,
    }),
  );

  if (player.capabilities.externalSubtitles && !localPlaybackSource)
    startLateSubtitleResolver({
      stream,
      title,
      episode,
      context,
      playbackIterationSignal,
    });

  const playbackProviderId = successfulProviderId ?? stateManager.getState().provider;
  // One cycle has one start instant. Recomputing it per update made every
  // queued presence write claim playback had just begun.
  const presenceStartedAtMs = Date.now();
  const presenceBase = () => ({
    mode: stateManager.getState().mode,
    title,
    episode,
    providerId: playbackProviderId,
    stream,
    startedAtMs: presenceStartedAtMs,
  });

  const ledgerProviderId = playbackProviderId;
  const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
    providerId: ledgerProviderId,
  });
  if (player.capabilities.progressEvents) {
    const ledger = new PlaybackHistoryLedger(historyRepository, playbackEventRepository, (error) =>
      context.container.diagnosticsService.record({
        category: "playback",
        operation: "playback.history.persist",
        level: "warn",
        message: "Playback history write dropped after a persistence failure",
        context: { error: error instanceof Error ? error.message : String(error) },
      }),
    );
    // Shutdown flushes this before releasing mpv, so the latest resume
    // position survives a Ctrl+C mid-playback. Null-safe once finalized.
    ledgerSlot.attach(ledger, (checkpoint) =>
      context.container.activePlaybackCheckpoint.register(checkpoint),
    );
    ledger.start(
      {
        title: {
          id: title.id,
          kind: persistedKind,
          title: title.name,
          externalIds: enrichExternalIdsWithVideoMeta(
            title.externalIds,
            stateManager.getState().videoMeta,
          ),
        },
        episode: episodeIdentityForHistory(title, episode),
        providerId: ledgerProviderId,
        posterUrl: title.posterUrl,
        mediaKind: persistedKind,
      },
      startAt,
    );
  }

  return runPlaybackSession({
    stream,
    title,
    episode,
    player,
    subtitleStatus,
    startAt,
    sessionAborted: context.signal.aborted,
    iterationAborted: playbackIterationSignal?.aborted ?? false,
    correlation,
    timing,
    localPlaybackSource,
    shareLinkContext: {
      mode: stateManager.getState().mode,
      title,
      episode:
        title.type === "series" ? { season: episode.season, episode: episode.episode } : undefined,
      providerId: playbackProviderId,
    },
    playOptions: {
      abortSignal: context.signal,
      audioPreference: playbackAudioPreference({
        overrides: stateManager.getState().playbackTrackPreferences,
        mode: stateManager.getState().mode,
        title,
        config,
      }),
      subtitlePreference: playbackSubtitlePreference({
        overrides: stateManager.getState().playbackTrackPreferences,
        mode: stateManager.getState().mode,
        title,
        config,
      }),
      qualityPreference: playbackQualityPreference({
        overrides: stateManager.getState().playbackTrackPreferences,
        mode: stateManager.getState().mode,
        title,
        config,
      }),
      resumePromptAt,
      attach: false,
      playbackMode,
      resumeStartChoicePrompt: suppressResumePrompt ? false : config.resumeStartChoicePrompt,
      autoSkipEnabled: !stateManager.getState().autoskipSessionPaused,
      skipRecap: config.skipRecap,
      skipIntro: config.skipIntro,
      skipPreview: config.skipPreview,
      skipCredits: config.skipCredits,
      onNearEof,
    },
    hooks: {
      onFeedback: (update) => updatePlaybackFeedback(context, update),
      onStartupMark,
      onConfirmedPlaybackStart,
      onStartupStallAbort: () => {
        diagnosticsService.record(
          buildPlaybackDiagnosticEvent({
            operation: "playback.startup-stall.aborted",
            status: "failed",
            severity: "degraded",
            failureClass: "timeout",
            message: "Startup stall watchdog aborted mpv",
            correlation,
            context: {
              timeoutMs: STARTUP_STALL_TIMEOUT_MS,
              streamHost: (() => {
                try {
                  return new URL(stream.url).hostname;
                } catch {
                  return null;
                }
              })(),
            },
          }),
        );
        const active = playerControl.getActive();
        if (!active) return;
        void active.stop("startup-stall").catch(() => {
          /* best-effort abort; suspectedDeadStream is set on return */
        });
      },
      onPresenceLaunch: ({ positionSeconds, subtitleCount }) => {
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackLaunch",
          { ...presenceBase(), positionSeconds, subtitleCount },
          null,
          correlation,
        );
      },
      onPresenceStarted: ({ positionSeconds, durationSeconds, snapshot }) => {
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackStarted",
          {
            ...presenceBase(),
            positionSeconds,
            durationSeconds,
            subtitleCount: undefined,
          },
          snapshot,
          correlation,
        );
      },
      onPresenceProgress: ({ positionSeconds, durationSeconds, snapshot }) => {
        ledgerSlot.current?.onProgress(positionSeconds, durationSeconds);
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackProgress",
          { ...presenceBase(), positionSeconds, durationSeconds },
          snapshot,
          correlation,
        );
      },
      onPresenceSubtitles: ({ positionSeconds, durationSeconds, trackCount, snapshot }) => {
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackSubtitles",
          {
            ...presenceBase(),
            positionSeconds,
            durationSeconds,
            subtitleCount: trackCount,
          },
          snapshot,
          correlation,
        );
      },
      onPresencePaused: ({ positionSeconds, durationSeconds, snapshot }) => {
        ledgerSlot.current?.onPaused(positionSeconds, durationSeconds);
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackPaused",
          {
            ...presenceBase(),
            positionSeconds,
            durationSeconds,
            paused: true,
          },
          snapshot,
          correlation,
        );
      },
      onPresenceResumed: ({ positionSeconds, durationSeconds, snapshot }) => {
        ledgerSlot.current?.onResumed(positionSeconds, durationSeconds);
        updatePresenceInBackground(
          context,
          "presence.updatePlaybackResumed",
          { ...presenceBase(), positionSeconds, durationSeconds },
          snapshot,
          correlation,
        );
      },
      applyPlaybackStatusSignal: (signal) => applyPlaybackStatusSignal(context, signal),
      onTrackChanged: (event) => {
        const currentStream = stateManager.getState().stream;
        if (currentStream && event.trackType === "sub" && event.subtitleState) {
          const observedStream = { ...currentStream, playbackSubtitle: event.subtitleState };
          if (event.id === 0) observedStream.subtitle = undefined;
          stateManager.dispatch({ type: "SET_STREAM", stream: observedStream });
        } else if (currentStream && event.trackType === "sub" && event.id === 0) {
          stateManager.dispatch({
            type: "SET_STREAM",
            stream: { ...currentStream, subtitle: undefined },
          });
        }
        context.container.diagnosticsService.record({
          category: "playback",
          message: "Track changed from mpv",
          context: {
            trackType: event.trackType,
            id: event.id,
          },
        });
      },
      onShareCopied: (shareCopy) => {
        updatePlaybackFeedback(context, {
          note: shareCopy?.copied
            ? "Share link copied from mpv."
            : shareCopy
              ? `Share link (copy manually): ${shareCopy.url}`
              : "Could not build a share link for this title.",
        });
      },
      onPlayerReady: () => {},
    },
  });
}
