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
const scrim = "#080509";
const bg = "#100b0f";
const surface = "#1c1620";
const surfaceElevated = "#2a2030";
const surfaceActive = "#3a2b40"; // selected band
const raised = "#44354d";
const line = "#473b51";
const lineSoft = "#281f2e";
const lineStrong = "#62526c";
// Border for things you operate (inputs, outlined buttons, toggles). `line` is a
// decorative divider at 1.5-1.9:1; a control whose edge is the only thing
// marking it needs 3:1 against the surface it sits on (WCAG 1.4.11).
const lineControl = "#786782";

// Brand / focus / selection / in-progress — rose, two-step for depth.
const accent = "#ff8fb0";
const accentSoft = "#ffc6d8"; // hairline / whisper
const accentDeep = "#d85f86"; // progress fill, gives bars body
const accentDim = "#7e3350";
const accentGlow = "rgba(255,143,176,0.10)";
const accentFill = "#2c1622"; // pre-blended onto bg for selection/badge depth

// Ready / complete / available — mint-jade.
const ok = "#54d6a0";
const okDim = "#3a9a78";
const okFill = "#122a22";

// Caution / in-flight / aired-not-yet-confirmed — a true amber (its own hue,
// no longer borrowed from the rose accent).
const warn = "#f59a3c";
const warnDim = "#b06f28";
const warnFill = "#2e2012";

// Real, actionable error — a vivid alarm red. It is Lc 46 on the canvas, too dark to read as text,
// so borders and art keep it and text uses `dangerText`: the same hue (24°) lifted to Lc 60.
const danger = "#ff5d5d";
const dangerDim = "#a02b2b";
const dangerFill = "#341515";
const dangerText = "#ff9791"; // Lc 62

// Information / neutral-positive signal — the cool counterweight blue.
const info = "#5fb6ff";
const infoDim = "#3c7fbf";
const infoFill = "#112230";

// Series-complete milestone — a single deliberate periwinkle. Never reuse elsewhere.
// Its hue sits 46° from the orchid anime kind (it was 20°, which read as one purple).
const milestone = "#6d85f6";
const milestoneDim = "#39467f";
const milestoneFill = "#151a32";
// Lc 41 on the canvas, so text uses `milestoneText`: the same 272° hue lifted to Lc 62.
const milestoneText = "#9db2ff";

// Text ramp — warm white → faint. Carries ~80% of hierarchy.
//
// Each tier is set by APCA lightness contrast (|Lc|) on the canvas, the panel and `accentFill`
// (the ground every selected row, tab and picker option is painted on), because on a dark ground
// WCAG ratios flatter it: the old `muted` was 5.9:1 but only Lc 41, and the old `dim` was Lc 20 on
// the canvas and Lc 18 on the selection fill, barely above the Lc 15 floor for being discernible.
// Targets: textDim Lc 75 (body floor), muted Lc 60 (labels), dim Lc 45 (hints, pending steps).
// Hue and chroma are unchanged from the previous values; only OKLCH lightness moved.
// `color-resolution.ts` holds the 256-colour fallback for each tier and meets the same targets.
const text = "#f6eff4"; // Lc 98
const textDim = "#d6cbd6"; // Lc 77
const muted = "#beb1c0"; // Lc 62
const dim = "#a494a7"; // Lc 47
// Decorative only (1.6:1 on bg): rules and disabled glyphs, never text a user has to read.
const faint = "#3a3340";

// Media-type hues — Stats + Calendar surfaces (see THE ONE RULE above).
const typeAnime = "#d885f1"; // orchid
const typeSeries = "#4ad0cf"; // teal
const typeMovie = "#ebc95c"; // gold
const typeMixed = "#a48fb8"; // soft plum — the optical blend, for mixed days

// Watch-activity heat ramp — rose, 5-step (brand-aligned; mint stays reserved
// for success). Stats may overlay type hue per the paint-mix model in the spec.
const heatRamp = ["#281f2e", "#5e2f44", "#9a4060", "#d85f86", "#ff8fb0"] as const;

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
  lineControl,

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
  dangerText,
  info,
  infoDim,
  infoFill,
  milestone,
  milestoneDim,
  milestoneFill,
  milestoneText,

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
