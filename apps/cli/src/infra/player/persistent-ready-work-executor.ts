import type { PlaybackTimingMetadata, SubtitleTrack } from "@/domain/types";
import { collectAdditionalSubtitleTracks, shouldApplyStartAtSeek } from "@/mpv";

import type { MpvIpcSession } from "./mpv-ipc";
import { noteTrustedSeek, type PlayerTelemetryState } from "./mpv-telemetry";
import {
  resolvePersistentStartSeekTarget,
  type PersistentResumeStartChoice,
} from "./persistent-ready-work-policy";
import type { PersistentSubtitleManager } from "./persistent-subtitle-manager";
import type { PlayerPlaybackEvent } from "./PlayerService";

export type PersistentReadyWorkOptions = {
  displayTitle: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  resumePromptAt?: number;
  offerResumeStartChoice?: boolean;
  resumeChoiceTimeLabel?: string;
  timing?: PlaybackTimingMetadata | null;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export type PersistentReadyWorkCycle = {
  telemetry: PlayerTelemetryState;
  playerReadyNotified: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export type PersistentReadyWorkExecutorDeps = {
  getIpcSession(): MpvIpcSession | null;
  getInitialOptions(): PersistentReadyWorkOptions;
  getLoadStartAt(): number | null;
  getTitleAppliedViaArgs(): boolean;
  setTitleAppliedViaArgs(value: boolean): void;
  getSubtitlesAttachedAtSpawn(): boolean;
  setSubtitlesAttachedAtSpawn(value: boolean): void;
  setCurrentPositionSeconds(value: number): void;
  setResumeSeekPending(value: boolean): void;
  waitResumeOrStartOverChoice(
    seconds: number,
    displayTitle: string,
    timeLabel: string | undefined,
  ): Promise<PersistentResumeStartChoice>;
  handleSegmentSkipProgress(options: PersistentReadyWorkOptions): Promise<void>;
  onIpcCommandFailure?(command: string, error: string): void;
  subtitleManager: PersistentSubtitleManager;
};

export class PersistentReadyWorkExecutor {
  constructor(private readonly deps: PersistentReadyWorkExecutorDeps) {}

  async execute(
    options: PersistentReadyWorkOptions,
    cycle: PersistentReadyWorkCycle | null,
  ): Promise<void> {
    if (!cycle) return;

    if (!cycle.playerReadyNotified) {
      cycle.playerReadyNotified = true;
      cycle.onPlaybackEvent?.({ type: "player-ready" });
      cycle.onPlayerReady?.();
    }

    const ipcSession = this.deps.getIpcSession();
    if (!ipcSession) return;

    this.deps.setResumeSeekPending(
      shouldApplyStartAtSeek(options.startAt) || shouldApplyStartAtSeek(options.resumePromptAt),
    );
    try {
      const unpauseResult = await ipcSession.send(["set_property", "pause", false], 500);
      if (!unpauseResult.ok) {
        this.deps.onIpcCommandFailure?.("unpause", unpauseResult.error);
      }

      const initialOptions = this.deps.getInitialOptions();
      if (
        !this.deps.getTitleAppliedViaArgs() ||
        options.displayTitle !== initialOptions.displayTitle
      ) {
        const titleResult = await ipcSession.send(
          ["set_property", "force-media-title", options.displayTitle],
          1_000,
        );
        if (!titleResult.ok) {
          this.deps.onIpcCommandFailure?.("set-title", titleResult.error);
        }
      }
      this.deps.setTitleAppliedViaArgs(false);

      let choice: PersistentResumeStartChoice | undefined;
      const resumePromptAt = options.resumePromptAt ?? 0;
      if (options.offerResumeStartChoice && shouldApplyStartAtSeek(resumePromptAt)) {
        choice = await this.deps.waitResumeOrStartOverChoice(
          resumePromptAt,
          options.displayTitle,
          options.resumeChoiceTimeLabel,
        );
      }

      const seekTarget = resolvePersistentStartSeekTarget(options, choice);
      if (shouldApplyStartAtSeek(seekTarget) && seekTarget !== undefined) {
        const target = seekTarget;
        options.onPlaybackEvent?.({ type: "resolving-playback" });
        if (this.deps.getLoadStartAt() !== null && target === this.deps.getLoadStartAt()) {
          this.deps.setCurrentPositionSeconds(target);
          noteTrustedSeek(cycle.telemetry, target);
        } else {
          const seekResult = await ipcSession.send(["seek", target, "absolute"], 2_000);
          if (seekResult.ok) {
            this.deps.setCurrentPositionSeconds(target);
            noteTrustedSeek(cycle.telemetry, target);
          }
        }
      }
    } finally {
      this.deps.setResumeSeekPending(false);
    }

    const initialOptions = this.deps.getInitialOptions();
    if (
      this.deps.getSubtitlesAttachedAtSpawn() &&
      options.primarySubtitle &&
      options.primarySubtitle === initialOptions.primarySubtitle
    ) {
      const additionalCount = options.subtitleTracks
        ? collectAdditionalSubtitleTracks(options.primarySubtitle, options.subtitleTracks).length
        : 0;
      const trackCount = 1 + additionalCount;
      options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
      options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
    } else {
      await this.deps.subtitleManager.replaceSubtitleInventory(
        ipcSession,
        options.primarySubtitle,
        options.subtitleTracks,
        (trackCount) => {
          options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
          options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
        },
      );
    }
    this.deps.setSubtitlesAttachedAtSpawn(false);
    await this.deps.handleSegmentSkipProgress(options);
  }
}
