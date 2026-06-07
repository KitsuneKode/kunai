import { buildPickerModel, movePickerModelSelection } from "@/domain/session/picker-model";

import { COMMANDS, type AppCommandId, type ResolvedAppCommand } from "./commands";

/** Commands that appear under the "Context" group header in the palette. */
export const CONTEXT_COMMAND_IDS = new Set<AppCommandId>([
  "toggle-autoplay",
  "replay",
  "recover",
  "fallback",
  "source",
  "quality",
  "audio",
  "subtitle",
  "memory",
  "pick-episode",
  "next",
  "previous",
  "next-season",
  "download",
]);

export const COMMAND_GROUP_LABELS = {
  context: "Context",
  global: "Global",
} as const;

export function getCommandMatches(
  input: string,
  commands: readonly ResolvedAppCommand[],
): readonly ResolvedAppCommand[] {
  return buildCommandPickerModel(input, commands, 0)
    .options.map((option) => commands.find((command) => command.id === option.value))
    .filter((command): command is ResolvedAppCommand => Boolean(command));
}

export function getHighlightedCommand(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
): ResolvedAppCommand | null {
  // INVARIANT: Enter runs exactly the row the palette highlights. Resolve from the
  // SAME picker model the palette renders — never via a separate exact-parse
  // shortcut, which can diverge from the visible highlight (e.g. an exact alias
  // like "c" overriding a row you navigated to).
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  return commands.find((command) => command.id === model.selectedOption?.value) ?? null;
}

export function getCommandAutocompleteTarget(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
): ResolvedAppCommand | null {
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  if (model.options.length === 0) return null;

  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  const selected = commands.find((command) => command.id === model.selectedOption?.value) ?? null;
  if (!normalized || !selected) return selected;

  const selectedAlias = selected.aliases[0] ?? selected.id;
  if (selectedAlias.toLowerCase() !== normalized) return selected;

  const nextIndex = movePickerModelSelection(model, 1);
  return commands.find((command) => command.id === model.options[nextIndex]?.value) ?? selected;
}

export function shouldHideCompanionForCommandPalette(commandMode: boolean): boolean {
  return commandMode;
}

export function getPlaybackCommandPaletteMaxVisible(rows: number): number {
  const playbackChromeRows = 14;
  const availableRows = rows - 4 - playbackChromeRows - 4 - 5 - 3;
  return Math.max(1, Math.min(18, availableRows));
}

export function getListShellCommandPaletteMaxVisible(
  rows: number,
  subtitleLineCount: number,
): number {
  const subtitleRows = Math.min(subtitleLineCount, 6);
  const listChromeRows = 1 + subtitleRows + 7 + 1 + 1 + 4;
  const availableRows = rows - 4 - listChromeRows - 4 - 5 - 3;
  return Math.max(1, Math.min(18, availableRows));
}

export function resolveCommandPaletteWidth(shellWidth: number): number {
  const columns = Math.max(28, shellWidth);
  return Math.max(28, Math.min(columns, columns - 4) - 4);
}

export function buildCommandPickerModel(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
) {
  const showGrouped = input.trim().length === 0;
  return buildPickerModel<AppCommandId>({
    query: input,
    selectedIndex: highlightedIndex,
    groupOrder: showGrouped ? ["context", "global"] : undefined,
    groupLabels: COMMAND_GROUP_LABELS,
    options: commands.map((command) => ({
      id: command.id,
      value: command.id,
      label: command.label,
      detail: command.description,
      enabled: command.enabled,
      disabledReason: command.reason,
      group: showGrouped ? (CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global") : undefined,
      keywords: command.aliases.map((alias, index) => ({
        value: alias,
        weight: index === 0 ? -8 : 6,
      })),
    })),
  });
}

export function fallbackCommandState(
  allowed: readonly AppCommandId[],
): readonly ResolvedAppCommand[] {
  return allowed
    .map((id) => COMMANDS.find((command) => command.id === id))
    .filter((command): command is ResolvedAppCommand => Boolean(command))
    .map((command) => ({
      ...command,
      enabled: true,
    }));
}
