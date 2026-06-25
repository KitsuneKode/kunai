import {
  episodeFromHistorySelection,
  recordLocalHistorySourceDecision,
} from "@/app/bootstrap/launch-entry";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import { switchSessionMode } from "@/app/session/mode-switch";
import type { Container } from "@/container";
import { historyContentType } from "@/services/continuation/history-progress";

import { waitForRootHistorySelection } from "./root-history-bridge";
import { openNotificationsOverlay, openRootOwnedOverlay } from "./root-overlay-bridge";
import { waitForRootQueueSelection } from "./root-queue-bridge";
import type { ShellAction } from "./types";
import { handleShellAction, resolveQuitWithDownloadQueue } from "./workflows";
import { openSetupWizardFromShell } from "./workflows/setup-workflows";

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
  "mute",
  "share",
  "mark-watched",
  "playlist-add",
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

async function routeSetupWizard(container: Container): Promise<PaletteCommandResult> {
  await openSetupWizardFromShell(container, { force: true, closeOverlays: true });
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
    stateManager.dispatch({
      type: "SET_MODE",
      mode: providerMetadata.metadata.isAnimeProvider ? "anime" : "series",
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
): Promise<PaletteCommandResult> {
  const { stateManager } = container;

  if (action === "quit") {
    return (await resolveQuitWithDownloadQueue(container)) === "quit" ? "quit" : "handled";
  }
  if (action === "toggle-mode") {
    switchSessionMode(stateManager);
    if (_surface === "browse") {
      stateManager.dispatch({ type: "RESET_SEARCH" });
      stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
    }
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
    await openRootOwnedOverlay(container, { type: "diagnostics" });
    return "handled";
  }
  if (action === "notifications") {
    return routeNotificationsInbox(container);
  }
  if (action === "provider") return "provider";
  if (action === "playlist") return openRootQueueSelection(container);
  if (action === "continue") return openRootHistorySelection(container, "continue");
  if (action === "history") return openRootHistorySelection(container, "history");
  if (action === "settings" || action === "presence") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }
  if (action === "setup") {
    return routeSetupWizard(container);
  }

  const passthrough = playbackPassthrough?.(action);
  if (passthrough !== null && passthrough !== undefined) {
    return passthrough;
  }

  if (PALETTE_WORKFLOW_ACTIONS.has(action)) {
    const result = await handleShellAction({ action, container });
    return result === "quit" ? "quit" : result;
  }

  const result = await handleShellAction({ action, container });
  return result === "quit" ? "quit" : result;
}
