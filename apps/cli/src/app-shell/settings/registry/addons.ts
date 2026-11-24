import {
  addStremioAddon,
  enableStremioAddons,
  isStremioAddonInstalled,
  readInstalledStremioAddons,
  removeStremioAddonFromConfig,
  STREMIO_ADDONS_DISABLED,
  STREMIO_ADDONS_RISK_WARNING,
  stremioAddonsEnabled,
  type InstalledStremioAddon,
} from "@/domain/provider/stremio-addons";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

/**
 * The saved addons and the ones in the draft. Settings saves as it goes, so
 * the saved list still holds an addon in the moment after it is switched off:
 * its row stays for that moment and can put it back, instead of vanishing
 * under the cursor.
 */
function knownAddons(ctx: SettingsRegistryContext): InstalledStremioAddon[] {
  const byId = new Map<string, InstalledStremioAddon>();
  for (const addon of [
    ...readInstalledStremioAddons(ctx.persistedConfig?.stremioAddons),
    ...readInstalledStremioAddons(ctx.config.stremioAddons),
  ]) {
    byId.set(addon.providerId, addon);
  }
  return [...byId.values()];
}

/**
 * Stremio addons: sources the user installs by URL. Kunai ships none.
 *
 * The provider list is built once per run, so an addon added here is used from
 * the next start; the status row says so while one is waiting. Removing an
 * addon is honoured on the next title.
 */
export function addonSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  const addons = knownAddons(ctx);
  const running = new Set(ctx.seriesProviderOptions.map((option) => option.value));
  const waiting = readInstalledStremioAddons(ctx.config.stremioAddons).filter(
    (addon) => !running.has(addon.providerId),
  );

  const globallyOff = !stremioAddonsEnabled(ctx.config);
  return [
    {
      kind: "submenu",
      id: "experimentalStremioAddons",
      label: "Experimental: Stremio addons",
      detail:
        "Third-party addon servers you choose. Off by default; turning it off stops addons at the next resolve.",
      configKeys: ["experimentalStremioAddons", "stremioAddonsRiskAcknowledgedAt"],
      summarize: (config) => (stremioAddonsEnabled(config) ? "On" : "Off"),
      subtitle: (config) =>
        stremioAddonsEnabled(config)
          ? "Disabling addons takes effect at the next resolve. Restart Kunai to load any newly installed addons."
          : config.stremioAddonsRiskAcknowledgedAt
            ? "Enable addons for the next resolve if they are already loaded. Restart Kunai if it started with addons off."
            : STREMIO_ADDONS_RISK_WARNING,
      // The first choice is always "keep" — Enter on the default selection
      // can never switch the feature, only an explicit move to Enable does.
      buildChoices: (choiceCtx) =>
        stremioAddonsEnabled(choiceCtx.config)
          ? [
              { value: "keep-on", label: "Keep addons on" },
              { value: "disable", label: "Disable addons" },
            ]
          : [
              { value: "keep-off", label: "Keep addons off" },
              { value: "enable", label: "Enable addons" },
            ],
      onPick: (config, value) => {
        if (value === "enable") {
          // Reuses the stored acknowledgement when one exists, so a re-enable
          // does not ask to see the risk text again.
          return { ...config, ...enableStremioAddons(config, new Date().toISOString()) };
        }
        if (value === "disable") {
          // Only the flag: the acknowledgement and the installed list stay.
          return { ...config, experimentalStremioAddons: false };
        }
        return config;
      },
    },
    {
      kind: "subheading",
      id: "subheading:stremio-addons",
      label: "Stremio addons",
      detail:
        "Movie and series sources you add yourself, by manifest URL. Kunai includes none and plays only their direct video links.",
      configKeys: ["stremioAddons"],
    },
    {
      kind: "text",
      id: "stremioAddonAdd",
      label: "Add an addon",
      detail:
        "Paste the addon's https manifest.json URL. It joins the end of your movies and series order the next time Kunai starts.",
      placeholder: "Paste the addon's https://…/manifest.json URL, then press Enter",
      // A configured addon's URL can hold an account token, so it is masked
      // as it is typed and never shown again.
      sensitive: true,
      // Nothing is stored in this row: each Enter adds one addon to the list.
      read: () => "",
      summarize: (config) => {
        const count = readInstalledStremioAddons(config.stremioAddons).length;
        return count === 0 ? "none installed" : `${count} installed`;
      },
      apply: (config, value) => {
        if (!value.trim() || !stremioAddonsEnabled(config)) return config;
        const result = addStremioAddon(config.stremioAddons, value);
        return result.ok ? { ...config, stremioAddons: result.entries } : config;
      },
      validate: (value) => {
        if (!stremioAddonsEnabled(ctx.config)) {
          return "Experimental Stremio addons are off — enable them in the row above first.";
        }
        if (!value.trim()) return null;
        const result = addStremioAddon(ctx.config.stremioAddons, value);
        if (!result.ok) return result.reason;
        return result.added ? null : "That addon is already installed.";
      },
    },
    ...addons.map((addon): SettingRowDef => ({
      kind: "boolean",
      id: `stremioAddon:${addon.providerId}`,
      label: `Keep ${addon.displayName}`,
      detail: `${addon.host}: ${globallyOff ? `${STREMIO_ADDONS_DISABLED}. ` : ""}turn off to remove this addon and its place in your order. To pause it instead, use its provider switch.`,
      read: (config) => isStremioAddonInstalled(config.stremioAddons, addon.providerId),
      write: (config, value) => {
        if (!value) return removeStremioAddonFromConfig(config, addon.providerId);
        const result = addStremioAddon(config.stremioAddons, addon.manifestUrl, addon.entry.name);
        return result.ok ? { ...config, stremioAddons: result.entries } : config;
      },
    })),
    ...(waiting.length > 0 && !globallyOff
      ? [
          {
            kind: "status",
            id: "stremioAddonsRestart",
            label: "Restart Kunai to use new addons",
            detail: `Waiting for the next start: ${waiting.map((addon) => addon.displayName).join(", ")}`,
            tone: "info",
          } satisfies SettingRowDef,
        ]
      : []),
  ];
}
