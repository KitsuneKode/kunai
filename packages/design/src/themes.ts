import { catppuccinMochaPalette } from "./palettes/catppuccin-mocha";
import { draculaPalette } from "./palettes/dracula";
import { gruvboxPalette } from "./palettes/gruvbox";
import { highContrastDarkPalette } from "./palettes/high-contrast-dark";
import { highContrastLightPalette } from "./palettes/high-contrast-light";
import { kitsunebiPalette } from "./palettes/kitsunebi";
import { nordPalette } from "./palettes/nord";
import { paperSakuraPalette } from "./palettes/paper-sakura";
import { rosePinePalette } from "./palettes/rose-pine";
import { tokyoNightPalette } from "./palettes/tokyo-night";
import type { ThemeDef, ThemeName } from "./theme-types";
import { tokens as emberDuskPalette } from "./tokens";

export const DEFAULT_THEME_NAME: ThemeName = "ember-dusk";

/**
 * User-selectable surface palettes. `ember-dusk` is the brand canonical theme —
 * it lives in `tokens.ts` and stays the default; every other palette adapts a
 * known terminal theme or accessibility posture (light, high-contrast) to the
 * same semantic roles (accent = focus/selection, status hues, text ramp). The
 * color rules in `tokens.ts` still apply regardless of palette: color encodes
 * state or content-kind, never identity.
 */
export const THEMES = {
  "ember-dusk": {
    name: "ember-dusk",
    label: "Ember Dusk",
    detail: "Kunai brand theme — warm ink surfaces, rose accent",
    appearance: "dark",
    contrast: "standard",
    palette: emberDuskPalette,
  },
  "paper-sakura": {
    name: "paper-sakura",
    label: "Paper Sakura (Light)",
    detail: "Light washi surfaces, deep plum ink, rose accent — AA contrast",
    appearance: "light",
    contrast: "standard",
    palette: paperSakuraPalette,
  },
  "high-contrast-dark": {
    name: "high-contrast-dark",
    label: "High Contrast Dark",
    detail: "Pure black canvas, AAA text and status contrast, crisp borders",
    appearance: "dark",
    contrast: "high",
    palette: highContrastDarkPalette,
  },
  "high-contrast-light": {
    name: "high-contrast-light",
    label: "High Contrast Light",
    detail: "Pure white canvas, AAA text and status contrast, crisp borders",
    appearance: "light",
    contrast: "high",
    palette: highContrastLightPalette,
  },
  kitsunebi: {
    name: "kitsunebi",
    label: "Kitsunebi",
    detail: "Foxfire teal over warm lacquer — the sibling brand experiment",
    appearance: "dark",
    contrast: "standard",
    palette: kitsunebiPalette,
  },
  nord: {
    name: "nord",
    label: "Nord",
    detail: "Arctic blues, frost accent — the classic nordtheme palette",
    appearance: "dark",
    contrast: "standard",
    palette: nordPalette,
  },
  "tokyo-night": {
    name: "tokyo-night",
    label: "Tokyo Night",
    detail: "Deep indigo, signature blue — the tokyonight.nvim palette",
    appearance: "dark",
    contrast: "standard",
    palette: tokyoNightPalette,
  },
  "catppuccin-mocha": {
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    detail: "Pastel on the darkest Catppuccin flavour, mauve accent",
    appearance: "dark",
    contrast: "standard",
    palette: catppuccinMochaPalette,
  },
  dracula: {
    name: "dracula",
    label: "Dracula",
    detail: "Purple-grey surfaces, pink accent — the draculatheme palette",
    appearance: "dark",
    contrast: "standard",
    palette: draculaPalette,
  },
  "rose-pine": {
    name: "rose-pine",
    label: "Rosé Pine",
    detail: "Muted violets, rose accent — the Rosé Pine main variant",
    appearance: "dark",
    contrast: "standard",
    palette: rosePinePalette,
  },
  gruvbox: {
    name: "gruvbox",
    label: "Gruvbox",
    detail: "Warm retro groove — brown surfaces, signature orange accent",
    appearance: "dark",
    contrast: "standard",
    palette: gruvboxPalette,
  },
} satisfies Record<ThemeName, ThemeDef>;

export function listThemes(): readonly ThemeDef[] {
  return Object.values(THEMES);
}

export function isThemeName(value: string | null | undefined): value is ThemeName {
  return value !== null && value !== undefined && value in THEMES;
}
