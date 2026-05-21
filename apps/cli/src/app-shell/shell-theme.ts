import { tokens } from "@kunai/design";

import type { ShellStatus } from "./types";

// palette maps token values to the property names used throughout app-shell.
// Keys are stable for backward compatibility; values come from @kunai/design.
export const palette = {
  bg: tokens.bg,
  surface: tokens.surface,
  surfaceElevated: tokens.surfaceElevated,
  surfaceActive: tokens.surfaceActive,

  amber: tokens.amber,
  amberSoft: tokens.amberSoft,
  pink: tokens.pink,

  // teal replaces cyan — callers using palette.cyan still work via alias
  cyan: tokens.teal,
  teal: tokens.teal,

  // Informational blue — for badges, counts, and status display text
  info: tokens.info,
  infoDim: tokens.infoDim,

  // Discovery / recommendation accent
  lavender: tokens.lavender,

  // Series-complete milestone
  purple: tokens.purple,
  purpleDim: tokens.purpleDim,

  green: tokens.green,
  red: tokens.red,

  // gray kept as alias for dim — callers using palette.gray still work
  gray: tokens.dim,

  text: tokens.text,
  textDim: tokens.textDim,
  muted: tokens.muted,
  dim: tokens.dim,

  // Expanded surfaces + focus edge
  scrim: tokens.scrim,
  raised: tokens.raised,
  borderStrong: tokens.borderStrong,

  // Tinted fills (depth without loudness)
  amberFill: tokens.amberFill,
  tealFill: tokens.tealFill,
  infoFill: tokens.infoFill,
  pinkFill: tokens.pinkFill,
  lavenderFill: tokens.lavenderFill,
  greenFill: tokens.greenFill,
  yellowFill: tokens.yellowFill,
  redFill: tokens.redFill,
  purpleFill: tokens.purpleFill,
} as const;

export const APP_LABEL = "🦊 Kunai";

export function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success":
      return palette.green;
    case "warning":
      return palette.amber;
    case "error":
      return palette.red;
    case "info":
      return palette.info;
    default:
      return palette.teal;
  }
}

export function contentTintColor(kind: "anime" | "series" | "movie"): string {
  if (kind === "anime") return palette.pink;
  if (kind === "movie") return palette.lavender;
  return palette.info;
}

export function heatColor(rampIndex: number): string {
  const ramp = tokens.heatRamp;
  const clamped = Math.max(0, Math.min(ramp.length - 1, Math.trunc(rampIndex)));
  return ramp[clamped] ?? ramp[0];
}

export function hotkeyLabel(key: string): string {
  // "glyph§letter" sentinel: show only the glyph, no brackets or letter
  const sentinelIdx = key.indexOf("§");
  if (sentinelIdx !== -1) {
    return key.slice(0, sentinelIdx);
  }
  return `[${key}]`;
}
