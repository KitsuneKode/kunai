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
    {
      kind: "boolean",
      id: "autoApplyBinaryUpdates",
      label: "Auto-install updates",
      detail:
        "Install new releases in the background on native installs; takes effect after a restart. Other install methods only notify.",
      // Auto-apply cannot run with checks off (BinaryAutoUpdater requires both),
      // so showing the toggle then would offer a switch that does nothing.
      gate: { predicate: (config) => config.updateChecksEnabled },
      read: (config) => config.autoApplyBinaryUpdates,
      write: (config, value) => ({ ...config, autoApplyBinaryUpdates: value }),
    },
  ];
}
