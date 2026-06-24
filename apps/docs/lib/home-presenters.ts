import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";

export const FEATURED_COMMAND_IDS = [
  "search",
  "discover",
  "calendar",
  "setup",
  "history",
  "queue",
  "share",
  "help",
] as const;

export function featuredCommands(
  commands: readonly HomeCommandMetadata[],
  limit = FEATURED_COMMAND_IDS.length,
): HomeCommandMetadata[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  const picked: HomeCommandMetadata[] = [];

  for (const id of FEATURED_COMMAND_IDS) {
    const command = byId.get(id);
    if (command) picked.push(command);
    if (picked.length >= limit) break;
  }

  if (picked.length >= limit) return picked.slice(0, limit);

  for (const command of commands) {
    if (picked.some((entry) => entry.id === command.id)) continue;
    picked.push(command);
    if (picked.length >= limit) break;
  }

  return picked;
}

export function commandsForPalette(
  commands: readonly HomeCommandMetadata[],
  allCommands: readonly HomeCommandMetadata[],
  searchQuery: string,
): HomeCommandMetadata[] {
  const query = searchQuery.trim().toLowerCase().replace(/^\//, "");
  if (query.length < 2) {
    return featuredCommands(commands);
  }

  return allCommands
    .filter((command) => {
      return (
        command.id.toLowerCase().includes(query) ||
        command.label.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query) ||
        (command.aliases?.some((alias) => alias.toLowerCase().includes(query)) ?? false)
      );
    })
    .slice(0, 12);
}

export type ProviderSummary = {
  readonly count: number;
  readonly activeCount: number;
  readonly recommended: readonly string[];
};

export function summarizeProviders(providers: readonly HomeProviderMetadata[]): ProviderSummary {
  return {
    count: providers.length,
    activeCount: providers.filter((provider) => provider.status === "active").length,
    recommended: providers
      .filter((provider) => provider.recommended)
      .map((provider) => provider.displayName),
  };
}
