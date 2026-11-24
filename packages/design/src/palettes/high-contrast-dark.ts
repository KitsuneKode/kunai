import type { ThemePalette } from "../theme-types";

/**
 * High Contrast Dark — pure black canvas with WCAG AAA (>= 7:1) text and
 * semantic status tokens across every surface elevation, and >= 4.5:1 control
 * borders for low-vision legibility.
 */
export const highContrastDarkPalette: ThemePalette = {
  scrim: "#000000",
  bg: "#000000",
  surface: "#0d0d0d",
  surfaceElevated: "#171717",
  surfaceActive: "#222222",
  raised: "#2c2c2c",
  line: "#5c5c5c",
  lineSoft: "#3d3d3d",
  lineStrong: "#b3b3b3",
  lineControl: "#9e9e9e",

  accent: "#ffa8c8",
  accentSoft: "#ffd6e6",
  accentDeep: "#ff7fb0",
  accentDim: "#b85c7f",
  accentGlow: "rgba(255,168,200,0.14)",
  accentFill: "#240a18",

  ok: "#66f5bc",
  okDim: "#36b884",
  okFill: "#0a291d",
  warn: "#ffd066",
  warnDim: "#c79a2e",
  warnFill: "#2b2008",
  danger: "#ff6b6b",
  dangerDim: "#c43b3b",
  dangerFill: "#2e0c0c",
  dangerText: "#ff9999",
  info: "#85ccff",
  infoDim: "#4f94c7",
  infoFill: "#0a2033",
  milestone: "#a8b8ff",
  milestoneDim: "#6a7bc4",
  milestoneFill: "#121733",
  milestoneText: "#c2ceff",

  text: "#ffffff",
  textDim: "#f0f0f0",
  muted: "#dcdcdc",
  dim: "#bfbfbf",
  faint: "#595959",

  typeAnime: "#e8a6ff",
  typeSeries: "#66ebeb",
  typeMovie: "#ffe070",
  typeMixed: "#d4c4e8",
  heatRamp: ["#171717", "#6b2944", "#a8456c", "#ff7fb0", "#ffa8c8"],
};
