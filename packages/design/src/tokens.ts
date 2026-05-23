// Kunai design tokens — "Sakura" theme.
//
// Dusk-plum surface, a two-step rose accent, and a mint success color that is
// rose's complement. The whole system is a two-note chord: rose for everything
// you act on, mint for everything that is ready or done. Crimson is held back
// for real, actionable errors.
//
// THE ONE RULE: color encodes state or focus, never identity. Titles win by
// weight, not hue. Provider, audio language, and episode codes are muted text.
// The single exception is media-type hue (anime/series/movie), allowed ONLY on
// the Stats surface, where "type" is literally the data being charted.
//
// Values are tuned from an oklch design source (see .docs/design-system.md and
// .design/cli/kunai-sakura*.html) and rounded to sRGB hex for the terminal.

// ---- raw palette (these semantic consts are the source of truth) ----

// Surface scale — dusk plum, faintly rose-tinted, never pure neutral.
const scrim = "#0c0709";
const bg = "#140d11";
const surface = "#1d141a";
const surfaceElevated = "#271b23";
const surfaceActive = "#34232e"; // selected band, rose-tinted
const raised = "#3e2c38";
const line = "#43303a";
const lineSoft = "#251a20";
const lineStrong = "#5c4351";

// Brand / focus / selection / in-progress — rose, two-step for depth.
const accent = "#f28ea0";
const accentSoft = "#f6c4cd"; // hairline / whisper
const accentDeep = "#cb6178"; // progress fill, gives bars body
const accentDim = "#7c3044";
const accentGlow = "rgba(242,142,160,0.10)";
const accentFill = "#2d161e"; // pre-blended onto bg for selection/badge depth

// Ready / complete / available — mint-jade, rose's complement.
const ok = "#84dcc2";
const okDim = "#4f9d8b";
const okFill = "#14241f";

// Real, actionable error — a vivid alarm red. Deliberately brighter and more
// saturated than the soft rose accent so an error never reads as "just theme".
const danger = "#ff5454";
const dangerDim = "#9a2222";
const dangerFill = "#371414";

// Series-complete milestone — a single deliberate plum. Never reuse elsewhere.
const milestone = "#b884d6";
const milestoneDim = "#4a2c5c";
const milestoneFill = "#241430";

// Text ramp — warm rose-white → faint. Carries ~80% of hierarchy.
const text = "#f3eaef";
const textDim = "#cebcc5";
const muted = "#9a8a93";
const dim = "#6c5e66";
const faint = "#463b42";

// Media-type hues — STATS SURFACE ONLY (see THE ONE RULE above).
const typeAnime = "#ef7d9b"; // rose
const typeSeries = "#6cc6bf"; // teal
const typeMovie = "#e7c163"; // gold
const typeMixed = "#b58ad0"; // plum — the optical blend, for mixed days

// Watch-activity heat ramp — rose, 5-step (brand-aligned; mint stays reserved
// for success). Stats may overlay type hue per the paint-mix model in the spec.
const heatRamp = ["#251a20", "#5c2f3f", "#8d4057", "#bf5b74", "#f28ea0"] as const;

export const tokens = {
  // ---- surfaces ----
  scrim,
  bg,
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
  danger,
  dangerDim,
  dangerFill,
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
