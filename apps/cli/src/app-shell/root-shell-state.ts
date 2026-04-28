import type { OverlayState, SessionState, StateTransition } from "@/domain/session/SessionState";

export type RootOwnedOverlay = Extract<OverlayState, { type: "help" | "about" | "diagnostics" }>;

export type RootShellSurface = "error" | "playback" | "root-overlay" | "mounted-screen" | "idle";

export function isRootOwnedOverlay(
  overlay: OverlayState | null | undefined,
): overlay is RootOwnedOverlay {
  return overlay?.type === "help" || overlay?.type === "about" || overlay?.type === "diagnostics";
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
  hasMountedScreen: boolean,
): RootShellSurface {
  if (state.playbackStatus === "error") {
    return "error";
  }
  if (state.playbackStatus === "loading" || state.playbackStatus === "playing") {
    return "playback";
  }
  if (getRootOwnedOverlay(state)) {
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
