import { detectTerminalColorLevel, resolveDesignTokens } from "./color-resolution";
import type { ThemeName } from "./theme-types";
import { DEFAULT_THEME_NAME, THEMES, isThemeName } from "./themes";

export { detectTerminalColorLevel, resolveDesignTokens } from "./color-resolution";
export type {
  ResolvedDesignTokens,
  ResolvedHeatRamp,
  ResolvedTokenValue,
  TerminalColorEnv,
  TerminalColorLevel,
} from "./color-resolution";
export { DEFAULT_THEME_NAME, THEMES, getThemeLabel, isThemeName, listThemes } from "./themes";
export type { ThemeDef, ThemeName, ThemePalette } from "./theme-types";
export { tokens as rawTokens } from "./tokens";
export type { TokenName, TokenValue } from "./tokens";

import type { ResolvedDesignTokens } from "./color-resolution";

const detectedLevel = detectTerminalColorLevel();
let activeThemeName: ThemeName = DEFAULT_THEME_NAME;

// `tokens` is a live view, not a snapshot: setDesignTheme rewrites the same
// object in place, so modules that imported it once still read the active
// palette on their next render. The key set is identical across themes, so an
// in-place update can never leave a stale key behind.
const resolvedBox: ResolvedDesignTokens = resolveDesignTokens(detectedLevel);

export const tokens: ResolvedDesignTokens = resolvedBox;

export function getDesignThemeName(): ThemeName {
  return activeThemeName;
}

/**
 * Swap the active palette. Every existing `tokens.x` / `palette.x` read sees
 * the new values on the next Ink frame — no reload, no import churn. Returns
 * false on an unrecognized name (hand-edited config values included) and keeps
 * the current theme rather than failing hard.
 */
export function setDesignTheme(name: string | null | undefined): boolean {
  if (!isThemeName(name)) return false;
  const next = resolveDesignTokens(detectedLevel, THEMES[name].palette);
  Object.assign(resolvedBox, next);
  activeThemeName = name;
  return true;
}
