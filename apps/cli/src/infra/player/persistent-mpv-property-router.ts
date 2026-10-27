import type {
  PlaybackSubtitleObservation,
  PlaybackTimingMetadata,
  SubtitleTrack,
} from "@/domain/types";
import { isJsonObject, isJsonNumber, isJsonString } from "@kunai/types";

import type { MpvIpcSession } from "./mpv-ipc";
import { applyObservedPropertySample, type PlayerStatsState } from "./mpv-stats";
import type { PersistentSubtitleManager } from "./persistent-subtitle-manager";
import type { MpvRequestedAction } from "./PlayerControlService";
import type { PlayerPlaybackEvent } from "./PlayerService";

type LatestIpcSample = NonNullable<PlayerStatsState["latestIpcSample"]>;

export type PersistentMpvPropertyCycle = {
  stats: PlayerStatsState;
  acceptPlaybackProperties: boolean;
  playerReadyNotified: boolean;
  playerStartedNotified: boolean;
  lastPlaybackProgressEventAtMs: number;
  lastPlaybackProgressPositionSeconds: number;
  lastPlaybackProgressDurationSeconds: number;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export type PersistentMpvPropertyOptions = {
  displayTitle: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  timing?: PlaybackTimingMetadata | null;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export type PersistentMpvPropertyRouterDeps = {
  getActiveCycle(): PersistentMpvPropertyCycle | null;
  getIpcSession(): MpvIpcSession | null;
  getCurrentOptions(): PersistentMpvPropertyOptions;
  subtitleManager: PersistentSubtitleManager;
  notifyMpvActionRequest(action: MpvRequestedAction): void;
  finishResumeChoiceWait(choice: "resume" | "start"): void;
  handleResumeSeekFromMpv(): Promise<void>;
  handleCopyShareFromMpv(): Promise<void>;
  onSkipRequestFromMpv(automatic: boolean): Promise<void>;
  getCurrentPositionSeconds(): number;
  setCurrentPositionSeconds(value: number): void;
  maybeRearmSkippedSegmentsOnBackwardSeek(
    options: PersistentMpvPropertyOptions,
    previousPositionSeconds: number,
    nextPositionSeconds: number,
  ): void;
  maybeEmitPlaybackProgress(cycle: PersistentMpvPropertyCycle, observedAt: number): void;
  handleSegmentSkipProgress(options: PersistentMpvPropertyOptions): Promise<void>;
  fireNearEofIfNeeded(positionSeconds: number): void;
  observeWatchdog(sample: LatestIpcSample): void;
};

export class PersistentMpvPropertyRouter {
  private subtitleId: number | undefined;
  private subtitleVisible: boolean | undefined;
  private subtitleFingerprint = "";

  constructor(private readonly deps: PersistentMpvPropertyRouterDeps) {}

  resetSubtitleObservation(): void {
    this.subtitleId = undefined;
    // Visibility is process-wide: mpv does not re-emit an unchanged value on loadfile.
    this.subtitleFingerprint = "";
  }

  private emitSubtitleObservation(): void {
    if (this.subtitleId === undefined || this.subtitleVisible === undefined) return;
    const tracks = this.deps.subtitleManager.currentTrackList();
    const track = Array.isArray(tracks)
      ? tracks.find(
          (value) =>
            isJsonObject(value) &&
            "id" in value &&
            value.id === this.subtitleId &&
            "type" in value &&
            value.type === "sub",
        )
      : undefined;
    let subtitleState: PlaybackSubtitleObservation = {
      id: this.subtitleId,
      visible: this.subtitleVisible,
    };
    if (this.subtitleId > 0 && isJsonString(track?.lang))
      subtitleState = { ...subtitleState, language: track.lang };
    if (this.subtitleId > 0 && isJsonString(track?.title))
      subtitleState = { ...subtitleState, title: track.title };
    const fingerprint = JSON.stringify(subtitleState);
    if (fingerprint === this.subtitleFingerprint) return;
    this.subtitleFingerprint = fingerprint;
    this.deps.getCurrentOptions().onPlaybackEvent?.({
      type: "track-changed",
      trackType: "sub",
      id: this.subtitleId,
      subtitleState,
    });
  }

  handlePropertyUpdate(message: { name: string; value: unknown; observedAt: number }): void {
    const { name, value, observedAt } = message;

    if (name === "user-data/kunai-request") {
      this.handleKunaiRequest(value);
      return;
    }

    if (name === "user-data/kunai-resume-choice") {
      const choice = typeof value === "string" ? value : "";
      if (choice === "resume" || choice === "start") {
        this.deps.finishResumeChoiceWait(choice);
      }
      return;
    }

    if (name === "user-data/kunai-track-changed") {
      this.handleTrackChanged(value);
      return;
    }

    if (name === "track-list") {
      this.deps.subtitleManager.updateTrackList(value);
    }

    const active = this.deps.getActiveCycle();
    if (!active) return;
    if (name === "sid") {
      if (isJsonNumber(value) && Number.isInteger(value) && value >= 0) this.subtitleId = value;
      else if (value === false || value === "no") this.subtitleId = 0;
      if (this.subtitleId !== undefined)
        this.deps.subtitleManager.noteSelectedSubtitle(this.subtitleId);
    } else if (name === "sub-visibility" && (value === true || value === false)) {
      this.subtitleVisible = value;
    }

    applyObservedPropertySample(
      active.stats,
      { name, value, observedAt },
      { acceptPlaybackProperties: active.acceptPlaybackProperties },
    );
    if (!active.acceptPlaybackProperties) return;
    this.emitSubtitleObservation();

    if (active.stats.latestIpcSample) {
      this.deps.observeWatchdog(active.stats.latestIpcSample);
    }

    if ((name === "time-pos" || name === "playback-time") && typeof value === "number") {
      const previousPositionSeconds = this.deps.getCurrentPositionSeconds();
      this.deps.setCurrentPositionSeconds(value);
      this.deps.maybeRearmSkippedSegmentsOnBackwardSeek(
        this.deps.getCurrentOptions(),
        previousPositionSeconds,
        value,
      );
      if (value > 0 && !active.playerStartedNotified) {
        active.playerStartedNotified = true;
        active.onPlaybackEvent?.({ type: "playback-started" });
      }
      this.deps.maybeEmitPlaybackProgress(active, observedAt);
      void this.deps.handleSegmentSkipProgress(this.deps.getCurrentOptions());
      this.deps.fireNearEofIfNeeded(value);
    }

    if (
      !active.playerReadyNotified &&
      (name === "filename" ||
        name === "media-title" ||
        (name === "playback-time" && typeof value === "number" && value >= 0))
    ) {
      active.playerReadyNotified = true;
      active.onPlaybackEvent?.({ type: "player-ready" });
      active.onPlayerReady?.();
    }

    if (name === "pause" && typeof value === "boolean") {
      active.onPlaybackEvent?.({ type: value ? "playback-paused" : "playback-resumed" });
    }
  }

  /** mpv's request vocabulary, mapped onto the action names the app uses. */
  private static readonly MPV_REQUEST_ACTIONS: Readonly<Record<string, MpvRequestedAction>> = {
    next: "next",
    previous: "previous",
    quality: "pick-quality",
    source: "pick-source",
    refresh: "refresh",
    "cycle-source": "cycle-source",
    "cycle-audio": "cycle-audio",
  };

  private handleKunaiRequest(value: unknown): void {
    const req = typeof value === "string" ? value : null;
    if (!req) return;

    const action = PersistentMpvPropertyRouter.MPV_REQUEST_ACTIONS[req];
    if (action) {
      this.deps.notifyMpvActionRequest(action);
    } else if (req === "resume-seek") {
      void this.deps.handleResumeSeekFromMpv();
    } else if (req === "copy-share") {
      void this.deps.handleCopyShareFromMpv();
    } else if (req === "skip" || req === "auto-skip") {
      void this.deps.onSkipRequestFromMpv(req === "auto-skip");
    } else {
      // Unrecognised request: leave the property alone rather than clearing it,
      // so an unhandled verb stays visible instead of vanishing silently.
      return;
    }

    // Every handled request clears the property so the next one is observed as a
    // change. This used to be repeated per branch, which is how a new verb could
    // be added without one.
    void this.deps.getIpcSession()?.send(["set_property", "user-data/kunai-request", ""], 500);
  }

  private handleTrackChanged(value: unknown): void {
    const v = typeof value === "string" ? value : "";
    // The bridge writes `<type>:<n>` where n is mpv's track id (0 = track off
    // for subs). The previous `parseInt(v.split(":")[1] ?? "0")` had no radix
    // and the `?? "0"` never fired for `"audio:"` (that splits to an empty
    // string, not undefined) — so a malformed value emitted `id: NaN` into the
    // user-facing "track switched (id NaN)" note.
    const trackMatch = /^(audio|sub):(\d+)$/.exec(v);
    if (trackMatch) {
      const id = Number.parseInt(trackMatch[2] ?? "", 10);
      if (id >= 0) {
        this.deps.getCurrentOptions().onPlaybackEvent?.({
          type: "track-changed",
          // SAFETY: the trackMatch regex alternation only captures "audio" or "sub".
          trackType: trackMatch[1] as "audio" | "sub",
          id,
        });
      }
    }
    void this.deps
      .getIpcSession()
      ?.send(["set_property", "user-data/kunai-track-changed", ""], 500);
  }
}
