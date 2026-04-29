import type { Logger } from "@/infra/logger/Logger";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type {
  ActivePlayerControl,
  PlaybackControlAction,
  PlayerControlService,
} from "./PlayerControlService";

export class PlayerControlServiceImpl implements PlayerControlService {
  private active: ActivePlayerControl | null = null;
  private lastAction: PlaybackControlAction | null = null;

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
    return this.stopWithAction("refresh", reason);
  }

  async fallbackCurrentPlayback(reason = "user-requested"): Promise<boolean> {
    this.lastAction = "fallback";
    return this.stopWithAction("fallback", reason);
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
    await active.reloadSubtitles();
    return true;
  }

  private async stopWithAction(action: PlaybackControlAction, reason: string): Promise<boolean> {
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
      context: { id: active.id, action, reason },
    });
    await active.stop(reason);
    return true;
  }
}
