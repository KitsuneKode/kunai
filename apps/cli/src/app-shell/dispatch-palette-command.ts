import {
  episodeFromHistorySelection,
  recordLocalHistorySourceDecision,
} from "@/app/bootstrap/launch-entry";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import { setSessionLane, switchSessionMode } from "@/app/session/mode-switch";
import type { Container } from "@/container";
import { resolveProviderLaneFromMetadata } from "@/domain/provider-lane";
import { historyContentType } from "@/services/continuation/history-progress";

import { defaultPaletteWorkflowPort, type PaletteWorkflowPort } from "./palette-workflow-port";
import { waitForRootHistorySelection } from "./root-history-bridge";
import {
  openDiagnosticsOverlay,
  openNotificationsOverlay,
  openRootOwnedOverlay,
} from "./root-overlay-bridge";
import { waitForRootQueueSelection } from "./root-queue-bridge";
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
  const { stateManager } = container;
  const selectionPromise = waitForRootHistorySelection();
  await openRootOwnedOverlay(
    container,
    reason === "continue"
      ? { type: "history", initialFilterMode: "watching" }
      : { type: "history", initialFilterMode: "all" },
  );
  const selection = await selectionPromise;
  if (!selection) return "handled";
  if (selection.localJobId) {
    const result = await requestUnifiedOfflinePlayback(container, selection.localJobId);
    if (!result) return "handled";
    return {
      type: "history-entry",
      title: result.launch.title,
      episode: result.launch.episode,
    };
  }
  const providerMetadata = container.providerRegistry.get(selection.entry.providerId ?? "unknown");
  if (providerMetadata) {
    const lane = resolveProviderLaneFromMetadata(providerMetadata.metadata);
    stateManager.dispatch({
      type: "SET_MODE",
      mode: lane,
      provider: providerMetadata.metadata.id,
    });
  } else {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: selection.entry.providerId ?? "unknown",
    });
  }
  await recordLocalHistorySourceDecision(container, selection, reason);
  return {
    type: "history-entry",
    title: {
      id: selection.titleId,
      type: historyContentType(selection.entry),
      name: selection.entry.title,
      launchSource: reason === "history" ? "history" : "continue",
    },
    episode: episodeFromHistorySelection(selection),
  };
}

async function openRootQueueSelection(container: Container): Promise<PaletteCommandResult> {
  const selectionPromise = waitForRootQueueSelection();
  await openRootOwnedOverlay(container, { type: "queue" });
  const selection = await selectionPromise;
  if (!selection) return "handled";
  return {
    type: "history-entry",
    title: {
      id: selection.titleId,
      type: selection.mediaKind === "movie" ? "movie" : "series",
      name: selection.title,
    },
    episode:
      selection.season !== undefined && selection.episode !== undefined
        ? { season: selection.season, episode: selection.episode }
        : undefined,
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
  if (action === "provider") return "provider";
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
  if (action === "providers") {
    await openRootOwnedOverlay(container, {
      type: "settings",
      initialSectionId: "section:providers",
    });
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
