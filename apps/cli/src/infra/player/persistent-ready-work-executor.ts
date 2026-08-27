import type { PlaybackGeneration } from "@/domain/playback/playback-generation";
import type { PlaybackTimingMetadata, SubtitleTrack } from "@/domain/types";
import type { MpvUrlKind } from "@/infra/player/mpv-playback-url";
import { collectAdditionalSubtitleTracks, shouldApplyStartAtSeek } from "@/mpv";

import type { MpvIpcSession } from "./mpv-ipc";
import { noteTrustedSeek, type PlayerStatsState } from "./mpv-stats";
import {
  resolvePersistentStartSeekTarget,
  type PersistentResumeStartChoice,
} from "./persistent-ready-work-policy";
import type { PersistentSubtitleManager } from "./persistent-subtitle-manager";
import type { PlayerPlaybackEvent } from "./PlayerService";

export type PersistentReadyWorkOptions = {
  displayTitle: string;
  primarySubtitle: string | null;
  subtitleUrlKind?: MpvUrlKind;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  resumePromptAt?: number;
  offerResumeStartChoice?: boolean;
  resumeChoiceTimeLabel?: string;
  timing?: PlaybackTimingMetadata | null;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export type PersistentReadyWorkCycle = {
  stats: PlayerStatsState;
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
  /**
   * Whether the file currently loaded is an active broadcast.
   *
   * The caller already drops `startAt` and `resumePromptAt` for a live stream, but
   * that left one call site as the only thing standing between a live broadcast and
   * an absolute seek — the same single-point fragility that let the in-process
   * reconnect seek survive the first fix. Checking here makes every caller safe.
   */
  isLiveStream(): boolean;
  onIpcCommandFailure?(command: string, error: string): void;
  subtitleManager: PersistentSubtitleManager;
  /** False once a replacement cycle has taken over the generation this work belongs to. */
  isGenerationCurrent(generation: PlaybackGeneration): boolean;
};

export class PersistentReadyWorkExecutor {
  constructor(private readonly deps: PersistentReadyWorkExecutorDeps) {}

  /**
   * Ready work is a chain of awaited IPC commands. A replacement can land at any
   * boundary, so the generation is passed in explicitly — never read from
   * mutable current state — and rechecked before every mutation and command.
   */
  async execute(
    options: PersistentReadyWorkOptions,
    cycle: PersistentReadyWorkCycle | null,
    generation: PlaybackGeneration,
  ): Promise<void> {
    if (!cycle) return;
    const isCurrent = () => this.deps.isGenerationCurrent(generation);
    if (!isCurrent()) return;

    if (!cycle.playerReadyNotified) {
      cycle.playerReadyNotified = true;
      cycle.onPlaybackEvent?.({ type: "player-ready" });
      cycle.onPlayerReady?.();
    }

    const ipcSession = this.deps.getIpcSession();
    if (!ipcSession) return;

    // A live broadcast has no absolute position to return to: the prompt is
    // meaningless and the seek lands in the DVR window or fails outright.
    const live = this.deps.isLiveStream();
    this.deps.setResumeSeekPending(
      !live &&
        (shouldApplyStartAtSeek(options.startAt) || shouldApplyStartAtSeek(options.resumePromptAt)),
    );
    try {
      const unpauseResult = await ipcSession.send(["set_property", "pause", false], 500);
      if (!isCurrent()) return;
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
        if (!isCurrent()) return;
        if (!titleResult.ok) {
          this.deps.onIpcCommandFailure?.("set-title", titleResult.error);
        }
      }
      this.deps.setTitleAppliedViaArgs(false);

      let choice: PersistentResumeStartChoice | undefined;
      const resumePromptAt = options.resumePromptAt ?? 0;
      if (!live && options.offerResumeStartChoice && shouldApplyStartAtSeek(resumePromptAt)) {
        choice = await this.deps.waitResumeOrStartOverChoice(
          resumePromptAt,
          options.displayTitle,
          options.resumeChoiceTimeLabel,
        );
        if (!isCurrent()) return;
      }

      const seekTarget = live ? undefined : resolvePersistentStartSeekTarget(options, choice);
      if (shouldApplyStartAtSeek(seekTarget) && seekTarget !== undefined) {
        const target = seekTarget;
        options.onPlaybackEvent?.({ type: "resolving-playback" });
        if (this.deps.getLoadStartAt() !== null && target === this.deps.getLoadStartAt()) {
          this.deps.setCurrentPositionSeconds(target);
          noteTrustedSeek(cycle.stats, target);
        } else {
          const seekResult = await ipcSession.send(["seek", target, "absolute"], 2_000);
          if (!isCurrent()) return;
          if (seekResult.ok) {
            this.deps.setCurrentPositionSeconds(target);
            noteTrustedSeek(cycle.stats, target);
          }
        }
      }
    } finally {
      if (isCurrent()) this.deps.setResumeSeekPending(false);
    }

    if (!isCurrent()) return;
    const initialOptions = this.deps.getInitialOptions();
    if (
      this.deps.getSubtitlesAttachedAtSpawn() &&
      options.primarySubtitle &&
      options.primarySubtitle === initialOptions.primarySubtitle &&
      collectAdditionalSubtitleTracks(options.primarySubtitle, options.subtitleTracks).length === 0
    ) {
      options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount: 1 });
      options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount: 1 });
    } else {
      await this.deps.subtitleManager.replaceSubtitleInventory(
        ipcSession,
        options.primarySubtitle,
        options.subtitleTracks,
        (trackCount) => {
          options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
          options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
        },
        options.subtitleUrlKind,
        isCurrent,
      );
    }
    if (!isCurrent()) return;
    this.deps.setSubtitlesAttachedAtSpawn(false);
    await this.deps.handleSegmentSkipProgress(options);
  }
}
