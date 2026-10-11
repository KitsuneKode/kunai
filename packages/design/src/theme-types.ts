import type { TokenName } from "./tokens";

/**
 * A complete set of raw (truecolor) values for every design token. The shape is
 * derived from `TokenName`, so adding a token in `tokens.ts` makes every
 * palette that lacks it a compile error — palette drift is a type error, not
 * a convention.
 */
export type ThemePalette = Record<Exclude<TokenName, "heatRamp">, string> & {
  readonly heatRamp: readonly [string, string, string, string, string];
};

/** Theme ids are stable config values — rename only with a config migration. */
export const THEME_NAMES = [
  "ember-dusk",
  "kitsunebi",
  "nord",
  "tokyo-night",
  "catppuccin-mocha",
  "dracula",
  "rose-pine",
  "gruvbox",
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export interface ThemeDef {
  readonly name: ThemeName;
  readonly label: string;
  readonly detail: string;
  readonly palette: ThemePalette;
}
