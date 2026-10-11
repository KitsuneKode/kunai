import type { ThemePalette } from "../theme-types";

// Catppuccin Mocha: the darkest Catppuccin flavour. Base/mantle/crust surface
// ladder, mauve accent, pastel status hues, lavender text ramp.
export const catppuccinMochaPalette: ThemePalette = {
  scrim: "#11111b", // crust
  bg: "#1e1e2e", // base
  surface: "#313244", // surface0
  surfaceElevated: "#45475a", // surface1
  surfaceActive: "#3d3654", // mauve-tinted selection band
  raised: "#585b70", // surface2
  line: "#45475a",
  lineSoft: "#313244",
  lineStrong: "#6c7086", // overlay0
  lineControl: "#9399b2", // overlay2 — 3:1 control edge

  accent: "#cba6f7", // mauve
  accentSoft: "#e3cbf9",
  accentDeep: "#a881d6",
  accentDim: "#6f5590",
  accentGlow: "rgba(203,166,247,0.10)",
  accentFill: "#2d2640",

  ok: "#a6e3a1", // green
  okDim: "#7aa878",
  okFill: "#243321",
  warn: "#f9e2af", // yellow
  warnDim: "#b5a482",
  warnFill: "#372f1d",
  danger: "#f38ba8", // red
  dangerDim: "#b0657a",
  dangerFill: "#3b2330",
  dangerText: "#f8b4c6", // danger hue lifted for readable text
  info: "#89b4fa", // blue
  infoDim: "#5f83c2",
  infoFill: "#232d45",
  milestone: "#b4befe", // lavender
  milestoneDim: "#7f86b8",
  milestoneFill: "#2a2c42",
  milestoneText: "#ccd2ff", // milestone hue lifted for readable text

  text: "#cdd6f4",
  textDim: "#bac2de", // subtext1
  muted: "#a6adc8", // subtext0
  dim: "#7f849c", // overlay1
  faint: "#585b70",

  typeAnime: "#f5c2e7", // pink
  typeSeries: "#94e2d5", // teal
  typeMovie: "#f9e2af",
  typeMixed: "#a6adc8",
  heatRamp: ["#313244", "#4c4470", "#7a63c0", "#a881d6", "#cba6f7"],
};
