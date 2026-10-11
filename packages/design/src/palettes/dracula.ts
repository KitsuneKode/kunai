import type { ThemePalette } from "../theme-types";

// Dracula: the classic dark theme (draculatheme.com). Cool purple-grey
// surfaces, signature pink accent, saturated status hues, comment-blue dim.
export const draculaPalette: ThemePalette = {
  scrim: "#1e1f29",
  bg: "#282a36",
  surface: "#343746",
  surfaceElevated: "#44475a", // "current line"
  surfaceActive: "#493b55", // purple-leaning selection band
  raised: "#565b70",
  line: "#44475a",
  lineSoft: "#343746",
  lineStrong: "#6272a4", // comment

  accent: "#ff79c6", // pink
  accentSoft: "#ffadd9",
  accentDeep: "#d660a4",
  accentDim: "#8f4a74",
  accentGlow: "rgba(255,121,198,0.10)",
  accentFill: "#3d2a3c",

  ok: "#50fa7b", // green
  okDim: "#3cb85e",
  okFill: "#233524",
  warn: "#ffb86c", // orange
  warnDim: "#b88550",
  warnFill: "#3a2d1e",
  danger: "#ff5555", // red
  dangerDim: "#b83f3f",
  dangerFill: "#3a2226",
  info: "#8be9fd", // cyan
  infoDim: "#5fafc2",
  infoFill: "#23323f",
  milestone: "#bd93f9", // purple
  milestoneDim: "#8569b0",
  milestoneFill: "#30294a",

  text: "#f8f8f2",
  textDim: "#d9d9ce",
  muted: "#a9abbd",
  dim: "#6272a4",
  faint: "#44475a",

  typeAnime: "#ff79c6",
  typeSeries: "#8be9fd",
  typeMovie: "#f1fa8c", // yellow
  typeMixed: "#a9abbd",
  heatRamp: ["#343746", "#53395c", "#8f4a74", "#d660a4", "#ff79c6"],
};
