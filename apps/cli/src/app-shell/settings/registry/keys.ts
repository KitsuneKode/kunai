import { isPlausibleTmdbCredential } from "@/services/catalog/tmdb-proxy";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

/**
 * Keys the user owns. Each is optional: without it Kunai uses its own release
 * key or a keyless source. With it, requests go to the service directly on the
 * user's own free quota, so they never depend on a key Kunai ships. Values are
 * kept in the OS credential vault when one is available.
 */
export function keySettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "subheading",
      id: "subheading:keys",
      label: "Your API keys",
      detail: "Optional — free, personal keys that make catalogs faster and independent of Kunai",
    },
    {
      kind: "text",
      id: "tmdbApiKey",
      effectTiming: "immediate",
      configKeys: ["tmdbApiKey"],
      label: "TMDB key",
      detail:
        "Free at themoviedb.org/settings/api — paste the API Key or the API Read Access Token. Search, trending and episode lists then go to TMDB directly.",
      placeholder: "Paste your TMDB API key or read access token, then press Enter",
      sensitive: true,
      envOverride: "KUNAI_TMDB_API_KEY",
      read: (config) => config.tmdbApiKey,
      apply: (config, value) => ({ ...config, tmdbApiKey: value.trim() }),
      validate: (value) =>
        !value.trim() || isPlausibleTmdbCredential(value)
          ? null
          : "That is not a TMDB key: paste the 32-character API Key or the long API Read Access Token (starts with eyJ), or clear it.",
    },
  ];
}
