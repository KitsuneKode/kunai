import type { OverlayState, SessionState, StateTransition } from "@/domain/session/SessionState";

import type { KeyScope } from "./keybindings";

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
      | "queue"
      | "notifications"
      | "settings"
      | "season_picker"
      | "episode_picker"
      | "subtitle_picker"
      | "recommendation_picker"
      | "tracks_panel";
  }
>;

export type RootShellSurface =
  | "error"
  | "playback"
  | "root-content"
  | "root-overlay"
  | "mounted-screen"
  | "idle";

function isRootOwnedOverlay(overlay: OverlayState | null | undefined): overlay is RootOwnedOverlay {
  return (
    overlay?.type === "help" ||
    overlay?.type === "about" ||
    overlay?.type === "diagnostics" ||
    overlay?.type === "downloads" ||
    overlay?.type === "library" ||
    overlay?.type === "provider_picker" ||
    overlay?.type === "history" ||
    overlay?.type === "queue" ||
    overlay?.type === "notifications" ||
    overlay?.type === "settings" ||
    overlay?.type === "season_picker" ||
    overlay?.type === "episode_picker" ||
    overlay?.type === "subtitle_picker" ||
    overlay?.type === "recommendation_picker" ||
    overlay?.type === "tracks_panel"
  );
}

function getTopOverlay(state: SessionState): OverlayState | null {
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
  // Any root-owned overlay (tracks, season/episode/provider pickers, settings,
  // history, queue, help, …) opened while a root-content session (browse /
  // post-play / picker) is mounted must take over the whole terminal. The old
  // code only promoted `tracks_panel`; every other overlay fell through to
  // "root-content", which renders the mounted session and silently drops the
  // overlay — so post-play submenus, the browse `m` menu, provider switching,
  // and cache-purge dialogs all looked broken (they were just hidden underneath).
  if (hasRootContent && rootOverlay) {
    return "root-overlay";
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

/**
 * Keybinding scope the `?` help overlay should document, derived from what the
 * user is actually doing beneath the overlay. Help is pushed on top of the live
 * surface, so we read playback truth rather than the (now "root-overlay")
 * RootShellSurface: active playback → player, just-finished → postPlayback,
 * otherwise the browse surface. Globals are folded in by `bindingsForScope`.
 */
export function resolveHelpScope(state: SessionState): KeyScope {
  switch (state.playbackStatus) {
    case "loading":
    case "ready":
    case "buffering":
    case "seeking":
    case "stalled":
    case "playing":
    case "paused":
      return "player";
    case "finished":
      return "postPlayback";
    default:
      return "browse";
  }
}

export function resolveEscTransition(state: SessionState): StateTransition | null {
  if (state.activeModals.length > 0) {
    return { type: "CLOSE_TOP_OVERLAY" };
  }
  return null;
}
