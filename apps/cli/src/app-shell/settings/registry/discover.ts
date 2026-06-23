import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { DISCOVER_ITEM_LIMIT_OPTIONS, DISCOVER_MODE_OPTIONS } from "./shared";

export function discoverSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:discover",
      label: "Discover",
      detail: "Home recommendations, /random, and startup discover tray",
    },
    {
      kind: "boolean",
      id: "discoverShowOnStartup",
      label: "Show discover on startup",
      detail: "Open recommendations first instead of the empty search home",
      read: (config) => config.discoverShowOnStartup,
      write: (config, value) => ({ ...config, discoverShowOnStartup: value }),
    },
    {
      kind: "enum",
      id: "discoverMode",
      label: "Discover mode",
      detail: "Choose whether discover follows mode, mixes catalogs, or stays focused",
      options: DISCOVER_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.discoverMode,
      write: (config, value) => ({ ...config, discoverMode: value as typeof config.discoverMode }),
    },
    {
      kind: "enum",
      id: "discoverItemLimit",
      label: "Discover tray size",
      detail: "How many results /discover, /random, and /surprise should stage",
      options: DISCOVER_ITEM_LIMIT_OPTIONS,
      presentation: "submenu",
      read: (config) => String(config.discoverItemLimit),
      write: (config, value) => ({
        ...config,
        discoverItemLimit: Number(value) || config.discoverItemLimit,
      }),
    },
    {
      kind: "boolean",
      id: "recommendationRailEnabled",
      label: "Post-playback recommendations",
      detail: "Show a compact recommendation rail after finishing playback",
      read: (config) => config.recommendationRailEnabled,
      write: (config, value) => ({ ...config, recommendationRailEnabled: value }),
    },
    {
      kind: "boolean",
      id: "showWatchTimeStats",
      label: "Watch-time stats",
      detail: "Show compact watch-time totals in recommendation and history surfaces",
      read: (config) => config.showWatchTimeStats,
      write: (config, value) => ({ ...config, showWatchTimeStats: value }),
    },
  ];
}
