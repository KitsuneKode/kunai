import {
  describeMpvPlayerEvent,
  type MpvPlaybackFeedback,
} from "@/app/playback/mpv-playback-event-copy";
import {
  formatMpvEpisodeDisplayTitle,
  shouldAbortPlaybackBeforeLaunch,
} from "@/app/playback/mpv-session-lifecycle";
import {
  networkSampleShowsBytes,
  STARTUP_NO_BYTES_TIMEOUT_MS,
  STARTUP_STALL_TIMEOUT_MS,
} from "@/app/playback/playback-source-failover";
import type {
  PlaybackStatusDecision,
  PlaybackStatusSignal,
  PlaybackStatusSnapshot,
} from "@/app/playback/playback-status-policy";
import {
  formatPlaybackStreamRoute,
  playbackStartupStageForPlayerEvent,
} from "@/app/playback/policies/startup-stage-policy";
import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type {
  EpisodeInfo,
  PlaybackResult,
  PlaybackTimingMetadata,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerService,
} from "@/infra/player/PlayerService";
import type { DiagnosticCorrelation } from "@/services/diagnostics/correlation";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import type { PlaybackStartupStage } from "@/services/playback/playback-startup-timeline";

export type StartupAbortReason =
  | { readonly kind: "no-progress"; readonly timeoutMs: number }
  /** Nothing arrived from the server at all: dead, not slow. */
  | { readonly kind: "no-bytes"; readonly timeoutMs: number }
  | {
      readonly kind: "video-not-decoding";
      readonly evidence: Extract<PlayerPlaybackEvent, { type: "video-not-decoding" }>;
    };

/** A real timer, or a test's own id: the session only hands it back to `clear`. */
type TimerHandle = ReturnType<typeof setTimeout> | number;
export type StartupTimers = {
  readonly set: (callback: () => void, ms: number) => TimerHandle;
  readonly clear: (handle: TimerHandle) => void;
};
const realTimers: StartupTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
};

export type MpvPlaybackSessionHooks = {
  readonly onFeedback: (update: MpvPlaybackFeedback) => void;
  readonly onStartupMark?: (stage: PlaybackStartupStage) => void;
  /**
   * Abort in-flight mpv when startup fails: no byte from the server within
   * STARTUP_NO_BYTES_TIMEOUT_MS (when the player can tell), no first progress
   * within STARTUP_STALL_TIMEOUT_MS, or a selected video track that plays
   * without a decoded frame. Either way the existing source recovery takes over.
   */
  readonly onStartupStallAbort?: (reason: StartupAbortReason) => void | Promise<void>;
  /**
   * Fired once on confirmed `playback-started` (not process spawn / IPC).
   * Queue acknowledgement belongs here.
   */
  readonly onConfirmedPlaybackStart?: () => void;
  readonly onPresenceLaunch: (input: {
    readonly positionSeconds: number;
    readonly subtitleCount?: number;
  }) => void;
  readonly onPresenceStarted: (input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly snapshot: PlaybackStatusSnapshot;
  }) => void;
  readonly onPresenceProgress: (input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly snapshot: PlaybackStatusSnapshot;
  }) => void;
  readonly onPresenceSubtitles: (input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly trackCount: number;
    readonly snapshot: PlaybackStatusSnapshot;
  }) => void;
  readonly onPresencePaused: (input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly snapshot: PlaybackStatusSnapshot;
  }) => void;
  readonly onPresenceResumed: (input: {
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly snapshot: PlaybackStatusSnapshot;
  }) => void;
  /**
   * The only way this loop moves playback status. Submits a generation-bearing
   * signal to the transition policy and reports whether it was accepted.
   */
  readonly applyPlaybackStatusSignal: (signal: PlaybackStatusSignal) => PlaybackStatusDecision;
  readonly onTrackChanged: (event: Extract<PlayerPlaybackEvent, { type: "track-changed" }>) => void;
  readonly onShareCopied: NonNullable<PlayerOptions["shareLinkContext"]>["onCopied"];
  readonly onPlayerReady: () => void;
};

export type RunMpvPlaybackSessionInput = {
  readonly stream: StreamInfo;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly player: PlayerService;
  readonly playOptions: Omit<
    PlayerOptions,
    | "url"
    | "headers"
    | "subtitle"
    | "subtitleStatus"
    | "displayTitle"
    | "onPlaybackEvent"
    | "onPlayerReady"
    | "shareLinkContext"
  >;
  readonly subtitleStatus: string;
  readonly startAt: number;
  readonly hooks: MpvPlaybackSessionHooks;
  readonly sessionAborted: boolean;
  readonly iterationAborted: boolean;
  readonly correlation?: DiagnosticCorrelation;
  /** Startup budgets; tests shorten them, production uses the defaults. */
  readonly startupBudget?: { readonly noBytesMs: number; readonly noProgressMs: number };
  /** Timer seam for the startup budgets; tests fire them without waiting. */
  readonly startupTimers?: StartupTimers;
  readonly shareLinkContext: Omit<NonNullable<PlayerOptions["shareLinkContext"]>, "onCopied">;
  readonly timing: PlaybackTimingMetadata | null;
  readonly localPlaybackSource?: LocalPlaybackSource;
};

