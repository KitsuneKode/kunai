import { tokens } from "@kunai/design";

import type { ShellStatus } from "./types";

// palette maps token values to the semantic property names used throughout
// app-shell (accent / ok / danger / line / …). Color encodes state or focus,
// never identity — see .docs/design-system.md.
export const palette = {
  // ---- surfaces ----
  bg: tokens.bg,
  surface: tokens.surface,
  surfaceElevated: tokens.surfaceElevated,
  surfaceActive: tokens.surfaceActive,
  scrim: tokens.scrim,
  raised: tokens.raised,
  line: tokens.line,
  lineSoft: tokens.lineSoft,
  lineStrong: tokens.lineStrong,

  // ---- semantic accents (prefer these) ----
  accent: tokens.accent, // focus · selection · brand · in-progress
  accentSoft: tokens.accentSoft,
  accentDeep: tokens.accentDeep, // progress fill
  accentDim: tokens.accentDim,
  accentFill: tokens.accentFill,
  ok: tokens.ok, // ready · complete · available
  okDim: tokens.okDim,
  okFill: tokens.okFill,
  danger: tokens.danger, // real, actionable error
  dangerDim: tokens.dangerDim,
  dangerFill: tokens.dangerFill,
  milestone: tokens.milestone, // series-complete only
  milestoneDim: tokens.milestoneDim,

  // ---- media-type hues (Stats surface only) ----
  typeAnime: tokens.typeAnime,
  typeSeries: tokens.typeSeries,
  typeMovie: tokens.typeMovie,
  typeMixed: tokens.typeMixed,

  // ---- text ramp ----
  text: tokens.text,
  textDim: tokens.textDim,
  muted: tokens.muted,
  dim: tokens.dim,
} as const;

export const APP_LABEL = "🦊 Kunai";

export function statusColor(tone: ShellStatus["tone"] = "neutral"): string {
  switch (tone) {
    case "success":
      return palette.ok;
    case "warning":
      return palette.accentDeep;
    case "error":
      return palette.danger;
    case "info":
      return palette.muted;
    default:
      return palette.muted;
  }
}

export function contentTintColor(kind: "anime" | "series" | "movie"): string {
  // Media-type hue is allowed only where type is the data (Stats). Other
  // surfaces should keep rows neutral and let weight carry hierarchy.
  if (kind === "anime") return palette.typeAnime;
  if (kind === "movie") return palette.typeMovie;
  return palette.typeSeries;
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
