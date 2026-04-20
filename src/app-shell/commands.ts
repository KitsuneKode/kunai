export type AppCommandId =
  | "search"
  | "settings"
  | "toggle-mode"
  | "quit"
  | "provider"
  | "replay"
  | "next"
  | "previous"
  | "next-season";

export type AppCommand = {
  id: AppCommandId;
  label: string;
  aliases: readonly string[];
  description: string;
};

export const COMMANDS: readonly AppCommand[] = [
  { id: "search", label: "Search", aliases: ["search", "find"], description: "Start a new search" },
  {
    id: "settings",
    label: "Settings",
    aliases: ["settings", "config", "prefs"],
    description: "Open settings",
  },
  {
    id: "toggle-mode",
    label: "Toggle Mode",
    aliases: ["mode", "toggle-mode", "anime"],
    description: "Switch between anime and series mode",
  },
  { id: "quit", label: "Quit", aliases: ["quit", "exit", "q"], description: "Exit KitsuneSnipe" },
  {
    id: "provider",
    label: "Switch Provider",
    aliases: ["provider", "switch-provider"],
    description: "Cycle to the next provider",
  },
  {
    id: "replay",
    label: "Replay",
    aliases: ["replay", "restart"],
    description: "Replay the current item",
  },
  {
    id: "next",
    label: "Next Episode",
    aliases: ["next", "n"],
    description: "Advance to the next episode",
  },
  {
    id: "previous",
    label: "Previous Episode",
    aliases: ["previous", "prev", "p"],
    description: "Go to the previous episode",
  },
  {
    id: "next-season",
    label: "Next Season",
    aliases: ["season", "next-season"],
    description: "Jump to the next season",
  },
] as const;

export function parseCommand(input: string): AppCommand | null {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) return null;
  return COMMANDS.find((command) => command.aliases.includes(normalized)) ?? null;
}

export function suggestCommands(
  input: string,
  allowed: readonly AppCommandId[],
): readonly AppCommand[] {
  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  const pool = COMMANDS.filter((command) => allowed.includes(command.id));
  if (!normalized) return pool;
  return pool.filter(
    (command) =>
      command.aliases.some((alias) => alias.includes(normalized)) ||
      command.label.toLowerCase().includes(normalized),
  );
}
