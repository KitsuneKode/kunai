import { catppuccinMochaPalette } from "./palettes/catppuccin-mocha";
import { draculaPalette } from "./palettes/dracula";
import { gruvboxPalette } from "./palettes/gruvbox";
import { kitsunebiPalette } from "./palettes/kitsunebi";
import { nordPalette } from "./palettes/nord";
import { rosePinePalette } from "./palettes/rose-pine";
import { tokyoNightPalette } from "./palettes/tokyo-night";
import type { ThemeDef, ThemeName } from "./theme-types";
import { tokens as emberDuskPalette } from "./tokens";

export const DEFAULT_THEME_NAME: ThemeName = "ember-dusk";

/**
 * User-selectable surface palettes. `ember-dusk` is the brand canonical theme —
 * it lives in `tokens.ts` and stays the default; every other palette adapts a
 * known terminal theme to the same semantic roles (accent = focus/selection,
 * status hues, text ramp). The color rules in `tokens.ts` still apply
 * regardless of palette: color encodes state or content-kind, never identity.
 */
export const THEMES: Record<ThemeName, ThemeDef> = {
  "ember-dusk": {
    name: "ember-dusk",
    label: "Ember Dusk",
    detail: "Kunai brand theme — warm ink surfaces, rose accent",
    palette: emberDuskPalette,
  },
  kitsunebi: {
    name: "kitsunebi",
    label: "Kitsunebi",
    detail: "Foxfire teal over warm lacquer — the sibling brand experiment",
    palette: kitsunebiPalette,
  },
  nord: {
    name: "nord",
    label: "Nord",
    detail: "Arctic blues, frost accent — the classic nordtheme palette",
    palette: nordPalette,
  },
  "tokyo-night": {
    name: "tokyo-night",
    label: "Tokyo Night",
    detail: "Deep indigo, signature blue — the tokyonight.nvim palette",
    palette: tokyoNightPalette,
  },
  "catppuccin-mocha": {
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    detail: "Pastel on the darkest Catppuccin flavour, mauve accent",
    palette: catppuccinMochaPalette,
  },
  dracula: {
    name: "dracula",
    label: "Dracula",
    detail: "Purple-grey surfaces, pink accent — the draculatheme palette",
    palette: draculaPalette,
  },
  "rose-pine": {
    name: "rose-pine",
    label: "Rosé Pine",
    detail: "Muted violets, rose accent — the Rosé Pine main variant",
    palette: rosePinePalette,
  },
  gruvbox: {
    name: "gruvbox",
    label: "Gruvbox",
    detail: "Warm retro groove — brown surfaces, signature orange accent",
    palette: gruvboxPalette,
  },
};

export function listThemes(): readonly ThemeDef[] {
  return Object.values(THEMES);
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && value in THEMES;
}

export function getThemeLabel(name: ThemeName): string {
  return THEMES[name].label;
}
