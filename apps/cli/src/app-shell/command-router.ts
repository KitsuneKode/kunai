import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";
import type { Container } from "@/container";
import type { SessionState } from "@/domain/session/SessionState";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

import {
  dispatchAppCommand,
  type AppCommandDispatchInput,
  type AppCommandDispatchResult,
  type AppCommandSource,
} from "./app-command-dispatcher";
import { resolveCommandContext, resolveCommands, type ResolvedAppCommand } from "./commands";
import { dispatchPaletteCommand } from "./dispatch-palette-command";
import type { ShellAction } from "./types";

export {
  dispatchAppCommand,
  type AppCommandDispatchInput,
  type AppCommandDispatchResult,
  type AppCommandSource,
};

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
  | { type: "history-entry"; title: TitleInfo; episode?: EpisodeInfo; startSeconds?: number }
  | "unhandled";

function playbackPassthrough(action: ShellAction): RoutedActionResult | null {
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
  return null;
}

export async function routeSearchShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  if (action === "trending") return "handled";
  if (action === "recommendation") return "handled";
  if (action === "calendar") return "handled";
  if (action === "anime-calendar") return "handled";
  if (action === "series-calendar") return "handled";
  if (action === "random") return "handled";
  if (action === "surprise") return "handled";

  return dispatchPaletteCommand("browse", action, container) as Promise<RoutedActionResult>;
}

export async function routePlaybackShellAction({
  action,
  container,
}: {
  action: ShellAction;
  container: Container;
}): Promise<RoutedActionResult> {
  const { stateManager } = container;

  if (action === "recommendation") {
    const [
      { loadDiscoverResults },
      { createSessionPickerId, openSessionPicker, waitForSessionPicker },
    ] = await Promise.all([import("../app/discover/discover-results"), import("./session-picker")]);
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

  return dispatchPaletteCommand(
    "playback",
    action,
    container,
    playbackPassthrough,
  ) as Promise<RoutedActionResult>;
}
