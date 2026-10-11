import type { ThemePalette } from "../theme-types";

// Gruvbox dark (medium contrast): warm retro groove. Brown-grey surface
// ladder, signature orange accent, earthy status hues, cream text ramp.
export const gruvboxPalette: ThemePalette = {
  scrim: "#1d2021", // bg0_h
  bg: "#282828", // bg0
  surface: "#32302f",
  surfaceElevated: "#3c3836", // bg1
  surfaceActive: "#453a30", // orange-leaning selection band
  raised: "#504945", // bg2
  line: "#504945",
  lineSoft: "#3c3836",
  lineStrong: "#665c54", // bg3
  lineControl: "#7c6f64", // bg4 — 3:1 control edge

  accent: "#fe8019", // bright orange
  accentSoft: "#ffbd8a",
  accentDeep: "#d65d0e", // neutral orange
  accentDim: "#8a4a26",
  accentGlow: "rgba(254,128,25,0.10)",
  accentFill: "#3a2a1c",

  ok: "#b8bb26", // green
  okDim: "#8a8c1e",
  okFill: "#2c2c14",
  warn: "#fabd2f", // yellow
  warnDim: "#b88a24",
  warnFill: "#38300f",
  danger: "#fb4934", // red
  dangerDim: "#b83526",
  dangerFill: "#3c1c16",
  dangerText: "#ff8a76", // danger hue lifted for readable text
  info: "#83a598", // blue
  infoDim: "#5b7a70",
  infoFill: "#1f2b28",
  milestone: "#d3869b", // purple
  milestoneDim: "#94596e",
  milestoneFill: "#332027",
  milestoneText: "#e6b3c4", // milestone hue lifted for readable text

  text: "#ebdbb2", // fg1
  textDim: "#d5c4a1", // fg2
  muted: "#bdae93", // fg3
  dim: "#928374", // gray
  faint: "#504945",

  typeAnime: "#d3869b",
  typeSeries: "#8ec07c", // aqua
  typeMovie: "#fabd2f",
  typeMixed: "#a89984", // fg4
  heatRamp: ["#3c3836", "#5e402a", "#8a4a26", "#d65d0e", "#fe8019"],
};
