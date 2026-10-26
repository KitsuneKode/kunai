import { DEFAULT_CONFIG } from "./defaults";

/**
 * Production adapters removed from `loadProductionProviderModules()` but kept
 * in `@kunai/providers` for fixtures, history ids, and metadata helpers.
 */
export const RETIRED_PRODUCTION_PROVIDER_IDS = ["anidb"] as const;

export type RetiredProductionProviderId = (typeof RETIRED_PRODUCTION_PROVIDER_IDS)[number];

const RETIRED_PRODUCTION_PROVIDER_ID_SET = new Set<string>(
  RETIRED_PRODUCTION_PROVIDER_IDS.map((id) => id.toLowerCase()),
);

export function isRetiredProductionProviderId(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return RETIRED_PRODUCTION_PROVIDER_ID_SET.has(normalized);
}

export type RetiredProductionProviderFieldSlice = {
  readonly provider: string;
  readonly providerPriority: readonly string[];
  readonly animeProvider: string;
  readonly animeProviderPriority: readonly string[];
  readonly youtubeProvider: string;
  readonly youtubeProviderPriority: readonly string[];
  readonly disabledProviders: readonly string[];
  readonly titleProviderPreferences: Record<string, string>;
};

function resolveRetiredLaneDefault(lane: "series" | "anime" | "youtube"): string {
  if (lane === "anime") return DEFAULT_CONFIG.animeProvider;
  if (lane === "youtube") return DEFAULT_CONFIG.youtubeProvider;
  return DEFAULT_CONFIG.provider;
}

function resolveActiveProviderSelection(providerId: string, lane: "series" | "anime" | "youtube") {
  const trimmed = providerId.trim();
  if (!trimmed || isRetiredProductionProviderId(trimmed)) {
    return resolveRetiredLaneDefault(lane);
  }
  return trimmed;
}

function stripRetiredProductionProviders(ids: readonly string[]): readonly string[] {
  return ids.filter((id) => !isRetiredProductionProviderId(id));
}

function normalizeTitleProviderPreferencesAfterRetirement(
  value: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [titleId, providerId] of Object.entries(value)) {
    if (isRetiredProductionProviderId(providerId)) continue;
    normalized[titleId] = providerId;
  }
  return normalized;
}

/** Load/update seam: map retired ids off active lane fields without aliasing history. */
export function normalizeRetiredProductionProviderFields<
  T extends RetiredProductionProviderFieldSlice,
>(config: T): T {
  return {
    ...config,
    provider: resolveActiveProviderSelection(config.provider, "series"),
    providerPriority: stripRetiredProductionProviders(config.providerPriority),
    animeProvider: resolveActiveProviderSelection(config.animeProvider, "anime"),
    animeProviderPriority: stripRetiredProductionProviders(config.animeProviderPriority),
    youtubeProvider: resolveActiveProviderSelection(config.youtubeProvider, "youtube"),
    youtubeProviderPriority: stripRetiredProductionProviders(config.youtubeProviderPriority),
    disabledProviders: stripRetiredProductionProviders(config.disabledProviders),
    titleProviderPreferences: normalizeTitleProviderPreferencesAfterRetirement(
      config.titleProviderPreferences,
    ),
  };
}

export function retiredProductionProviderFieldsChanged(
  before: RetiredProductionProviderFieldSlice,
  after: RetiredProductionProviderFieldSlice,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