/**
 * Launches mpv and routes the playback event loop (extracted from PlaybackPhase.playStream).
 */
export async function runMpvPlaybackSession(
  input: RunMpvPlaybackSessionInput,
): Promise<PlaybackResult> {
  const { stream, title, episode, player, hooks } = input;

  if (shouldAbortPlaybackBeforeLaunch(input.sessionAborted, input.iterationAborted)) {
    throw new PlaybackAbortedError("playback aborted before launch");
  }

  const displayTitle = formatMpvEpisodeDisplayTitle(title, episode);
  const initialSubtitleCount = stream.subtitleList?.length
    ? stream.subtitleList.length
    : stream.subtitle
      ? 1
      : undefined;

  let latestPresencePositionSeconds = input.startAt > 0 ? input.startAt : 0;
  let latestPresenceDurationSeconds = 0;
  const timers = input.startupTimers ?? realTimers;
  let bootstrapStallTimer: TimerHandle | null = null;
  let noBytesTimer: TimerHandle | null = null;
  const budget = input.startupBudget ?? {
    noBytesMs: STARTUP_NO_BYTES_TIMEOUT_MS,
    noProgressMs: STARTUP_STALL_TIMEOUT_MS,
  };
  // The early no-bytes exit needs a player that reports bytes, a remote URL,
  // and no yt-dlp step (extraction runs before any byte flows).
  const watchForBytes =
    input.player.capabilities.networkEvidence &&
    !input.localPlaybackSource &&
    !stream.requiresYtdl &&
    /^https?:\/\//i.test(stream.url);
  let startupStallFired = false;
  let startupStallArmed = false;
  let confirmedPlaybackStartNotified = false;
  /** Installed synchronously by `onGenerationActivated`, before any player event. */
  let activeGeneration: PlaybackGeneration | null = null;

  const clearNoBytesTimer = () => {
    if (noBytesTimer !== null) {
      timers.clear(noBytesTimer);
      noBytesTimer = null;
    }
  };
  const clearBootstrapStallTimer = () => {
    clearNoBytesTimer();
    if (bootstrapStallTimer !== null) {
      timers.clear(bootstrapStallTimer);
      bootstrapStallTimer = null;
    }
  };

  /** One way out of a failed startup; the reason only changes the copy and diagnostics. */
  const abortStartup = (reason: StartupAbortReason) => {
    if (startupStallFired) return;
    if (!activeGeneration) return;
    // An old watchdog must not abort a replacement generation.
    const decision = hooks.applyPlaybackStatusSignal({
      kind: "startup-stall",
      generation: activeGeneration,
    });
    if (!decision.accepted) return;
    startupStallFired = true;
    clearBootstrapStallTimer();
    const route = formatPlaybackStreamRoute(stream);
    hooks.onFeedback(
      reason.kind === "video-not-decoding"
        ? {
            detail: "Video isn't decoding — trying next source",
            note: [
              `${reason.evidence.codec ? `${reason.evidence.codec} ` : ""}video produced no frames in ${reason.evidence.secondsWithoutVideo}s of playback`,
              route,
              "auto failover · o source · ⇧F fallback",
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : {
            detail:
              reason.kind === "no-bytes"
                ? "Server sent nothing — trying next source"
                : "Startup stalled — trying next source",
            note: [
              reason.kind === "no-bytes"
                ? `startup-stall: no data from the server within ${reason.timeoutMs / 1000}s`
                : `startup-stall: no playback progress within ${reason.timeoutMs / 1000}s`,
              route,
              "auto failover · o source · ⇧F fallback",
            ]
              .filter(Boolean)
              .join(" · "),
          },
    );
    void Promise.resolve(hooks.onStartupStallAbort?.(reason)).catch(() => {
      /* stop best-effort; play() return path marks suspectedDeadStream */
    });
  };

  const armStartupStallWatchdog = () => {
    if (startupStallArmed || startupStallFired) return;
    startupStallArmed = true;
    clearBootstrapStallTimer();
    bootstrapStallTimer = timers.set(() => {
      abortStartup({ kind: "no-progress", timeoutMs: budget.noProgressMs });
    }, budget.noProgressMs);
    if (watchForBytes) {
      noBytesTimer = timers.set(() => {
        abortStartup({ kind: "no-bytes", timeoutMs: budget.noBytesMs });
      }, budget.noBytesMs);
    }
  };

  hooks.onFeedback({ detail: "Launching player", note: input.subtitleStatus });
  hooks.onPresenceLaunch({
    positionSeconds: latestPresencePositionSeconds,
    subtitleCount: initialSubtitleCount,
  });

  try {
    const playerOptions: PlayerOptions = {
      ...input.playOptions,
      url: stream.url,
      headers: stream.headers,
      subtitle: stream.subtitle,
      subtitleStatus: input.subtitleStatus,
      displayTitle,
      startAt: input.startAt,
      timing: input.timing,
      correlation: input.correlation,
      localPlaybackSource: input.localPlaybackSource,
      shareLinkContext: {
        ...input.shareLinkContext,
        onCopied: hooks.onShareCopied,
      },
      onGenerationActivated: (generation) => {
        activeGeneration = generation;
        hooks.applyPlaybackStatusSignal({ kind: "activate", generation, status: "loading" });
      },
      onPlayerReady: () => {
        if (!activeGeneration) return;
        const decision = hooks.applyPlaybackStatusSignal({
          kind: "player-event",
          generation: activeGeneration,
          event: { type: "player-ready" },
        });
        if (!decision.accepted) return;
        hooks.onFeedback({ detail: "Player controls ready" });
        hooks.onPlayerReady();
      },
      onPlaybackEvent: ({ generation, event }) => {
        // Freshness and authority are decided first: a rejected event performs
        // no startup mark, feedback, presence, history, or track side effect.
        const decision = hooks.applyPlaybackStatusSignal({
          kind: "player-event",
          generation,
          event,
        });
        if (!decision.accepted) return;
        const snapshot = decision.snapshot;

        const startupStage = playbackStartupStageForPlayerEvent(event);
        if (startupStage) hooks.onStartupMark?.(startupStage);

        // Unconditional watchdog from player launch (not subtitle-gated). Timeout is
        // generous enough for slow-but-valid CDNs (AllManga) while still failing dead streams.
        if (startupStage === "player-launch" || startupStage === "mpv-process-started") {
          armStartupStallWatchdog();
        }

        if (startupStage === "first-progress" || event.type === "playback-started") {
          clearBootstrapStallTimer();
        }
        // Bytes are arriving: slow, not dead. The full startup budget applies.
        if (event.type === "network-sample" && networkSampleShowsBytes(event)) {
          clearNoBytesTimer();
        }

        if (event.type !== "network-sample") {
          const feedback = describeMpvPlayerEvent(event);
          hooks.onFeedback(
            event.type === "stream-slow" || event.type === "stream-stalled"
              ? {
                  ...feedback,
                  note: [feedback.note, formatPlaybackStreamRoute(stream)]
                    .filter(Boolean)
                    .join(" · "),
                }
              : feedback,
          );
        }

        if (event.type === "video-not-decoding") {
          abortStartup({ kind: "video-not-decoding", evidence: event });
        }

        if (event.type === "playback-started") {
          if (!confirmedPlaybackStartNotified) {
            confirmedPlaybackStartNotified = true;
            hooks.onConfirmedPlaybackStart?.();
          }
          hooks.onPresenceStarted({
            positionSeconds: latestPresencePositionSeconds,
            durationSeconds: latestPresenceDurationSeconds,
            snapshot,
          });
        } else if (event.type === "playback-progress") {
          latestPresencePositionSeconds = event.positionSeconds;
          latestPresenceDurationSeconds = event.durationSeconds;
          hooks.onPresenceProgress({
            positionSeconds: latestPresencePositionSeconds,
            durationSeconds: latestPresenceDurationSeconds,
            snapshot,
          });
        } else if (event.type === "late-subtitles-attached") {
          hooks.onPresenceSubtitles({
            positionSeconds: latestPresencePositionSeconds,
            durationSeconds: latestPresenceDurationSeconds,
            trackCount: event.trackCount,
            snapshot,
          });
        } else if (event.type === "playback-paused") {
          hooks.onPresencePaused({
            positionSeconds: latestPresencePositionSeconds,
            durationSeconds: latestPresenceDurationSeconds,
            snapshot,
          });
        } else if (event.type === "playback-resumed") {
          hooks.onPresenceResumed({
            positionSeconds: latestPresencePositionSeconds,
            durationSeconds: latestPresenceDurationSeconds,
            snapshot,
          });
        } else if (event.type === "track-changed") {
          hooks.onTrackChanged(event);
        }
      },
    };
    // Local files go through play() like any other source. `stream` already
    // carries the file path, subtitle sidecar and display title from
    // buildLocalEpisodeResolution(), while playerOptions carries resume
    // prompting, the autoplay-chain mode, near-EOF prefetch, the abort signal,
    // merged timing, correlation and track preferences. Routing local playback
    // through playLocal() silently dropped every one of those.
    const result = await player.play(stream, playerOptions);

    // The startup watchdog rewrites the result before completion is applied, so
    // a watchdog failure completes as `error` rather than briefly as `finished`.
    const finalResult = startupStallFired
      ? {
          ...result,
          suspectedDeadStream: true,
          endReason: result.endReason === "eof" ? result.endReason : ("error" as const),
        }
      : result;

    if (activeGeneration) {
      hooks.applyPlaybackStatusSignal({
        kind: "completed",
        generation: activeGeneration,
        endReason: finalResult.endReason,
      });
    }
    return finalResult;
  } finally {
    clearBootstrapStallTimer();
  }
}
