import type { PlaybackTimingMetadata, SubtitleTrack } from "@/domain/types";

import type { MpvIpcSession } from "./mpv-ipc";
import { applyObservedPropertySample, type PlayerTelemetryState } from "./mpv-telemetry";
import type { PersistentSubtitleManager } from "./persistent-subtitle-manager";
import type { PlayerPlaybackEvent } from "./PlayerService";

type LatestIpcSample = NonNullable<PlayerTelemetryState["latestIpcSample"]>;

export type PersistentMpvPropertyCycle = {
  telemetry: PlayerTelemetryState;
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
  notifyMpvActionRequest(action: "next" | "previous" | "pick-quality" | "refresh"): void;
  finishResumeChoiceWait(choice: "resume" | "start"): void;
  handleResumeSeekFromMpv(): Promise<void>;
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
  constructor(private readonly deps: PersistentMpvPropertyRouterDeps) {}

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

    applyObservedPropertySample(
      active.telemetry,
      { name, value, observedAt },
      { acceptPlaybackProperties: active.acceptPlaybackProperties },
    );
    if (!active.acceptPlaybackProperties) return;

    if (active.telemetry.latestIpcSample) {
      this.deps.observeWatchdog(active.telemetry.latestIpcSample);
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

  private handleKunaiRequest(value: unknown): void {
    const req = typeof value === "string" ? value : null;
    if (req === "next" || req === "previous" || req === "quality" || req === "refresh") {
      this.deps.notifyMpvActionRequest(
        req === "quality" ? "pick-quality" : req === "refresh" ? "refresh" : req,
      );
      void this.deps.getIpcSession()?.send(["set_property", "user-data/kunai-request", ""], 500);
    } else if (req === "resume-seek") {
      void this.deps.handleResumeSeekFromMpv();
      void this.deps.getIpcSession()?.send(["set_property", "user-data/kunai-request", ""], 500);
    } else if (req === "skip" || req === "auto-skip") {
      void this.deps.onSkipRequestFromMpv(req === "auto-skip");
      void this.deps.getIpcSession()?.send(["set_property", "user-data/kunai-request", ""], 500);
    }
  }

  private handleTrackChanged(value: unknown): void {
    const v = typeof value === "string" ? value : "";
    if (v.startsWith("audio:")) {
      this.deps.getCurrentOptions().onPlaybackEvent?.({
        type: "track-changed",
        trackType: "audio",
        id: parseInt(v.split(":")[1] ?? "0"),
      });
    } else if (v.startsWith("sub:")) {
      this.deps.getCurrentOptions().onPlaybackEvent?.({
        type: "track-changed",
        trackType: "sub",
        id: parseInt(v.split(":")[1] ?? "0"),
      });
    }
    void this.deps
      .getIpcSession()
      ?.send(["set_property", "user-data/kunai-track-changed", ""], 500);
  }
}
