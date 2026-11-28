import { COMMANDS, type AppCommandId } from "./command-registry";

/** Slash commands surfaced in the `?` help overlay (panels & commands section). */
export const HELP_PANEL_COMMAND_IDS = [
  "history",
  "watchlist",
  "playlists",
  "up-next",
  "stats",
  "notifications",
  "diagnostics",
  "downloads",
  "library",
  "settings",
  "setup",
  "theme",
  "presence",
  "analytics",
  "follow",
  "unfollow",
  "mute",
  "export-diagnostics",
  "report-issue",
] as const satisfies readonly AppCommandId[];

export type HelpPanelCommandLine = {
  readonly label: string;
  readonly detail: string;
};

export function buildHelpPanelCommandLines(): readonly HelpPanelCommandLine[] {
  return HELP_PANEL_COMMAND_IDS.flatMap((id) => {
    const command = COMMANDS.find((candidate) => candidate.id === id);
    if (!command) return [];
    const slashAlias = command.aliases[0] ?? command.id;
    return [{ label: `/${slashAlias}`, detail: command.description }];
  });
}
