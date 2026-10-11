import type { ThemePalette } from "../theme-types";

// Rosé Pine: the main (dark) variant. Muted violet surfaces, rose accent,
// foam/pine/gold/love/iris semantic hues, soft text ramp.
export const rosePinePalette: ThemePalette = {
  scrim: "#14121e",
  bg: "#191724", // base
  surface: "#1f1d2e", // surface
  surfaceElevated: "#26233a", // overlay
  surfaceActive: "#322c46", // rose-leaning selection band
  raised: "#403d52", // highlightMed
  line: "#403d52",
  lineSoft: "#26233a",
  lineStrong: "#524f67", // highlightHigh
  lineControl: "#6e6a86", // muted — 3:1 control edge

  accent: "#ebbcba", // rose
  accentSoft: "#f5d6cf",
  accentDeep: "#c89a9a",
  accentDim: "#7d5f62",
  accentGlow: "rgba(235,188,186,0.10)",
  accentFill: "#322534",

  ok: "#9ccfd8", // foam — the calm, positive signal
  okDim: "#6b95a0",
  okFill: "#1f3033",
  warn: "#f6c177", // gold
  warnDim: "#ad8a5a",
  warnFill: "#352a19",
  danger: "#eb6f92", // love
  dangerDim: "#a8526c",
  dangerFill: "#3a2028",
  dangerText: "#f0a2b6", // danger hue lifted for readable text
  info: "#6fa3bd", // lightened pine
  infoDim: "#48738a",
  infoFill: "#1c2830",
  milestone: "#c4a7e7", // iris
  milestoneDim: "#8a74a6",
  milestoneFill: "#2a2436",
  milestoneText: "#d9c4f2", // milestone hue lifted for readable text

  text: "#e0def4",
  textDim: "#c5c2dd",
  muted: "#908caa", // subtle
  dim: "#6e6a86", // muted
  faint: "#403d52",

  typeAnime: "#c4a7e7",
  typeSeries: "#9ccfd8",
  typeMovie: "#f6c177",
  typeMixed: "#908caa",
  heatRamp: ["#26233a", "#4a3a4a", "#8f5f6b", "#c89a9a", "#ebbcba"],
};
