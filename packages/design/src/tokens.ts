export const tokens = {
  // Backgrounds — warm-black surface scale
  // Tinted toward amber for cohesion; never pure neutral
  scrim: "#0a0806",
  bg: "#110e0b",
  surface: "#1a1612",
  surfaceElevated: "#241e18",
  surfaceActive: "#2e251e",
  raised: "#3a2f24",
  border: "#332a22",
  borderDim: "#1e1a15",
  borderStrong: "#4a3d30",

  // Primary brand — fox amber, slightly desaturated for premium feel
  amber: "#f0a050",
  amberSoft: "#ffbf80",
  amberDim: "#7a4a10",
  amberGlow: "rgba(240,160,80,0.10)",

  // Anime / secondary accent — hot pink, used sparingly
  pink: "#ff4d8a",
  pinkSoft: "#ff85aa",
  pinkDim: "#7a1538",
  pinkGlow: "rgba(255,77,138,0.10)",

  // Status — muted teal, less neon than before
  teal: "#5ad4b5",
  tealDim: "#1e6050",
  green: "#7bc96e",
  greenDim: "#2a5a22",
  red: "#ff6666",
  yellow: "#f0c850",

  // Informational — quieter blue, recedes when not needed
  info: "#6a9fd8",
  infoDim: "#2a4468",

  // Discovery / recommendation accent — soft violet
  lavender: "#c4b5e8",
  lavenderDim: "#4e4068",

  // Series-complete milestone — never reuse for any other purpose
  purple: "#a855f7",
  purpleDim: "#4c1d95",

  // Text scale — warm cream, softer at extremes
  text: "#e8ddd0",
  textDim: "#c8bba8",
  muted: "#95887a",
  dim: "#5c5248",
  faint: "#3c342c",

  // Tinted fills — each accent pre-blended onto bg; terminal stand-in for
  // opacity, giving badges/selection depth without going loud
  amberFill: "#2a2012",
  tealFill: "#13241f",
  infoFill: "#15243a",
  pinkFill: "#2a1420",
  lavenderFill: "#20203a",
  greenFill: "#16261a",
  yellowFill: "#2a2410",
  redFill: "#2e1717",
  purpleFill: "#2a1c3a",

  // Watch-activity heat ramp — amber, 5-step (matches brand; green stays
  // reserved for success state)
  heatRamp: ["#2a2018", "#7a4a10", "#b06a18", "#d68a24", "#f0a050"],
} as const;

export type TokenName = keyof typeof tokens;
export type TokenValue = (typeof tokens)[TokenName];
