import type { OverlayState, SessionState, StateTransition } from "@/domain/session/SessionState";

export type RootOwnedOverlay = Extract<
  OverlayState,
  {
    type:
      | "help"
      | "about"
      | "diagnostics"
      | "downloads"
      | "library"
      | "provider_picker"
      | "history"
      | "settings"
      | "season_picker"
      | "episode_picker"
      | "subtitle_picker"
      | "source_picker"
      | "quality_picker"
      | "recommendation_picker";
  }
>;

export type RootShellSurface =
  | "error"
  | "playback"
  | "root-content"
  | "root-overlay"
  | "mounted-screen"
  | "idle";

export function isRootOwnedOverlay(
  overlay: OverlayState | null | undefined,
): overlay is RootOwnedOverlay {
  return (
    overlay?.type === "help" ||
    overlay?.type === "about" ||
    overlay?.type === "diagnostics" ||
    overlay?.type === "downloads" ||
    overlay?.type === "library" ||
    overlay?.type === "provider_picker" ||
    overlay?.type === "history" ||
    overlay?.type === "settings" ||
    overlay?.type === "season_picker" ||
    overlay?.type === "episode_picker" ||
    overlay?.type === "subtitle_picker" ||
    overlay?.type === "source_picker" ||
    overlay?.type === "quality_picker" ||
    overlay?.type === "recommendation_picker"
  );
}

export function getTopOverlay(state: SessionState): OverlayState | null {
  return state.activeModals.at(-1) ?? null;
}

export function getRootOwnedOverlay(state: SessionState): RootOwnedOverlay | null {
  const overlay = getTopOverlay(state);
  return isRootOwnedOverlay(overlay) ? overlay : null;
}

export function resolveRootShellSurface(
  state: SessionState,
  {
    hasRootContent,
    hasMountedScreen,
  }: {
    hasRootContent: boolean;
    hasMountedScreen: boolean;
  },
): RootShellSurface {
  if (state.playbackStatus === "error") {
    return "error";
  }
  const rootOverlay = getRootOwnedOverlay(state);
  if (
    state.playbackStatus === "loading" ||
    state.playbackStatus === "ready" ||
    state.playbackStatus === "buffering" ||
    state.playbackStatus === "seeking" ||
    state.playbackStatus === "stalled" ||
    state.playbackStatus === "playing"
  ) {
    if (rootOverlay) {
      return "root-overlay";
    }
    return "playback";
  }
  if (hasRootContent) {
    return "root-content";
  }
  if (rootOverlay) {
    return "root-overlay";
  }
  if (hasMountedScreen) {
    return "mounted-screen";
  }
  return "idle";
}

export function resolveEscTransition(state: SessionState): StateTransition | null {
  if (state.commandBar.open) {
    return { type: "CLOSE_COMMAND_BAR" };
  }
  if (state.activeModals.length > 0) {
    return { type: "CLOSE_TOP_OVERLAY" };
  }
  return null;
}
