import type { LocalTitleMatch } from "@/domain/palette/local-title-index";
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

export type PaletteRowSelection =
  | { readonly kind: "command"; readonly command: ResolvedAppCommand }
  | { readonly kind: "title"; readonly match: LocalTitleMatch };

/**
 * Total navigable palette rows: visible commands [0, C) then title matches
 * [C, C+T) — the same absolute index space the palette renderer uses.
 */
export function paletteSelectableCount(
  input: string,
  commands: readonly ResolvedAppCommand[],
  titleMatches: readonly LocalTitleMatch[],
): number {
  return buildCommandPickerModel(input, commands, 0).options.length + titleMatches.length;
}

/** Wrap-around selection over the union of command + title rows. */
export function movePaletteSelection(count: number, current: number, delta: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

/**
 * Resolve the row Enter would run. Commands always outrank titles — they hold
 * indices [0, C), so an exact `/trending` command match (or any navigated
 * command row) wins over every title row. Shares `getHighlightedCommand`'s
 * invariant: resolve from the SAME model the palette renders.
 */
export function resolveHighlightedPaletteRow(
  input: string,
  commands: readonly ResolvedAppCommand[],
  titleMatches: readonly LocalTitleMatch[],
  highlightedIndex: number,
): PaletteRowSelection | null {
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  if (highlightedIndex < model.options.length) {
    const command = commands.find((candidate) => candidate.id === model.selectedOption?.value);
    return command ? { kind: "command", command } : null;
  }
  const match = titleMatches[highlightedIndex - model.options.length];
  return match ? { kind: "title", match } : null;
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
  // The idle list is a menu of what can be run *now*, so commands blocked by
  // context (/download with nothing selected, /bookmark before a title exists)
  // are dropped rather than shown greyed with an explanation nobody asked for —
  // roughly half the visible rows were unusable.
  //
  // They stay in the list the moment anything is typed: a user who searches
  // "download" must still find it and learn why it is unavailable, so this
  // declutters the default view without making a command undiscoverable.
  // If context blocks everything, fall back to the full list rather than
  // rendering an empty palette.
  const runnable = commands.filter((command) => command.enabled);
  const visible = showGrouped && runnable.length > 0 ? runnable : commands;
  return buildPickerModel<AppCommandId>({
    query: input,
    selectedIndex: highlightedIndex,
    groupOrder: showGrouped ? ["context", "global"] : undefined,
    groupLabels: COMMAND_GROUP_LABELS,
    options: visible.map((command) => ({
      id: command.id,
      value: command.id,
      label: command.label,
      detail: command.description,
      enabled: command.enabled,
      disabledReason: command.reason,
      group: showGrouped ? (CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global") : undefined,
      // The id is the canonical handle docs and habits use — a hyphenated id
      // like `image-pane` never matches "Image Pane" (the hyphen isn't a word
      // boundary in the query), so the id itself must be a match target.
      keywords: [
        { value: command.id, weight: -8 },
        ...command.aliases.map((alias, index) => ({
          value: alias,
          weight: index === 0 ? -8 : 6,
        })),
      ],
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
