export const tokens = {
  // Backgrounds — 4-step warm-black surface scale
  bg: "#0e0b08",
  surface: "#181310",
  surfaceElevated: "#221c16",
  surfaceActive: "#2c231a",
  border: "#2e2520",
  borderDim: "#1e1a15",

  // Primary brand — fox amber
  amber: "#ff9c3a",
  amberSoft: "#ffb870",
  amberDim: "#7a4600",
  amberGlow: "rgba(255,156,58,0.11)",

  // Anime / secondary accent — hot pink
  pink: "#ff3d82",
  pinkSoft: "#ff7aaa",
  pinkDim: "#7a1038",
  pinkGlow: "rgba(255,61,130,0.11)",

  // Status
  teal: "#3de0c4",
  tealDim: "#1a5a4c",
  green: "#7fd46b",
  greenDim: "#2a5a22",
  red: "#ff5a5a",
  yellow: "#f5c842",

  // Informational — soft blue for badges, counts, and status text
  info: "#5a9cf5",
  infoDim: "#2a4070",

  // Discovery / recommendation accent — soft violet
  lavender: "#b8a9e8",
  lavenderDim: "#4a3d6a",

  // Text scale — 5 steps for hierarchy
  text: "#f0e6d9",
  textDim: "#c4b5a5",
  muted: "#8a7d70",
  dim: "#5a504a",
  faint: "#3a322c",
} as const;

export type TokenName = keyof typeof tokens;
export type TokenValue = (typeof tokens)[TokenName];
