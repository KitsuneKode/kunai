import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import { episodeFromHistorySelection, recordLocalHistorySourceDecision } from "@/app/launch-entry";
import { switchSessionMode } from "@/app/mode-switch";
import { playCompletedDownload } from "@/app/offline-playback";
import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";
import { historyContentType } from "@/services/continuation/history-progress";

import { resolveCommandContext, resolveCommands, type ResolvedAppCommand } from "./commands";
import { waitForRootHistorySelection } from "./root-history-bridge";
import { openNotificationsOverlay, openRootOwnedOverlay } from "./root-overlay-bridge";
import type { ShellAction } from "./types";
import { handleShellAction, resolveQuitWithDownloadQueue } from "./workflows";

export type CommandPaletteSurface = "browse" | "playback" | "list" | "post-play";

export function resolveCommandsForPaletteSurface(
  state: SessionState,
  surface: CommandPaletteSurface,
): readonly ResolvedAppCommand[] {
  switch (surface) {
    case "browse":
      return resolveCommands(state, SEARCH_BROWSE_COMMAND_IDS);
    case "playback":
      return resolveCommandContext(state, "activePlayback");
    case "post-play":
      return resolveCommandContext(state, "postPlayback");
    case "list":
      return resolveCommandContext(state, "rootOverlay");
    default:
      return resolveCommands(state, SEARCH_BROWSE_COMMAND_IDS);
  }
}

type RoutedActionResult =
  | "handled"
  | "quit"
  | "mode-switch"
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
  | "provider"
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
  | { type: "history-entry"; title: TitleInfo; episode?: EpisodeInfo }
  | "unhandled";

async function openRootHistorySelection(
  container: Container,
  reason: "continue" | "history",
): Promise<RoutedActionResult> {
  const { stateManager } = container;
  const selectionPromise = waitForRootHistorySelection();
  await openRootOwnedOverlay(container, {
    type: "history",
    initialFilterMode: reason === "continue" ? "watching" : "all",
  });
  const selection = await selectionPromise;
  if (!selection) return "handled";
  if (selection.localJobId) {
    await playCompletedDownload(container, selection.localJobId);
    return "handled";
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

export async function routeSearchShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  const { stateManager } = container;

  if (action === "quit")
    return (await resolveQuitWithDownloadQueue(container)) === "quit" ? "quit" : "handled";
  if (action === "trending") return "handled";
  if (action === "recommendation") return "handled";
  if (action === "calendar") return "handled";
  if (action === "anime-calendar") return "handled";
  if (action === "series-calendar") return "handled";
  if (action === "random") return "handled";
  if (action === "surprise") return "handled";
  if (action === "toggle-mode") {
    switchSessionMode(stateManager);
    stateManager.dispatch({ type: "RESET_SEARCH" });
    stateManager.dispatch({ type: "SET_SEARCH_STATE", state: "idle" });
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
  if (action === "provider") return "provider";
  if (action === "continue") return openRootHistorySelection(container, "continue");
  if (action === "history") return openRootHistorySelection(container, "history");
  if (action === "settings" || action === "presence") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }

  const result = await handleShellAction({ action, container });
  return result === "quit" ? "quit" : result;
}

export async function routePlaybackShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  const { stateManager } = container;

  if (action === "quit")
    return (await resolveQuitWithDownloadQueue(container)) === "quit" ? "quit" : "handled";
  if (action === "toggle-mode") {
    switchSessionMode(stateManager);
    return "mode-switch";
  }
  if (action === "search") return "back-to-search";
  if (action === "back-to-results") return "back-to-results";
  if (action === "toggle-autoplay") return "toggle-autoplay";
  if (action === "toggle-autoskip") return "toggle-autoskip";
  if (action === "stop-after-current") return "stop-after-current";
  if (action === "resume") return "resume";
  if (action === "next") return "next";
  if (action === "previous") return "previous";
  if (action === "next-season") return "next-season";
  if (action === "replay") return "replay";
  if (action === "recover") return "recover";
  if (action === "recompute") return "recompute";
  if (action === "fallback") return "fallback";
  if (action === "source") return "source";
  if (action === "quality") return "quality";
  if (action === "audio") return "audio";
  if (action === "subtitle") return "subtitle";
  if (action === "memory") return "memory";
  if (action === "download") return "download";
  if (action === "pick-episode") return "pick-episode";
  if (action === "calendar") return "calendar";
  if (action === "anime-calendar") return "anime-calendar";
  if (action === "series-calendar") return "series-calendar";
  if (action === "random") return "random";
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
  if (action === "provider") return "provider";
  if (action === "continue") return openRootHistorySelection(container, "continue");
  if (action === "history") return openRootHistorySelection(container, "history");
  if (action === "settings" || action === "presence") {
    await openRootOwnedOverlay(container, { type: "settings" });
    return "handled";
  }
  if (action === "recommendation") {
    const [
      { loadDiscoverResults },
      { createSessionPickerId, openSessionPicker, waitForSessionPicker },
    ] = await Promise.all([import("../app/discover-results"), import("./session-picker")]);
    const recommendation = await loadDiscoverResults(container);
    const id = createSessionPickerId("recommendation");
    const options = recommendation.results.map((r) => ({
      value: r.id,
      label: r.title,
      detail: `${r.type === "movie" ? "movie" : "series"} · ${r.year}`,
    }));
    void openSessionPicker(stateManager, {
      type: "recommendation_picker",
      id,
      options,
      emptyMessage: recommendation.emptyMessage,
    });
    const selectedId = await waitForSessionPicker(stateManager, id);
    if (!selectedId) return "handled";
    const selected = recommendation.results.find((r) => r.id === selectedId);
    if (!selected) return "handled";
    return {
      type: "history-entry",
      title: {
        id: selected.id,
        type: selected.type,
        name: selected.title,
      },
    };
  }

  const result = await handleShellAction({ action, container });
  return result === "quit" ? "quit" : result;
}
