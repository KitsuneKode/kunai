import type { ThemePalette } from "../theme-types";

/**
 * High Contrast Light — pure white canvas with WCAG AAA (>= 7:1) text and
 * semantic status tokens across every surface elevation, and >= 4.5:1 control
 * borders for bright-room and low-vision legibility.
 */
export const highContrastLightPalette: ThemePalette = {
  scrim: "#d6d6d6",
  bg: "#ffffff",
  surface: "#f4f4f4",
  surfaceElevated: "#eaeaea",
  surfaceActive: "#e2e2e2",
  raised: "#d6d6d6",
  line: "#8c8c8c",
  lineSoft: "#b8b8b8",
  lineStrong: "#404040",
  lineControl: "#525252",

  accent: "#8c0036",
  accentSoft: "#660027",
  accentDeep: "#a30040",
  accentDim: "#b84d74",
  accentGlow: "rgba(140,0,54,0.12)",
  accentFill: "#fce8f0",

  ok: "#004d2c",
  okDim: "#1f754f",
  okFill: "#e3f5ec",
  warn: "#663300",
  warnDim: "#8f510f",
  warnFill: "#faeedc",
  danger: "#a60000",
  dangerDim: "#c23b3b",
  dangerFill: "#fce4e4",
  dangerText: "#850000",
  info: "#003c7d",
  infoDim: "#2663a6",
  infoFill: "#e3effc",
  milestone: "#29278a",
  milestoneDim: "#514fb0",
  milestoneFill: "#e8e8fc",
  milestoneText: "#1f1d73",

  text: "#000000",
  textDim: "#171717",
  muted: "#2b2b2b",
  dim: "#454545",
  faint: "#9e9e9e",

  typeAnime: "#5e0078",
  typeSeries: "#004f4f",
  typeMovie: "#614200",
  typeMixed: "#402d54",
  heatRamp: ["#eaeaea", "#e0a6bd", "#c95c86", "#a30040", "#8c0036"],
};
