import { setSessionLane, switchSessionMode } from "@/app/session/mode-switch";
import type { Container } from "@/container";

import { resolveHistorySelectionLaunch } from "./history-selection-launch";
import { defaultPaletteWorkflowPort, type PaletteWorkflowPort } from "./palette-workflow-port";
import { waitForRootHistorySelection } from "./root-history-bridge";
import {
  openDiagnosticsOverlay,
  openNotificationsOverlay,
  openRootOwnedOverlay,
} from "./root-overlay-bridge";
import {
  episodeInfoFromQueuePlaybackLaunch,
  titleInfoFromQueuePlaybackLaunch,
  waitForRootQueueSelection,
} from "./root-queue-bridge";
import type { ShellAction } from "./types";

export type PaletteCommandSurface = "browse" | "playback" | "overlay";

export type PaletteCommandResult =
  | "handled"
  | "quit"
  | "mode-switch"
  | "provider"
  | "back-to-search"
  | "back-to-results"
  | "toggle-autoplay"
  | "toggle-autoskip"
  | "stop-after-current"
  | "resume"
  | "next"
  | "previous"
  | "next-season"
  | "replay"
  | "recover"
  | "recompute"
  | "fallback"
  | "source"
  | "quality"
  | "audio"
  | "subtitle"
  | "memory"
  | "download"
  | "pick-episode"
  | "calendar"
  | "anime-calendar"
  | "series-calendar"
  | "random"
  | "unhandled"
  | {
      readonly type: "history-entry";
      readonly title: import("@/domain/types").TitleInfo;
      readonly episode?: import("@/domain/types").EpisodeInfo;
    };

/** Global workflow actions that must route through shell workflows from any surface. */
export const PALETTE_WORKFLOW_ACTIONS: ReadonlySet<ShellAction> = new Set([
  "setup",
  "update",
  "report-issue",
  "clear-cache",
  "reset-provider-health",
  "clear-history",
  "export-diagnostics",
  "docs",
  "telemetry",
  "telemetry-show",
  "sync",
  "sync-connect-anilist",
  "sync-connect-tmdb",
  "sync-disconnect",
  "stats",
  "menu",
  "download",
  "watchlist",
  "bookmark",
  "follow",
  "unfollow",
  "mute",
  "share",
  "mark-watched",
  "mark-unwatched",
  "mark-season-watched",
  "mark-up-to-episode",
  "playlist-add",
  "queue-season",
  "mark-anime",
  "mark-series",
]);

async function routeNotificationsInbox(container: Container): Promise<PaletteCommandResult> {
  if (!container.featureFlags.attentionInbox) {
    container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      note: "Attention inbox is disabled.",
    });
    return "handled";
  }
  const { playback } = await openNotificationsOverlay(container);
  if (playback) {
    return {
      type: "history-entry",
      title: playback.title,
      episode: playback.episode,
    };
  }
  return "handled";
}

async function openRootHistorySelection(
  container: Container,
  reason: "continue" | "history",
): Promise<PaletteCommandResult> {
  const selectionPromise = waitForRootHistorySelection();
  await openRootOwnedOverlay(
    container,
    reason === "continue"
      ? { type: "history", initialFilterMode: "watching" }
      : { type: "history", initialFilterMode: "all" },
  );
  const selection = await selectionPromise;
  if (!selection) return "handled";

  const launch = await resolveHistorySelectionLaunch(container, selection, reason);
  if (!launch) return "handled";
  return {
    type: "history-entry",
    title: launch.title,
    episode: launch.episode,
  };
}

async function openRootQueueSelection(container: Container): Promise<PaletteCommandResult> {
  const selectionPromise = waitForRootQueueSelection();
  await openRootOwnedOverlay(container, { type: "queue" });
  const selection = await selectionPromise;
  if (!selection) return "handled";
  // selection.intent is the beginPlayback return value — do not rebuild/reattach.
  return {
    type: "history-entry",
    title: titleInfoFromQueuePlaybackLaunch(selection),
    episode: episodeInfoFromQueuePlaybackLaunch(selection),
  };
}

/**
 * Shared palette / shell-action dispatcher. Surfaces pass playback-specific
 * actions through `playbackPassthrough`; everything else is handled once here.
 */
export async function dispatchPaletteCommand(
  _surface: PaletteCommandSurface,
  action: ShellAction,
  container: Container,
  playbackPassthrough?: (action: ShellAction) => PaletteCommandResult | null,
  workflows: PaletteWorkflowPort = defaultPaletteWorkflowPort,
): Promise<PaletteCommandResult> {
  const { stateManager } = container;

  if (action === "quit") {
    return workflows.resolveQuit(container);
  }
  if (action === "toggle-mode") {
    switchSessionMode(stateManager, container.providerRegistry);
    return "mode-switch";
  }
  if (action === "series-mode") {
    setSessionLane(stateManager, "series", container.providerRegistry);
    return "mode-switch";
  }
  if (action === "anime-mode") {
    setSessionLane(stateManager, "anime", container.providerRegistry);
    return "mode-switch";
  }
  if (action === "youtube-mode") {
    setSessionLane(stateManager, "youtube", container.providerRegistry);
    return "mode-switch";
  }
  if (action === "help") {
    await openRootOwnedOverlay(container, { type: "help" });
    return "handled";
  }
  if (action === "about") {
    await openRootOwnedOverlay(container, { type: "about" });
    return "handled";
  }
  if (action === "diagnostics") {
    await openDiagnosticsOverlay(container, "diagnostics-palette");
    return "handled";
  }
  if (action === "notifications") {
    return routeNotificationsInbox(container);
  }
  // Playback keeps /provider as the tracks-panel provider section; browse and
  // overlays use the Providers hub (session switch vs sticky defaults).
  if (action === "provider" && _surface === "playback") {
    return "provider";
  }
  if (action === "providers" || action === "provider") {
    return workflows.runAction("providers", container);
  }
  if (action === "up-next") return openRootQueueSelection(container);
  if (action === "playlists" || action === "playlist") {
    return workflows.runAction("playlists", container);
  }
  if (action === "continue") return openRootHistorySelection(container, "continue");
  if (action === "history") return openRootHistorySelection(container, "history");
  if (action === "settings" || action === "presence") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }
  if (action === "setup") {
    return workflows.runSetup(container);
  }

  const passthrough = playbackPassthrough?.(action);
  if (passthrough !== null && passthrough !== undefined) {
    return passthrough;
  }

  if (PALETTE_WORKFLOW_ACTIONS.has(action)) {
    const result = await workflows.runAction(action, container);
    return result === "quit" ? "quit" : result;
  }

  const result = await workflows.runAction(action, container);
  return result === "quit" ? "quit" : result;
}
