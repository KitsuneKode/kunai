// =============================================================================
// resolve-header-destination.ts — AppHeader destination pill
//
// Root overlays and mounted full-screen flows own the pill. Browse destination
// (Trending / Search / …) only wins when browse is the visible surface.
// =============================================================================

import type { SessionState } from "@/domain/session/SessionState";

import type { BrowseDestinationLabel } from "./browse-destination";
import type { RootContentSession } from "./root-content-state";
import { getRootOverlayTitle } from "./root-overlay-model";
import type { RootOwnedOverlay } from "./root-shell-state";

export function resolveHeaderDestination(input: {
  readonly state: Pick<SessionState, "playbackStatus" | "view" | "currentTitle">;
  readonly rootOverlay: RootOwnedOverlay | null;
  readonly rootContent: RootContentSession | null;
  readonly browseDestinationLabel: BrowseDestinationLabel;
  readonly playbackActive: boolean;
}): string {
  const { state, rootOverlay, rootContent, browseDestinationLabel, playbackActive } = input;

  if (rootOverlay) {
    return getRootOverlayTitle(rootOverlay, state as SessionState);
  }

  if (state.playbackStatus === "loading" || playbackActive) {
    return "Now Playing";
  }

  if (rootContent?.headerLabel?.trim()) {
    return rootContent.headerLabel.trim();
  }

  if (rootContent?.kind === "browse") {
    return browseDestinationLabel;
  }

  if (rootContent?.kind === "post-playback") {
    return "Up Next";
  }

  if (rootContent?.kind === "playback" || rootContent?.kind === "loading") {
    return "Now Playing";
  }

  if (rootContent?.kind === "picker") {
    return "Picker";
  }

  // Legacy SessionState.view values while browse root content is absent.
  if (state.view === "home" || state.view === "search" || state.view === "results") {
    return browseDestinationLabel;
  }

  return state.view.charAt(0).toUpperCase() + state.view.slice(1);
}
