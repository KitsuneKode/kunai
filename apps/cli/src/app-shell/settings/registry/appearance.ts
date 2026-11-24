import { isThemeName, listThemes } from "@kunai/design";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

/**
 * Appearance rows. The theme enum is sourced from the design registry rather
 * than a hand-kept list, so a palette added in `@kunai/design` appears here
 * with no settings change — the reverse state (pick any theme back) is the
 * enum itself, and `KUNAI_THEME` overrides per run without touching config.
 */
export function appearanceSettingsRows(_ctx?: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "enum",
      id: "theme",
      configKeys: ["theme"],
      label: "Theme",
      detail: "Shell color palette — applies immediately, saved for next launch",
      options: listThemes().map((theme) => ({
        value: theme.name,
        label: theme.label,
        detail: theme.detail,
      })),
      presentation: "submenu",
      read: (config) => config.theme,
      write: (config, value) => ({
        ...config,
        theme: isThemeName(value) ? value : config.theme,
      }),
    },
    {
      kind: "boolean",
      id: "plainMode",
      configKeys: ["plainMode"],
      label: "Plain / screen-reader mode",
      detail:
        "No animation, box art, or decorative glyphs; states and selection announced as text. The screen buffer and mouse change on the next launch (also --plain or KUNAI_PLAIN=1)",
      envOverride: "KUNAI_PLAIN",
      read: (config) => config.plainMode,
      write: (config, value) => ({
        ...config,
        plainMode: value,
      }),
    },
  ];
}
