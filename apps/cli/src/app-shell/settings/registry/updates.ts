import type { SettingRowDef, SettingsRegistryContext } from "../types";

export function updateSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:updates",
      label: "Updates",
      detail: "Release check behavior",
    },
    {
      kind: "boolean",
      id: "updateChecksEnabled",
      label: "Update checks",
      detail: "Check for new Kunai releases during startup when the network is available",
      read: (config) => config.updateChecksEnabled,
      write: (config, value) => ({ ...config, updateChecksEnabled: value }),
    },
  ];
}
