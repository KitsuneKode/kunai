import type { ThemePalette } from "../theme-types";

// Kitsunebi (狐火): warm lacquer surfaces, pale hinoki text, one cool foxfire
// accent. Generated in OKLCH at matched lightness per role and measured with
// APCA (Lc).
export const kitsunebiPalette: ThemePalette = {
  // Surface scale: one warm hue, even steps.
  scrim: "#090504",
  bg: "#120a07",
  surface: "#1f1411",
  surfaceElevated: "#2c1f1c",
  surfaceActive: "#143737", // selected band, leans toward the accent
  raised: "#42332e",
  line: "#4b3c37",
  lineSoft: "#352823",
  lineStrong: "#66534e",

  // Brand, focus, selection: foxfire.
  accent: "#3ed6d9", // Lc 70
  accentSoft: "#b1ebeb",
  accentDeep: "#2ea5a7",
  accentDim: "#296263",
  accentGlow: "rgba(62,214,217,0.10)",
  accentFill: "#022627",

  // Status. Each has a dim step and a fill.
  ok: "#4cdf70", // Lc 71
  okDim: "#479b57",
  okFill: "#142517",
  warn: "#f6ac56", // Lc 66
  warnDim: "#ad7a40",
  warnFill: "#2b1d0d",
  danger: "#f76d5a", // Lc 47
  dangerDim: "#a93628",
  dangerFill: "#351612",
  info: "#8db1f4", // Lc 60
  infoDim: "#4075db",
  infoFill: "#162034",
  milestone: "#bb89f2", // Lc 51
  milestoneDim: "#6c329e",
  milestoneFill: "#251b32",

  // Text ramp.
  text: "#f5f0e3", // Lc 98
  textDim: "#d2cdbf", // Lc 76
  muted: "#b9b3a4", // Lc 61
  dim: "#9d9788", // Lc 46
  faint: "#3c382c", // decorative only

  // Content kind (Stats and Calendar) and the heat ramp.
  typeAnime: "#f69fc5",
  typeSeries: "#68ccf5",
  typeMovie: "#e1cc49",
  typeMixed: "#a496bf",
  heatRamp: ["#2c1f1c", "#314e4e", "#357879", "#2ea5a7", "#3ed6d9"],
};
