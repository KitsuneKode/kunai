import type { ThemePalette } from "../theme-types";

// Nord: arctic, north-bluish palette (nordtheme.com). Polar Night surfaces,
// Frost accent and selection, Aurora status hues, Snow Storm text.
export const nordPalette: ThemePalette = {
  scrim: "#242933",
  bg: "#2e3440", // nord0
  surface: "#3b4252", // nord1
  surfaceElevated: "#434c5e", // nord2
  surfaceActive: "#3d4c66", // selection band, leans toward frost
  raised: "#4c566a", // nord3
  line: "#4c566a",
  lineSoft: "#3b4252",
  lineStrong: "#616e88",

  accent: "#88c0d0", // nord8 frost
  accentSoft: "#a5d2de",
  accentDeep: "#6aa6b8",
  accentDim: "#4e6e7c",
  accentGlow: "rgba(136,192,208,0.10)",
  accentFill: "#2f3d49",

  ok: "#a3be8c", // nord14 aurora
  okDim: "#7a9568",
  okFill: "#2e3a30",
  warn: "#ebcb8b", // nord13 aurora
  warnDim: "#a8946a",
  warnFill: "#3a3527",
  danger: "#bf616a", // nord11 aurora
  dangerDim: "#8f4a52",
  dangerFill: "#382a2e",
  info: "#81a1c1", // nord9 frost
  infoDim: "#5e81ac", // nord10
  infoFill: "#2a3240",
  milestone: "#b48ead", // nord15 aurora
  milestoneDim: "#846a80",
  milestoneFill: "#332e3a",

  text: "#eceff4", // nord6
  textDim: "#d8dee9", // nord4
  muted: "#a8b0c0",
  dim: "#7b8699",
  faint: "#4c566a",

  typeAnime: "#b48ead",
  typeSeries: "#8fbcbb", // nord7
  typeMovie: "#ebcb8b",
  typeMixed: "#9ea7bb",
  heatRamp: ["#3b4252", "#4a5d73", "#5e87a0", "#6aa6b8", "#88c0d0"],
};
