import type { PlaybackTimingMetadata } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";

import type {
  ActivePlayerControl,
  PlaybackControlAction,
  PlayerControlService,
} from "./PlayerControlService";
import type { LateSubtitleAttachment } from "./PlayerService";

type ActiveWait = {
  finish: (value: ActivePlayerControl | null) => void;
};

function episodeTransitionLoadingLabel(action: PlaybackControlAction): string | null {
  switch (action) {
    case "next":
      return "Kunai · Loading next episode…";
    case "previous":
      return "Kunai · Loading previous episode…";
    case "refresh":
      return "Kunai · Refreshing stream…";
    case "fallback":
      return "Kunai · Trying another source…";
    case "pick-source":
      return "Kunai · Select a source in the terminal…";
    case "pick-quality":
      return "Kunai · Select quality in the terminal…";
    default:
      return null;
  }
}

export class PlayerControlServiceImpl implements PlayerControlService {
  private active: ActivePlayerControl | null = null;
  private lastAction: PlaybackControlAction | null = null;
  private commandQueue: Promise<unknown> = Promise.resolve();
  private waitsForActive: ActiveWait[] = [];

  constructor(
    private readonly deps: {
      logger: Logger;
      diagnosticsStore: DiagnosticsStore;
    },
  ) {}

  setActive(control: ActivePlayerControl | null): void {
    this.active = control;
    if (control && this.waitsForActive.length) {
      const pending = this.waitsForActive.splice(0);
      for (const w of pending) w.finish(control);
    }
  }

  getActive(): ActivePlayerControl | null {
    return this.active;
  }

  waitForActivePlayer(options: {
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<ActivePlayerControl | null> {
    if (this.active) return Promise.resolve(this.active);
    if (options.signal?.aborted) return Promise.resolve(null);

    /* eslint-disable promise/no-multiple-resolved -- single-shot via `settled`; timer/abort/setActive are mutually exclusive */
    return new Promise((resolve) => {
      let settled = false;
      const wait: ActiveWait = { finish: () => {} };
      const finish = (value: ActivePlayerControl | null) => {
        if (settled) return;
        settled = true;
        const idx = this.waitsForActive.indexOf(wait);
        if (idx >= 0) this.waitsForActive.splice(idx, 1);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      wait.finish = finish;
      const onAbort = () => finish(null);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => finish(null), options.timeoutMs);
      this.waitsForActive.push(wait);
    });
    /* eslint-enable promise/no-multiple-resolved */
  }

  consumeLastAction(): PlaybackControlAction | null {
    const action = this.lastAction;
    this.lastAction = null;
    return action;
  }

  signalPlaybackAction(action: PlaybackControlAction): void {
    this.lastAction = action;
  }

  async stopCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "stop";
    return this.stopWithAction("stop", reason);
  }

  async refreshCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "refresh";
    return this.stopWithAction("refresh", reason, true);
  }

