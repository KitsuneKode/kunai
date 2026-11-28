import type { LocalTitleMatch } from "@/domain/palette/local-title-index";
import { fuzzyMatchScore } from "@/domain/session/fuzzy-match";

import type { AppCommandId, ResolvedAppCommand } from "./commands";

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

export type PaletteCommandTier = "exact" | "prefix" | "fuzzy";

type PaletteCommandTierBuckets = {
  exact: ResolvedAppCommand[];
  prefix: ResolvedAppCommand[];
  fuzzy: ResolvedAppCommand[];
};

export type PaletteRankedRow =
  | { readonly kind: "command"; readonly command: ResolvedAppCommand }
  | { readonly kind: "title"; readonly match: LocalTitleMatch }
  | { readonly kind: "search"; readonly query: string };

export function normalizePaletteQuery(input: string): string {
  return input.trim().replace(/^\/+/, "").toLowerCase();
}

function commandNames(command: ResolvedAppCommand): readonly string[] {
  return [command.id, command.label, ...command.aliases];
}

function exactCommandMatch(query: string, command: ResolvedAppCommand): boolean {
  return commandNames(command).some((name) => name.toLowerCase() === query);
}

function prefixCommandMatch(query: string, command: ResolvedAppCommand): boolean {
  return commandNames(command).some((name) =>
    name
      .toLowerCase()
      .split(/[\s/:._-]+/)
      .some((word) => word.startsWith(query)),
  );
}

function fuzzyCommandMatch(query: string, command: ResolvedAppCommand): boolean {
  return [command.id, command.label, command.description, ...command.aliases].some(
    (target) => fuzzyMatchScore(query, target) !== null,
  );
}

export function commandMatchTier(
  query: string,
  command: ResolvedAppCommand,
): PaletteCommandTier | null {
  if (!query) return null;
  if (exactCommandMatch(query, command)) return "exact";
  if (prefixCommandMatch(query, command)) return "prefix";
  if (fuzzyCommandMatch(query, command)) return "fuzzy";
  return null;
}

/**
 * Command ordering is tiered, not score-ordered: exact handle → word prefix →
 * fuzzy. Stability inside a tier keeps the visible row order predictable and
 * prevents incidental description fuzz from leapfrogging deliberate prefixes.
 */
export function rankPaletteCommands(
  input: string,
  commands: readonly ResolvedAppCommand[],
): readonly ResolvedAppCommand[] {
  const query = normalizePaletteQuery(input);
  if (!query) return commands;
  const tiers: PaletteCommandTierBuckets = {
    exact: [],
    prefix: [],
    fuzzy: [],
  };
  for (const command of commands) {
    const tier = commandMatchTier(query, command);
    if (tier) tiers[tier].push(command);
  }
  if (tiers.exact.length + tiers.prefix.length > 0) {
    return [...tiers.exact, ...tiers.prefix];
  }
  return tiers.fuzzy;
}

/**
 * Union row ordering for one palette query. Local-title prefix rows sit above
 * fuzzy command rows; fuzzy title rows come last. The catalog-search escape
 * hatch exists only when nothing exact/prefix matched, and is always last.
 */
export function buildPaletteRows(
  input: string,
  commands: readonly ResolvedAppCommand[],
  titleMatches: readonly LocalTitleMatch[],
  options: { readonly catalogSearch?: boolean } = {},
): readonly PaletteRankedRow[] {
  const query = normalizePaletteQuery(input);
  if (!query) {
    const context = commands.filter((command) => CONTEXT_COMMAND_IDS.has(command.id));
    const global = commands.filter((command) => !CONTEXT_COMMAND_IDS.has(command.id));
    return [...context, ...global].map((command) => ({ kind: "command" as const, command }));
  }

  const orderedCommands = rankPaletteCommands(input, commands);
  const exactCommands: ResolvedAppCommand[] = [];
  const prefixCommands: ResolvedAppCommand[] = [];
  const fuzzyCommands: ResolvedAppCommand[] = [];
  for (const command of orderedCommands) {
    const tier = commandMatchTier(query, command);
    if (tier === "exact") exactCommands.push(command);
    else if (tier === "prefix") prefixCommands.push(command);
    else if (tier === "fuzzy") fuzzyCommands.push(command);
  }

  const prefixTitles = titleMatches.filter((match) => match.tier <= 1);
  const fuzzyTitles = titleMatches.filter((match) => match.tier === 2);
  const rows: PaletteRankedRow[] = [
    ...exactCommands.map((command) => ({ kind: "command" as const, command })),
    ...prefixCommands.map((command) => ({ kind: "command" as const, command })),
    ...prefixTitles.map((match) => ({ kind: "title" as const, match })),
    // A command exact/prefix match narrows the command half of the palette:
    // incidental description fuzz must not refill the menu underneath it. When
    // no command prefix exists ("/sm"), fuzzy commands remain ranked below a
    // local-title prefix instead of above it.
    ...(exactCommands.length + prefixCommands.length === 0
      ? fuzzyCommands.map((command) => ({ kind: "command" as const, command }))
      : []),
    ...fuzzyTitles.map((match) => ({ kind: "title" as const, match })),
  ];

  const hasPrefixMatch = exactCommands.length + prefixCommands.length + prefixTitles.length > 0;
  if (options.catalogSearch && query.length >= 2 && !hasPrefixMatch) {
    rows.push({ kind: "search", query });
  }
  return rows;
}

/**
 * Initial row for a fresh query. A catalog fallback is a deliberate escape
 * hatch for a query with no exact/prefix match, so it owns the initial Enter;
 * fuzzy noise above it remains reachable with ↑/↓.
 */
export function defaultPaletteSelectionIndex(
  input: string,
  commands: readonly ResolvedAppCommand[],
  titleMatches: readonly LocalTitleMatch[],
  options: { readonly catalogSearch?: boolean } = {},
): number {
  const rows = buildPaletteRows(input, commands, titleMatches, options);
  const fallbackIndex = rows.findIndex((row) => row.kind === "search");
  return fallbackIndex >= 0 ? fallbackIndex : 0;
}
