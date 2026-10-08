import type { ProviderRelayConfig } from "@kunai/types";
import { isJsonObject } from "@kunai/types";

import { DEFAULT_CONFIG } from "./defaults";
import { kitsuneProviderRelayConfigSchema } from "./schema";
import type { KitsuneConfig } from "./types";

export function parseProviderRelayConfig(value: unknown): ProviderRelayConfig {
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONFIG.providerRelay;
}

export function parseKitsuneConfigPartial<T>(value: T): Partial<KitsuneConfig> {
  if (!isJsonObject(value)) return {};
  // providerRelay is the only schema-checked field; a bad value there must
  // not poison every other key. Validate it apart from the passthrough rest.
  // SAFETY: untyped keys pass through for forward compatibility exactly as
  // kitsuneConfigPartialSchema defined them; providerRelay is re-validated
  // below before it can reach the result.
  const { providerRelay, ...rest } = value as Partial<KitsuneConfig>;
  if (providerRelay === undefined) return rest;
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(providerRelay);
  return parsed.success ? { ...rest, providerRelay: parsed.data } : rest;
}

/**
 * Object-valued keys overlay the base instead of replacing it. A hand-edited
 * `{"sync": {"anilist": null}}` or `{"animeLanguageProfile": null}` would
 * otherwise put `null` where every reader does `x.y.z`, and a partial object
 * would drop the keys it doesn't name. Only JSON objects merge; anything else
 * keeps the base value.
 */
const mergeObjectField = <T extends object>(base: T, value: unknown): T =>
  isJsonObject(value) ? { ...base, ...(value as Partial<T>) } : base;

function mergeSyncConfig(base: KitsuneConfig["sync"], partial: unknown): KitsuneConfig["sync"] {
  if (!isJsonObject(partial)) return base;
  const { anilist, tmdb, ...rest } = partial;
  return {
    ...(rest as Omit<KitsuneConfig["sync"], "anilist" | "tmdb">),
    anilist: mergeObjectField(base.anilist, anilist),
    tmdb: mergeObjectField(base.tmdb, tmdb),
  };
}

export function mergeKitsuneConfig(
  base: KitsuneConfig,
  partial: Partial<KitsuneConfig>,
): KitsuneConfig {
  return {
    ...base,
    ...partial,
    ...(partial.providerRelay !== undefined
      ? { providerRelay: parseProviderRelayConfig(partial.providerRelay) }
      : null),
    youtubeLanguageProfile: mergeObjectField(
      base.youtubeLanguageProfile,
      partial.youtubeLanguageProfile,
    ),
    animeLanguageProfile: mergeObjectField(base.animeLanguageProfile, partial.animeLanguageProfile),
    seriesLanguageProfile: mergeObjectField(
      base.seriesLanguageProfile,
      partial.seriesLanguageProfile,
    ),
    movieLanguageProfile: mergeObjectField(base.movieLanguageProfile, partial.movieLanguageProfile),
    youtubeMetadata: mergeObjectField(base.youtubeMetadata, partial.youtubeMetadata),
    titleProviderPreferences: mergeObjectField(
      base.titleProviderPreferences,
      partial.titleProviderPreferences,
    ),
    sync: mergeSyncConfig(base.sync, partial.sync),
  };
}