  async fallbackCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "fallback";
    return this.stopWithAction("fallback", reason, true);
  }

  async reloadCurrentSubtitles(reason = "user-requested"): Promise<boolean> {
    const active = this.active;
    if (!active) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Subtitle reload requested without active player",
        context: { reason },
      });
      return false;
    }

    if (!active.reloadSubtitles) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Subtitle reload unavailable for active player",
        context: { id: active.id, reason },
      });
      return false;
    }

    this.lastAction = "reload-subtitles";
    this.deps.logger.info("Reloading active playback subtitles", { id: active.id, reason });
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Reloading active playback subtitles",
      context: { id: active.id, reason },
    });
    await this.enqueueCommand(
      "reload-subtitles",
      reason,
      async () => await active.reloadSubtitles?.(),
    );
    return true;
  }

  async attachLateSubtitles(
    attachment: LateSubtitleAttachment,
    reason = "user-requested",
  ): Promise<boolean> {
    const active = this.active;
    if (!active) {
      this.deps.diagnosticsStore.record({
        category: "subtitle",
        message: "Late subtitle attach requested without active player",
        context: { reason, trackCount: attachment.subtitleTracks?.length ?? 0 },
      });
      return false;
    }

    if (!active.attachSubtitles) {
      this.deps.diagnosticsStore.record({
        category: "subtitle",
        message: "Late subtitle attach unavailable for active player",
        context: { id: active.id, reason, trackCount: attachment.subtitleTracks?.length ?? 0 },
      });
      return false;
    }

    const attachedRaw = await this.enqueueCommand(
      "attach-subtitles",
      reason,
      async () => await active.attachSubtitles?.(attachment),
    );
    const attached =
      typeof attachedRaw === "number" && Number.isFinite(attachedRaw) ? attachedRaw : 0;
    if (attached <= 0) return false;
    this.deps.logger.info("Attached late subtitles", { id: active.id, reason, attached });
    this.deps.diagnosticsStore.record({
      category: "subtitle",
      message: "Attached late subtitles",
      context: { id: active.id, reason, attached },
    });
    return attached > 0;
  }

  async skipCurrentSegment(reason = "user-requested"): Promise<boolean> {
    const active = this.active;
    if (!active) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Segment skip requested without active player",
        context: { reason },
      });
      return false;
    }

    if (!active.skipCurrentSegment) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Segment skip unavailable for active player",
        context: { id: active.id, reason },
      });
      return false;
    }

    this.deps.logger.info("Skipping active playback segment", { id: active.id, reason });
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Skipping active playback segment",
      context: { id: active.id, reason },
    });
    const skipped = await this.enqueueCommand(
      "skip-segment",
      reason,
      async () => await active.skipCurrentSegment?.(),
    );
    return Boolean(skipped);
  }

  async nextCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "next";
    return this.stopWithAction("next", reason, true);
  }

  async pickSourceCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "pick-source";
    return this.stopWithAction("pick-source", reason, true);
  }

  async pickQualityCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "pick-quality";
    return this.stopWithAction("pick-quality", reason, true);
  }

  async previousCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "previous";
    return this.stopWithAction("previous", reason, true);
  }

  updateCurrentPlaybackTiming(
    timing: PlaybackTimingMetadata | null,
    reason = "background-fetch",
  ): void {
    const active = this.active;
    if (!active?.updateTiming) return;
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Injecting late timing metadata into active player",
      context: { id: active.id, reason, hasCredits: Boolean((timing?.credits ?? []).length) },
    });
    active.updateTiming(timing);
  }

  private async stopWithAction(
    action: PlaybackControlAction,
    reason: string,
    stopCurrentFile = false,
  ): Promise<boolean> {
    const active = this.active;
    if (!active) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Playback control requested without active player",
        context: { action, reason },
      });
      return false;
    }

    this.deps.logger.info("Stopping active playback", { id: active.id, action, reason });
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Stopping active playback",
      context: { id: active.id, action, reason, stopCurrentFile },
    });
    if (stopCurrentFile && active.stopCurrentFile) {
      await this.runPriorityCommand(action, reason, async () => {
        const label = episodeTransitionLoadingLabel(action);
        if (label) {
          if (active.setEpisodeTransitionLoading) {
            await active.setEpisodeTransitionLoading(label);
          } else if (active.showOsdMessage) {
            await active.showOsdMessage(label, 120_000);
          }
        }
        await active.stopCurrentFile?.(reason);
      });
      return true;
    }
    await this.runPriorityCommand(action, reason, async () => await active.stop(reason));
    return true;
  }

  private async runPriorityCommand<T>(
    action: string,
    reason: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Playback priority command started",
      context: { action, reason },
    });
    try {
      const result = await run();
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Playback priority command completed",
        context: { action, reason, elapsedMs: Date.now() - startedAt },
      });
      return result;
    } catch (error) {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Playback priority command failed",
        context: { action, reason, error: String(error), elapsedMs: Date.now() - startedAt },
      });
      throw error;
    }
  }

  private enqueueCommand<T>(action: string, reason: string, run: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const next = this.commandQueue.then(async () => {
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "Playback control command started",
        context: { action, reason },
      });
      try {
        const result = await run();
        this.deps.diagnosticsStore.record({
          category: "playback",
          message: "Playback control command completed",
          context: { action, reason, elapsedMs: Date.now() - startedAt },
        });
        return result;
      } catch (error) {
        this.deps.diagnosticsStore.record({
          category: "playback",
          message: "Playback control command failed",
          context: { action, reason, error: String(error), elapsedMs: Date.now() - startedAt },
        });
        throw error;
      }
    });

    this.commandQueue = next.catch(() => {});
    return next;
  }
}
