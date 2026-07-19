import type { ShellAction } from "./types";

export type ActivePlaybackStreamPickerAction =
  | "source"
  | "quality"
  | "audio"
  | "subtitle"
  | "provider";

type PlaybackSessionToggleEvent =
  | { readonly type: "SET_SESSION_AUTOPLAY_PAUSED"; readonly paused: boolean }
  | { readonly type: "SET_SESSION_AUTOSKIP_PAUSED"; readonly paused: boolean }
  | { readonly type: "SET_SESSION_STOP_AFTER_CURRENT"; readonly enabled: boolean };

type PlaybackSessionToggleState = {
  readonly autoplaySessionPaused: boolean;
  readonly autoskipSessionPaused: boolean;
  readonly stopAfterCurrent: boolean;
};

export type ActivePlaybackCommandDispatchDeps = {
  readonly playerControl: {
    readonly nextCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly previousCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly returnToSearchFromPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly recoverCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly recomputeCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly fallbackCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly switchEpisodePlaybackSource: (
      kind: "local" | "online",
      reason: string,
    ) => Promise<unknown> | unknown;
    readonly stopCurrentPlayback: (reason: string) => Promise<unknown> | unknown;
    readonly updateCurrentPlaybackAutoSkipEnabled?: (enabled: boolean, reason: string) => void;
  };
  readonly workControl: {
    readonly cancelActive: (reason: string) => boolean;
  };
  readonly stateManager: {
    readonly getState: () => PlaybackSessionToggleState;
    readonly dispatch: (event: PlaybackSessionToggleEvent) => void;
  };
  readonly openStreamSelectionPicker: (
    deps: ActivePlaybackCommandDispatchDeps,
    action: ActivePlaybackStreamPickerAction,
    reason: string,
  ) => Promise<unknown> | unknown;
  readonly openEpisodePicker: (
    deps: ActivePlaybackCommandDispatchDeps,
    reason: string,
  ) => Promise<unknown> | unknown;
  readonly enqueueCurrentPlaybackDownload: (
    deps: ActivePlaybackCommandDispatchDeps,
    reason: string,
  ) => Promise<unknown> | unknown;
  readonly switchSessionMode: (
    stateManager: ActivePlaybackCommandDispatchDeps["stateManager"],
  ) => void;
  readonly setSessionLane: (
    stateManager: ActivePlaybackCommandDispatchDeps["stateManager"],
    mode: "series" | "anime" | "youtube",
  ) => void;
  readonly routeSearchShellAction: (
    action: ShellAction,
    deps: ActivePlaybackCommandDispatchDeps,
  ) => Promise<unknown>;
  readonly setExiting: (value: boolean) => void;
};

export type ActivePlaybackCommandDispatchInput = {
  readonly deps: ActivePlaybackCommandDispatchDeps;
  readonly canGoNext: boolean;
  readonly canGoPrevious: boolean;
  readonly canToggleAutoplay: boolean;
};

export type ActivePlaybackCommandDispatchResult = "handled" | "ignored";

export async function dispatchActivePlaybackCommand(
  action: ShellAction,
  input: ActivePlaybackCommandDispatchInput,
): Promise<ActivePlaybackCommandDispatchResult> {
  const { deps, canGoNext, canGoPrevious, canToggleAutoplay } = input;

  if (action === "command-mode") return "ignored";
  if (action === "next") {
    if (!canGoNext) return "ignored";
    await deps.playerControl.nextCurrentPlayback("playback-loading-command-next");
    return "handled";
  }
  if (action === "previous") {
    if (!canGoPrevious) return "ignored";
    await deps.playerControl.previousCurrentPlayback("playback-loading-command-previous");
    return "handled";
  }
  if (action === "toggle-autoplay") {
    if (!canToggleAutoplay) return "ignored";
    deps.stateManager.dispatch({
      type: "SET_SESSION_AUTOPLAY_PAUSED",
      paused: !deps.stateManager.getState().autoplaySessionPaused,
    });
    return "handled";
  }
  if (action === "toggle-autoskip") {
    const paused = !deps.stateManager.getState().autoskipSessionPaused;
    deps.stateManager.dispatch({
      type: "SET_SESSION_AUTOSKIP_PAUSED",
      paused,
    });
    deps.playerControl.updateCurrentPlaybackAutoSkipEnabled?.(
      !paused,
      "playback-loading-command-autoskip",
    );
    return "handled";
  }
  if (action === "stop-after-current") {
    deps.stateManager.dispatch({
      type: "SET_SESSION_STOP_AFTER_CURRENT",
      enabled: !deps.stateManager.getState().stopAfterCurrent,
    });
    return "handled";
  }
  if (action === "search" || action === "back-to-search") {
    // Bootstrap may have no active player yet — abort resolve first, then ask
    // player control (no-op without a player) so search still exits resolve cleanly.
    deps.workControl.cancelActive("playback-loading-command-search");
    await deps.playerControl.returnToSearchFromPlayback("playback-loading-command-search");
    return "handled";
  }
  if (action === "recover") {
    await deps.playerControl.recoverCurrentPlayback("playback-loading-command-recover");
    return "handled";
  }
  if (action === "recompute") {
    await deps.playerControl.recomputeCurrentPlayback("playback-loading-command-recompute");
    return "handled";
  }
  if (action === "fallback") {
    const cancelledWork = deps.workControl.cancelActive("playback-loading-command-fallback");
    if (!cancelledWork) {
      await deps.playerControl.fallbackCurrentPlayback("playback-loading-command-fallback");
    }
    return "handled";
  }
  if (action === "play-local") {
    await deps.playerControl.switchEpisodePlaybackSource(
      "local",
      "playback-loading-command-play-local",
    );
    return "handled";
  }
  if (action === "watch-online") {
    await deps.playerControl.switchEpisodePlaybackSource(
      "online",
      "playback-loading-command-watch-online",
    );
    return "handled";
  }
  if (
    action === "audio" ||
    action === "subtitle" ||
    action === "provider" ||
    action === "source" ||
    action === "quality"
  ) {
    await deps.openStreamSelectionPicker(deps, action, `playback-loading-command-${action}`);
    return "handled";
  }
  if (action === "pick-episode") {
    await deps.openEpisodePicker(deps, "playback-loading-command-episode");
    return "handled";
  }
  if (action === "download") {
    await deps.enqueueCurrentPlaybackDownload(deps, "active-playback-command");
    return "handled";
  }
  if (action === "quit") {
    // During resolve, workControl owns the AbortController and stop has no player.
    // During play, work may still be registered with a resolve-only cancel hook —
    // always stop the player too so quit never becomes a no-op.
    deps.workControl.cancelActive("playback-loading-command-stop");
    await deps.playerControl.stopCurrentPlayback("playback-loading-command-stop");
    return "handled";
  }
  if (action === "toggle-mode") {
    deps.switchSessionMode(deps.stateManager);
    return "handled";
  }
  if (action === "series-mode") {
    deps.setSessionLane(deps.stateManager, "series");
    return "handled";
  }
  if (action === "anime-mode") {
    deps.setSessionLane(deps.stateManager, "anime");
    return "handled";
  }
  if (action === "youtube-mode") {
    deps.setSessionLane(deps.stateManager, "youtube");
    return "handled";
  }

  const routed = await deps.routeSearchShellAction(action, deps);
  if (routed === "quit") {
    deps.setExiting(true);
  }
  return "handled";
}
