import { tokens } from "@kunai/design";

import type { ShellStatus } from "./types";

// palette maps token values to the property names used throughout app-shell.
// Keys are stable for backward compatibility; values come from @kunai/design.
export const palette = {
  bg:              tokens.bg,
  surface:         tokens.surface,
  surfaceElevated: tokens.surfaceElevated,
  surfaceActive:   tokens.surfaceActive,

  amber: tokens.amber,
  pink:  tokens.pink,

  // teal replaces cyan — callers using palette.cyan still work via alias
  cyan:  tokens.teal,
  teal:  tokens.teal,

  green: tokens.green,
  red:   tokens.red,
  rose:  tokens.amberSoft,

  // gray kept as alias for dim — callers using palette.gray still work
  gray:  tokens.dim,

  text:  tokens.text,
  muted: tokens.muted,
  dim:   tokens.dim,
} as const;

export const APP_LABEL = "🥷 Kunai beta";

export function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success": return palette.green;
    case "warning": return palette.amber;
    case "error":   return palette.red;
    default:        return palette.teal;
  }
}

export function hotkeyLabel(key: string): string {
  return `[${key}]`;
}
