import { tokens } from "@kunai/design";

import type { ShellStatus } from "./types";

// palette maps token values to the property names used throughout app-shell.
// New code should prefer the SEMANTIC names (accent / ok / danger / line / …).
// The color-named keys below them are deprecated aliases kept so existing
// surfaces build during the Sakura migration (see .plans/sakura-rollout.md).
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

  // ---- DEPRECATED color-named aliases (migrate to semantic names) ----
  amber: tokens.amber, // → accent
  amberSoft: tokens.amberSoft, // → accentSoft
  pink: tokens.pink, // → typeAnime (Stats) / drop elsewhere
  cyan: tokens.teal, // → accent (focus) / muted (info)
  teal: tokens.teal, // → accent (focus) / muted (info)
  info: tokens.info, // → muted
  infoDim: tokens.infoDim, // → dim
  lavender: tokens.lavender, // → muted
  purple: tokens.purple, // → milestone
  purpleDim: tokens.purpleDim, // → milestoneDim
  green: tokens.green, // → ok
  red: tokens.red, // → danger
  gray: tokens.dim, // → dim
  borderStrong: tokens.borderStrong, // → lineStrong

  // deprecated tinted fills
  amberFill: tokens.amberFill, // → accentFill
  tealFill: tokens.tealFill, // → okFill
  infoFill: tokens.infoFill, // → surfaceElevated
  pinkFill: tokens.pinkFill, // → accentFill
  lavenderFill: tokens.lavenderFill, // → surfaceElevated
  greenFill: tokens.greenFill, // → okFill
  yellowFill: tokens.yellowFill, // → accentFill
  redFill: tokens.redFill, // → dangerFill
  purpleFill: tokens.purpleFill, // → milestoneFill
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
