import type { ThemePalette } from "../theme-types";

// Tokyo Night: the night variant of the tokyonight.nvim palette. Deep indigo
// surfaces, signature blue accent, bright but low-noise status hues.
export const tokyoNightPalette: ThemePalette = {
  scrim: "#15161e",
  bg: "#1a1b26",
  surface: "#24283b",
  surfaceElevated: "#292e42",
  surfaceActive: "#334166", // blue-tinted selection band
  raised: "#3b4261",
  line: "#3b4261",
  lineSoft: "#292e42",
  lineStrong: "#545c7e",
  lineControl: "#737aa2", // dark5 — 3:1 control edge

  accent: "#7aa2f7",
  accentSoft: "#b4c6fa",
  accentDeep: "#5d84d6",
  accentDim: "#3d5a9e",
  accentGlow: "rgba(122,162,247,0.10)",
  accentFill: "#1f2742",

  ok: "#9ece6a",
  okDim: "#73994e",
  okFill: "#23331f",
  warn: "#e0af68",
  warnDim: "#a8834e",
  warnFill: "#35291a",
  danger: "#f7768e",
  dangerDim: "#b05668",
  dangerFill: "#3a2028",
  dangerText: "#ffa1ae", // danger hue lifted for readable text
  info: "#7dcfff",
  infoDim: "#4fa3d4",
  infoFill: "#1c2c3d",
  milestone: "#bb9af7",
  milestoneDim: "#836bb0",
  milestoneFill: "#2b2340",
  milestoneText: "#d1bcfb", // milestone hue lifted for readable text

  text: "#c0caf5",
  textDim: "#a9b1d6",
  muted: "#8a93b8",
  dim: "#565f89",
  faint: "#3b4261",

  typeAnime: "#bb9af7",
  typeSeries: "#7dcfff",
  typeMovie: "#e0af68",
  typeMixed: "#9aa2cc",
  heatRamp: ["#292e42", "#3d4570", "#4e62b0", "#5d84d6", "#7aa2f7"],
};
