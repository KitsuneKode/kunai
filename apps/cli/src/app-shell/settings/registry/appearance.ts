import { isThemeName, listThemes } from "@kunai/design";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

/**
 * Appearance rows. The theme enum is sourced from the design registry rather
 * than a hand-kept list, so a palette added in `@kunai/design` appears here
 * with no settings change — the reverse state (pick any theme back) is the
 * enum itself, and `KUNAI_THEME` overrides per run without touching config.
 */
export function appearanceSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:appearance",
      label: "Appearance",
      detail: "Theme and how the shell looks",
    },
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
  ];
}
