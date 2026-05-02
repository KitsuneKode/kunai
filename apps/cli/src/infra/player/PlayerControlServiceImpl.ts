import type { Logger } from "@/infra/logger/Logger";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type {
  ActivePlayerControl,
  PlaybackControlAction,
  PlayerControlService,
} from "./PlayerControlService";
import type { LateSubtitleAttachment } from "./PlayerService";

export class PlayerControlServiceImpl implements PlayerControlService {
  private active: ActivePlayerControl | null = null;
  private lastAction: PlaybackControlAction | null = null;
  private commandQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: {
      logger: Logger;
      diagnosticsStore: DiagnosticsStore;
    },
  ) {}

  setActive(control: ActivePlayerControl | null): void {
    this.active = control;
  }

  getActive(): ActivePlayerControl | null {
    return this.active;
  }

  consumeLastAction(): PlaybackControlAction | null {
    const action = this.lastAction;
    this.lastAction = null;
    return action;
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
      async () => await active.reloadSubtitles!(),
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

    const attached = await this.enqueueCommand(
      "attach-subtitles",
      reason,
      async () => await active.attachSubtitles!(attachment),
    );
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
    return await this.enqueueCommand(
      "skip-segment",
      reason,
      async () => await active.skipCurrentSegment!(),
    );
  }

  async nextCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "next";
    return this.stopWithAction("next", reason, true);
  }

  async previousCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "previous";
    return this.stopWithAction("previous", reason, true);
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
      await this.enqueueCommand(action, reason, async () => await active.stopCurrentFile!(reason));
      return true;
    }
    await this.enqueueCommand(action, reason, async () => await active.stop(reason));
    return true;
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
