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
  warn: tokens.warn, // caution · in-flight · aired-not-confirmed
  warnDim: tokens.warnDim,
  warnFill: tokens.warnFill,
  danger: tokens.danger, // real, actionable error
  dangerDim: tokens.dangerDim,
  dangerFill: tokens.dangerFill,
  info: tokens.info, // neutral-positive signal · cool counterweight
  infoDim: tokens.infoDim,
  infoFill: tokens.infoFill,
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
      return palette.warn;
    case "error":
      return palette.danger;
    case "info":
      return palette.info;
    default:
      return palette.muted;
  }
}

export function contentTintColor(kind: "anime" | "series" | "movie" | "video"): string {
  // Media-type hue is allowed only where type is the data (Stats). Other
  // surfaces should keep rows neutral and let weight carry hierarchy.
  if (kind === "anime") return palette.typeAnime;
  if (kind === "movie") return palette.typeMovie;
  if (kind === "video") return palette.accent;
  return palette.typeSeries;
}

type Rgb = readonly [number, number, number];

function parseHexColor(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const n = Number.parseInt(value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function formatHexColor([r, g, b]: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function mixRgb(left: Rgb, right: Rgb, ratio: number): Rgb {
  const t = Math.max(0, Math.min(1, ratio));
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ];
}

function mixHexColors(leftHex: string, rightHex: string, ratio: number): string {
  return formatHexColor(mixRgb(parseHexColor(leftHex), parseHexColor(rightHex), ratio));
}

/** Stats-only paint-mix: intensity ramp brightness × media-type hue identity. */
export function statsHeatCellColor(intensityIndex: number, tintHex: string): string {
  if (intensityIndex <= 0) return heatColor(0);
  const intensity = heatColor(intensityIndex);
  const mixRatio = 0.28 + (intensityIndex / 4) * 0.52;
  return mixHexColors(tintHex, intensity, mixRatio);
}

export function resolveStatsTintColor(input: {
  readonly kindFilter: "all" | "anime" | "series" | "movie" | "video";
  readonly mix: {
    readonly anime: number;
    readonly series: number;
    readonly movie: number;
    readonly video: number;
  } | null;
}): string {
  if (input.kindFilter !== "all") return contentTintColor(input.kindFilter);
  if (!input.mix) return palette.typeMixed;
  const total = input.mix.anime + input.mix.series + input.mix.movie + input.mix.video;
  if (total <= 0) return heatColor(0);
  const activeKinds = [
    input.mix.anime > 0,
    input.mix.series > 0,
    input.mix.movie > 0,
    input.mix.video > 0,
  ].filter(Boolean).length;
  if (activeKinds >= 2) {
    let blended = parseHexColor(palette.typeAnime);
    blended = mixRgb(blended, parseHexColor(palette.typeSeries), input.mix.series / total);
    blended = mixRgb(blended, parseHexColor(palette.typeMovie), input.mix.movie / total);
    blended = mixRgb(blended, parseHexColor(palette.accent), input.mix.video / total);
    return formatHexColor(blended);
  }
  if (input.mix.anime > 0) return palette.typeAnime;
  if (input.mix.series > 0) return palette.typeSeries;
  if (input.mix.video > 0) return palette.accent;
  return palette.typeMovie;
}

export function heatColor(rampIndex: number): string {
  const ramp = tokens.heatRamp;
  const clamped = Math.max(0, Math.min(ramp.length - 1, Math.trunc(rampIndex)));
  return ramp[clamped] ?? ramp[0];
}

export type SemanticTone = "neutral" | "info" | "success" | "warning" | "error";

/**
 * Single authority for tone → color across inline UI (badges, context strips,
 * section headers, detail lines). Restores the full semantic palette instead of
 * the old per-component maps that collapsed `info` to grey and mis-mapped
 * `warning` to rose. `info` is the cool counterweight; `warning` is amber.
 */
export function semanticToneColor(tone: SemanticTone | undefined): string {
  switch (tone) {
    case "info":
      return palette.info;
    case "success":
      return palette.ok;
    case "warning":
      return palette.warn;
    case "error":
      return palette.danger;
    default:
      return palette.muted;
  }
}

export function hotkeyLabel(key: string): string {
  // "glyph§letter" sentinel: show only the glyph, no brackets or letter
  const sentinelIdx = key.indexOf("§");
  if (sentinelIdx !== -1) {
    return key.slice(0, sentinelIdx);
  }
  return `[${key}]`;
}
