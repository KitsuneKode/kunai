// Kunai design tokens — "Ember Dusk" theme.
//
// A near-neutral warm-ink surface ramp (so accents are the only color and
// elevation reads), a rose accent reserved for brand/focus/selection, and a
// spread of distinct semantic + content hues. Nine hues sit roughly evenly
// around the wheel — rose, red, orange, gold, green, teal, blue, indigo,
// orchid — so every signal is its own color. The cool info-blue is the
// deliberate temperature counterweight to the warm dusk.
//
// THE ONE RULE: color encodes state, focus, or content-kind — never identity
// for its own sake. Titles win by weight, not hue. Provider, audio language,
// and episode codes stay muted text. Media-type hue (anime/series/movie) is
// allowed where type is the data: the Stats surface and the Calendar surface.
//
// Brand authority: .reference/design/brand/kunai-brand-system.md (Ember Dusk token table).

// ---- raw palette (these semantic consts are the source of truth) ----

// Surface scale — warm ink, near-neutral, clear elevation steps.
// Kitsunebi (狐火): warm lacquer surfaces, pale hinoki text, one cool foxfire accent.
// Generated in OKLCH at matched lightness per role and measured with APCA (Lc).

// Surface scale: one warm hue, even steps.
const scrim = "#090504";
const bg = "#120a07";
const surface = "#1f1411";
const surfaceElevated = "#2c1f1c";
const surfaceActive = "#143737"; // selected band, leans toward the accent
const raised = "#42332e";
const line = "#4b3c37";
const lineSoft = "#352823";
const lineStrong = "#66534e";

// Brand, focus, selection: foxfire.
const accent = "#3ed6d9"; // Lc 70
const accentSoft = "#b1ebeb";
const accentDeep = "#2ea5a7";
const accentDim = "#296263";
const accentFill = "#022627";
const accentGlow = "rgba(62,214,217,0.10)";

// Status. Each has a dim step and a fill; danger and milestone also get a text role.
const ok = "#4cdf70"; // Lc 71
const okDim = "#479b57";
const okFill = "#142517";
const warn = "#f6ac56"; // Lc 66
const warnDim = "#ad7a40";
const warnFill = "#2b1d0d";
const danger = "#f76d5a"; // Lc 47
const dangerDim = "#a93628";
const dangerFill = "#351612";
const info = "#8db1f4"; // Lc 60
const infoDim = "#4075db";
const infoFill = "#162034";
const milestone = "#bb89f2"; // Lc 51
const milestoneDim = "#6c329e";
const milestoneFill = "#251b32";
const dangerText = "#f99c8d"; // alarm text on its fill, Lc 60
const milestoneText = "#caa5f5"; // milestone text on its fill, Lc 60

// Text ramp, tuned to the same targets as the current tiers.
const text = "#f5f0e3"; // Lc 98
const textDim = "#d2cdbf"; // Lc 76
const muted = "#b9b3a4"; // Lc 61
const dim = "#9d9788"; // Lc 46
const faint = "#3c382c"; // decorative only

// Content kind (Stats and Calendar) and the heat ramp.
const typeAnime = "#f69fc5";
const typeSeries = "#68ccf5";
const typeMovie = "#e1cc49";
const typeMixed = "#a496bf";
const heatRamp = ["#2c1f1c", "#314e4e", "#357879", "#2ea5a7", "#3ed6d9"] as const;

// Add dangerText and milestoneText to the exported tokens object, beside danger and milestone.

export const tokens = {
  // ---- surfaces ----
  scrim,
  bg,
  dangerText,
  milestoneText,
  surface,
  surfaceElevated,
  surfaceActive,
  raised,
  line,
  lineSoft,
  lineStrong,

  // ---- semantic accents (use these in new code) ----
  accent,
  accentSoft,
  accentDeep,
  accentDim,
  accentGlow,
  accentFill,
  ok,
  okDim,
  okFill,
  warn,
  warnDim,
  warnFill,
  danger,
  dangerDim,
  dangerFill,
  info,
  infoDim,
  infoFill,
  milestone,
  milestoneDim,
  milestoneFill,

  // ---- text ----
  text,
  textDim,
  muted,
  dim,
  faint,

  // ---- media-type hues (Stats only) ----
  typeAnime,
  typeSeries,
  typeMovie,
  typeMixed,

  heatRamp,
} as const;

export type TokenName = keyof typeof tokens;
export type TokenValue = (typeof tokens)[TokenName];
