import type { ThemePalette } from "../theme-types";

/**
 * Paper Sakura — Kunai's canonical light palette.
 *
 * Warm washi-paper surfaces with deep plum-ink text and a darkened sakura-rose
 * accent. Every readable text and semantic status token meets WCAG AA (>= 4.5:1)
 * and APCA body/label floors across all five surface elevations; `lineControl`
 * clears WCAG 1.4.11 (>= 3:1) on every control surface.
 */
export const paperSakuraPalette: ThemePalette = {
  scrim: "#e4d8e0",
  bg: "#faf6f8",
  surface: "#f2ebf0",
  surfaceElevated: "#e8dee6",
  surfaceActive: "#dfd2dc",
  raised: "#d6c6d3",
  line: "#c9b7c5",
  lineSoft: "#dfd3dc",
  lineStrong: "#8e798a",
  lineControl: "#6e5c6b",

  accent: "#9e1c4b",
  accentSoft: "#7d143a",
  accentDeep: "#b52659",
  accentDim: "#c96f8e",
  accentGlow: "rgba(158,28,75,0.10)",
  accentFill: "#f5dce6",

  ok: "#0c6642",
  okDim: "#2d8a64",
  okFill: "#dff2e9",
  warn: "#854700",
  warnDim: "#ab6919",
  warnFill: "#f7ead7",
  danger: "#c21f27",
  dangerDim: "#d95b62",
  dangerFill: "#fae1e3",
  dangerText: "#a81820",
  info: "#145ca8",
  infoDim: "#3a7ec2",
  infoFill: "#e1edf9",
  milestone: "#3e48b8",
  milestoneDim: "#6872d1",
  milestoneFill: "#e6e8fa",
  milestoneText: "#313a9e",

  text: "#1d161c",
  textDim: "#332932",
  muted: "#4a3e48",
  dim: "#5e505c",
  faint: "#c5b5c2",

  typeAnime: "#7a2c96",
  typeSeries: "#0d6b6b",
  typeMovie: "#7d5900",
  typeMixed: "#5c4a6b",
  heatRamp: ["#e8dee6", "#e0b3c4", "#cf7b9a", "#b52659", "#9e1c4b"],
};
