import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { FOOTER_HINT_OPTIONS } from "./shared";

const DEFAULT_MODE_OPTIONS = [
  { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
  { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
] as const;

export function generalSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:general",
      label: "General",
      detail: "Launch mode and how much shortcut help the shell shows",
    },
    {
      kind: "enum",
      id: "defaultMode",
      label: "Default startup mode",
      detail: "First catalog after launch: series/TV or anime (does not change mid-session mode)",
      options: DEFAULT_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.defaultMode,
      write: (config, value) =>
        value === "anime"
          ? { ...config, defaultMode: "anime" }
          : { ...config, defaultMode: "series" },
    },
    {
      kind: "enum",
      id: "footerHints",
      label: "Footer hints",
      detail: "Detailed = footer shows key legend; minimal = task line only during playback",
      options: FOOTER_HINT_OPTIONS,
      presentation: "submenu",
      read: (config) => config.footerHints,
      write: (config, value) =>
        value === "minimal"
          ? { ...config, footerHints: "minimal" }
          : { ...config, footerHints: "detailed" },
    },
  ];
}
