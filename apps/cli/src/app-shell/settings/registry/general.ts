import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { appearanceSettingsRows } from "./appearance";
import { discoverSettingsRows } from "./discover";
import { languageSettingsRows } from "./language";
import { FOOTER_HINT_OPTIONS } from "./shared";

const DEFAULT_MODE_OPTIONS = [
  { value: "series", label: "Series mode", detail: "Browse movies and TV on launch" },
  { value: "anime", label: "Anime mode", detail: "Browse anime on launch" },
  { value: "youtube", label: "YouTube mode", detail: "Browse and play YouTube on launch" },
] as const;

export function generalSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:general",
      label: "General",
      tabLabel: "General",
      detail: "Startup, appearance, language, and discover preferences",
    },
    {
      kind: "subheading",
      id: "subheading:startup-shell",
      label: "Startup & Shell",
    },
    {
      kind: "enum",
      id: "defaultMode",
      label: "Default startup mode",
      detail: "First catalog after launch: series, anime, or YouTube",
      options: DEFAULT_MODE_OPTIONS,
      presentation: "submenu",
      read: (config) => config.defaultMode,
      write: (config, value) => {
        if (value === "anime" || value === "youtube" || value === "series") {
          return { ...config, defaultMode: value };
        }
        return { ...config, defaultMode: "series" };
      },
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
    ...appearanceSettingsRows(ctx),
    {
      kind: "boolean",
      id: "companionPet",
      label: "Mascot & tips",
      detail: "Show Kanna on empty and error screens — off hides her until /pet or this setting",
      read: (config) => config.companionPet !== "off",
      write: (config, value) => ({ ...config, companionPet: value ? "auto" : "off" }),
    },
    {
      kind: "boolean",
      id: "tipsEnabled",
      label: "Shortcut tips",
      detail:
        "One-line hints that teach the direct key after you reach something through the palette — each shows once, ever",
      read: (config) => config.tipsEnabled,
      write: (config, value) => ({ ...config, tipsEnabled: value }),
    },
    {
      kind: "action",
      id: "resetTips",
      configKeys: ["seenTips"],
      label: "Reset tips",
      detail: "Let already-shown once-ever shortcut tips teach once more",
      run: async (actionCtx) => {
        const count = actionCtx.container.config.seenTips.length;
        if (count === 0) {
          return "No shortcut tips have been shown yet.";
        }
        await actionCtx.container.config.update({ seenTips: [] });
        await actionCtx.container.config.save();
        return `Reset ${count} shortcut ${count === 1 ? "tip" : "tips"} — each will show once more.`;
      },
    },
    ...languageSettingsRows(ctx),
    ...discoverSettingsRows(ctx),
  ];
}
