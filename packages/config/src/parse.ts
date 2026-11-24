import type { ProviderRelayConfig } from "@kunai/types";
import { isJsonObject, isJsonString, type LooseJsonValue } from "@kunai/types";

import { DEFAULT_CONFIG } from "./defaults";
import { kitsuneProviderRelayConfigSchema } from "./schema";
import type { KitsuneConfig } from "./types";

export function parseProviderRelayConfig(value: unknown): ProviderRelayConfig {
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONFIG.providerRelay;
}

/** The `new Date().toISOString()` shape — the only form the ack timestamp may hold. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The experimental opt-in is strict `true` or off. A hand-edited `"yes"`, `1`,
 * or `null` is a fail-closed `false`, never an error that loses other keys.
 */
export function normalizeExperimentalStremioAddons(value: LooseJsonValue): boolean {
  return value === true;
}

/**
 * A recorded risk acknowledgement, or empty. Anything that is not an ISO
 * instant cannot have come from an explicit confirmation, so it is off.
 */
export function normalizeStremioAddonsRiskAcknowledgedAt(value: LooseJsonValue): string {
  if (!isJsonString(value) || !ISO_TIMESTAMP.test(value)) return "";
  return Number.isNaN(Date.parse(value)) ? "" : value;
}

export function parseKitsuneConfigPartial<T>(value: T): Partial<KitsuneConfig> {
  if (!isJsonObject(value)) return {};
  // providerRelay is the only schema-checked field; a bad value there must
  // not poison every other key. Validate it apart from the passthrough rest.
  // SAFETY: untyped keys pass through for forward compatibility exactly as
  // kitsuneConfigPartialSchema defined them; providerRelay is re-validated
  // below before it can reach the result.
  const { providerRelay, experimentalStremioAddons, stremioAddonsRiskAcknowledgedAt, ...rest } =
    value as Partial<KitsuneConfig>;
  const partial: Partial<KitsuneConfig> = { ...rest };
  // The opt-in pair is validated key-by-key too: a malformed flag or ack is
  // normalized in place and must not discard unrelated settings.
  if (experimentalStremioAddons !== undefined) {
    partial.experimentalStremioAddons =
      normalizeExperimentalStremioAddons(experimentalStremioAddons);
  }
  if (stremioAddonsRiskAcknowledgedAt !== undefined) {
    partial.stremioAddonsRiskAcknowledgedAt = normalizeStremioAddonsRiskAcknowledgedAt(
      stremioAddonsRiskAcknowledgedAt,
    );
  }
  if (providerRelay === undefined) return partial;
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(providerRelay);
  return parsed.success ? { ...partial, providerRelay: parsed.data } : partial;
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
    ...(partial.experimentalStremioAddons !== undefined
      ? {
          experimentalStremioAddons: normalizeExperimentalStremioAddons(
            partial.experimentalStremioAddons,
          ),
        }
      : null),
    ...(partial.stremioAddonsRiskAcknowledgedAt !== undefined
      ? {
          stremioAddonsRiskAcknowledgedAt: normalizeStremioAddonsRiskAcknowledgedAt(
            partial.stremioAddonsRiskAcknowledgedAt,
          ),
        }
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
