import type { SessionState } from "@/domain/session/SessionState";

import {
  COMMANDS,
  COMMAND_CONTEXTS,
  resolveCommandContext as resolveRegisteredCommandContext,
  resolveCommands,
  type AppCommand,
  type AppCommandId,
  type CommandContextId as RegisteredCommandContextId,
  type ResolvedAppCommand,
} from "../domain/session/command-registry";

export {
  COMMANDS,
  COMMAND_CONTEXTS,
  resolveCommands,
  type AppCommand,
  type AppCommandId,
  type ResolvedAppCommand,
};

export type CommandContextId = RegisteredCommandContextId;

const POST_PLAYBACK_SURFACE_COMMANDS: readonly AppCommandId[] = [
  "next",
  "previous",
  "replay",
  "recover",
  "recompute",
  "fallback",
  "pick-episode",
  "source",
  "quality",
  "provider",
  "bookmark",
  "follow",
  "unfollow",
  "mute",
  "mark-watched",
  "mark-unwatched",
  "mark-season-watched",
  "mark-up-to-episode",
  "playlists",
  "up-next",
  "stats",
  "search",
  "recommendation",
  "calendar",
  "downloads",
  "library",
  "history",
  "diagnostics",
];

const MEDIA_PICKER_SURFACE_COMMANDS: readonly AppCommandId[] = ["diagnostics", "help"];

function isMediaPickerOverlay(type: string): boolean {
  return (
    type === "season_picker" ||
    type === "episode_picker" ||
    type === "subtitle_picker" ||
    type === "recommendation_picker"
  );
}

export function resolveCommandContext(
  state: SessionState,
  context: CommandContextId,
): readonly ResolvedAppCommand[] {
  if (context === "postPlayback") {
    return resolveCommands(state, POST_PLAYBACK_SURFACE_COMMANDS, {
      excludeGroups: ["Experimental"],
    });
  }

  const topOverlay = state.activeModals.at(-1);
  if (context === "rootOverlay" && topOverlay && isMediaPickerOverlay(topOverlay.type)) {
    return resolveCommands(state, MEDIA_PICKER_SURFACE_COMMANDS);
  }

  return resolveRegisteredCommandContext(state, context);
}
