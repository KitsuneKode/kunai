import type { ThemePalette } from "./theme-types";
import { tokens as rawTokens, type TokenName } from "./tokens";

export type TerminalColorLevel = "truecolor" | "256" | "16";
export type TerminalColorEnv = Record<string, string | undefined>;
export type ResolvedHeatRamp = readonly [string, string, string, string, string];
export type ResolvedTokenValue = string | ResolvedHeatRamp;
export type ResolvedDesignTokens = Omit<Record<TokenName, string>, "heatRamp"> & {
  readonly heatRamp: ResolvedHeatRamp;
};

type FallbackPair = {
  readonly ansi256: string;
  readonly ansi16: string;
};

const TRUECOLOR_HINTS = /(?:truecolor|24bit)/i;
const ANSI_256_HINTS = /(?:256color|direct)/i;

const ANSI_FALLBACKS: Partial<Record<TokenName, FallbackPair>> = {
  scrim: { ansi256: "#000000", ansi16: "black" },
  bg: { ansi256: "#121212", ansi16: "black" },
  surface: { ansi256: "#1c1c1c", ansi16: "black" },
  surfaceElevated: { ansi256: "#262626", ansi16: "black" },
  surfaceActive: { ansi256: "#3a2a32", ansi16: "black" },
  raised: { ansi256: "#3a3a3a", ansi16: "gray" },
  line: { ansi256: "#5f5f5f", ansi16: "gray" },
  lineSoft: { ansi256: "#303030", ansi16: "gray" },
  lineStrong: { ansi256: "#875f87", ansi16: "white" },
  lineControl: { ansi256: "#767676", ansi16: "gray" },

  accent: { ansi256: "#ff87af", ansi16: "magenta" },
  accentSoft: { ansi256: "#ffd7df", ansi16: "white" },
  accentDeep: { ansi256: "#d75f87", ansi16: "magenta" },
  accentDim: { ansi256: "#875f87", ansi16: "magenta" },
  accentGlow: { ansi256: "#262626", ansi16: "black" },
  accentFill: { ansi256: "#3a2a32", ansi16: "black" },

  ok: { ansi256: "#5fd7af", ansi16: "green" },
  okDim: { ansi256: "#5faf87", ansi16: "green" },
  okFill: { ansi256: "#1c2621", ansi16: "black" },

  warn: { ansi256: "#ffaf5f", ansi16: "yellow" },
  warnDim: { ansi256: "#d78700", ansi16: "yellow" },
  warnFill: { ansi256: "#3a2a1c", ansi16: "black" },

  danger: { ansi256: "#ff5f5f", ansi16: "red" },
  dangerDim: { ansi256: "#af0000", ansi16: "red" },
  dangerFill: { ansi256: "#3a1c1c", ansi16: "black" },
  dangerText: { ansi256: "#ffafaf", ansi16: "red" },

  info: { ansi256: "#5fafff", ansi16: "blue" },
  infoDim: { ansi256: "#5f87d7", ansi16: "blue" },
  infoFill: { ansi256: "#1c2633", ansi16: "black" },

  // On 16 colours the periwinkle takes bright blue, so it stays apart from the
  // brand magenta and from `info` (plain blue).
  milestone: { ansi256: "#5f87ff", ansi16: "blueBright" },
  milestoneDim: { ansi256: "#5f5fd7", ansi16: "blue" },
  milestoneFill: { ansi256: "#1c1a30", ansi16: "black" },
  milestoneText: { ansi256: "#d7d7ff", ansi16: "blueBright" },

  text: { ansi256: "#eeeeee", ansi16: "white" },
  // Gray-ramp steps chosen to meet the same APCA targets as the truecolor tiers (75 / 60 / 45)
  // on both #121212 and #1c1c1c. The old values were Lc 72 / 58 / 34.
  textDim: { ansi256: "#d7d7d7", ansi16: "white" },
  muted: { ansi256: "#bcbcbc", ansi16: "gray" },
  dim: { ansi256: "#a8a8a8", ansi16: "gray" },
  faint: { ansi256: "#5f5f5f", ansi16: "gray" },

  // Bright magenta, not the accent's plain magenta: anime is a content kind and the
  // accent marks where you are, and on 16 colours they used to be the same colour.
  typeAnime: { ansi256: "#d787ff", ansi16: "magentaBright" },
  typeSeries: { ansi256: "#5fd7d7", ansi16: "cyan" },
  typeMovie: { ansi256: "#ffd75f", ansi16: "yellowBright" },
  typeMixed: { ansi256: "#af87d7", ansi16: "gray" },
};

const HEAT_RAMP_FALLBACKS: Record<"ansi256" | "ansi16", ResolvedHeatRamp> = {
  ansi256: ["#262626", "#5f2f3f", "#875f5f", "#d75f87", "#ff87af"],
  ansi16: ["black", "gray", "magenta", "magenta", "magenta"],
};

// ---- generic palette degradation (non-default themes) -----------------------
//
// The tables above are hand-tuned for the brand palette (Ember Dusk): surfaces
// keep their warm tint, fills stay in family. For user-selected palettes there
// is no curated table, so we degrade mechanically instead — nearest xterm-256
// colour for the 256 level, nearest ANSI name for 16. `rgba()` tokens are
// pre-blended over the palette's own `bg` before quantizing.

type Rgb = readonly [number, number, number];

const RGBA_LITERAL = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i;

function parseHexTriplet(hex: string): Rgb | null {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  const n = Number.parseInt(normalized, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHexTriplet([r, g, b]: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function rgbDistanceSquared(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function blendRgbaOverHex(value: string, bgHex: string): string | null {
  const rgba = RGBA_LITERAL.exec(value);
  const bg = parseHexTriplet(bgHex);
  if (!rgba || !bg) return null;
  const alpha = Math.max(0, Math.min(1, Number.parseFloat(rgba[4] ?? "0")));
  const fg: Rgb = [
    Number.parseInt(rgba[1] ?? "0", 10),
    Number.parseInt(rgba[2] ?? "0", 10),
    Number.parseInt(rgba[3] ?? "0", 10),
  ];
  return toHexTriplet([
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ]);
}

const XTERM_CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function xtermCubeCandidates(): { index: number; rgb: Rgb }[] {
  const out: { index: number; rgb: Rgb }[] = [];
  for (const [ri, r] of XTERM_CUBE_STEPS.entries()) {
    for (const [gi, g] of XTERM_CUBE_STEPS.entries()) {
      for (const [bi, b] of XTERM_CUBE_STEPS.entries()) {
        out.push({
          index: 16 + 36 * ri + 6 * gi + bi,
          rgb: [r, g, b],
        });
      }
    }
  }
  for (let i = 0; i < 24; i += 1) {
    const v = 8 + 10 * i;
    out.push({ index: 232 + i, rgb: [v, v, v] });
  }
  return out;
}

const XTERM_256_CANDIDATES = xtermCubeCandidates();
const XTERM_256_HEX: ReadonlyMap<number, string> = new Map(
  XTERM_256_CANDIDATES.map(({ index, rgb }) => [index, toHexTriplet(rgb)]),
);

/**
 * Nearest xterm-256 colour by RGB distance over the 6x6x6 cube and the
 * 24-step grayscale (indices 16-255; the 0-15 system colours are left to the
 * terminal's own theme). Returns the canonical hex of the chosen index so the
 * answer is still a colour value downstream code can mix and measure.
 */
function quantizeToXterm256(rgb: Rgb): string {
  let bestIndex = 16;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of XTERM_256_CANDIDATES) {
    const d = rgbDistanceSquared(rgb, candidate.rgb);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = candidate.index;
    }
  }
  return XTERM_256_HEX.get(bestIndex) ?? "#ffffff";
}

const ANSI_16_TARGETS: readonly { name: string; rgb: Rgb }[] = [
  { name: "black", rgb: [0, 0, 0] },
  { name: "red", rgb: [194, 54, 33] },
  { name: "green", rgb: [37, 188, 36] },
  { name: "yellow", rgb: [200, 165, 33] },
  { name: "blue", rgb: [73, 46, 225] },
  { name: "magenta", rgb: [211, 56, 211] },
  { name: "cyan", rgb: [26, 168, 198] },
  { name: "gray", rgb: [128, 128, 128] },
  { name: "white", rgb: [229, 229, 229] },
];

/** Nearest basic ANSI name — 16-colour terminals only render these words. */
function quantizeToAnsi16(rgb: Rgb): string {
  let best = "white";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of ANSI_16_TARGETS) {
    const d = rgbDistanceSquared(rgb, target.rgb);
    if (d < bestDistance) {
      bestDistance = d;
      best = target.name;
    }
  }
  return best;
}

function degradePalette(palette: ThemePalette, level: "256" | "16"): ResolvedDesignTokens {
  const quantize = (value: string): string => {
    const blended =
      parseHexTriplet(value) ?? parseHexTriplet(blendRgbaOverHex(value, palette.bg) ?? "");
    if (!blended) return level === "256" ? value : "white";
    return level === "256" ? quantizeToXterm256(blended) : quantizeToAnsi16(blended);
  };
  const { heatRamp, ...scalars } = palette;
  const out: Record<string, string | ResolvedHeatRamp> = {};
  for (const [name, value] of Object.entries(scalars)) {
    out[name] = quantize(value);
  }
  out.heatRamp = [
    quantize(heatRamp[0]),
    quantize(heatRamp[1]),
    quantize(heatRamp[2]),
    quantize(heatRamp[3]),
    quantize(heatRamp[4]),
  ];
  // SAFETY: `scalars` iterated every non-ramp token key of the palette shape,
  // so `out` carries the full ResolvedDesignTokens key set.
  return out as ResolvedDesignTokens;
}

function currentEnv(): TerminalColorEnv {
  return ((globalThis as { process?: { env?: TerminalColorEnv } }).process?.env ??
    {}) as TerminalColorEnv;
}

/**
 * Windows sets neither `COLORTERM` nor `TERM` — both are Unix conventions — so
 * a purely Unix ladder drops every Windows session onto the 16-colour branch,
 * where the whole surface family (`bg`, `surface*`, `accentGlow`, every
 * `*Fill`) collapses to literal `black` and the UI loses all depth. Windows
 * Terminal has done 24-bit colour since 2019 and conhost since Windows 10
 * 1703, which is below the floor Bun itself supports, so on Windows truecolour
 * is the safe default rather than an optimistic guess.
 *
 * `OS` is the platform probe here, not `process.platform`, to keep this
 * function a pure function of its env argument.
 */
function isWindowsEnv(env: TerminalColorEnv): boolean {
  if (env.OS === "Windows_NT") return true;
  return env.WT_SESSION !== undefined || env.ConEmuANSI !== undefined;
}

export function detectTerminalColorLevel(env: TerminalColorEnv = currentEnv()): TerminalColorLevel {
  const forced = env.FORCE_COLOR;
  if (forced === "3") return "truecolor";
  if (forced === "2") return "256";
  if (forced === "1") return "16";
  if (forced === "0" || env.NO_COLOR !== undefined) return "16";

  if (TRUECOLOR_HINTS.test(env.COLORTERM ?? "")) return "truecolor";

  // Named terminals that document 24-bit colour but report nothing in TERM.
  if (env.WT_SESSION !== undefined) return "truecolor";
  if (env.ConEmuANSI?.toUpperCase() === "ON") return "truecolor";
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return "truecolor";

  if (ANSI_256_HINTS.test(env.TERM ?? "")) return "256";

  // A Windows console with no TERM at all: still 24-bit capable. Anything with
  // a TERM has already been classified above by the Unix hints.
  if (env.TERM === undefined && isWindowsEnv(env)) return "truecolor";

  return "16";
}

function resolveColorToken(
  name: TokenName,
  value: string | readonly string[],
  level: TerminalColorLevel,
): ResolvedTokenValue {
  if (level === "truecolor") {
    // SAFETY: TokenValue and ResolvedTokenValue share the same shape, so
    // passing the raw value through at truecolor is honest.
    return value as ResolvedTokenValue;
  }
  if (name === "heatRamp") {
    return level === "256" ? HEAT_RAMP_FALLBACKS.ansi256 : HEAT_RAMP_FALLBACKS.ansi16;
  }
  const fallback = ANSI_FALLBACKS[name];
  if (!fallback) {
    // SAFETY: no curated fallback for this token — the raw palette value
    // carries the same ResolvedTokenValue shape.
    return value as ResolvedTokenValue;
  }
  return level === "256" ? fallback.ansi256 : fallback.ansi16;
}

export function resolveDesignTokens(
  level: TerminalColorLevel = detectTerminalColorLevel(),
  palette: ThemePalette = rawTokens,
): ResolvedDesignTokens {
  // The curated fallback tables describe the brand palette only. Other themes
  // degrade mechanically so a themed accent never leaks the brand rose onto a
  // 256- or 16-colour terminal.
  if (level !== "truecolor" && palette !== rawTokens) {
    return degradePalette(palette, level);
  }
  const resolved = Object.fromEntries(
    Object.entries(palette).map(([name, value]) => [
      name,
      // SAFETY: Object.entries loses the literal key union; every palette key
      // is a TokenName by the ThemePalette contract.
      resolveColorToken(name as TokenName, value, level),
    ]),
  );
  // SAFETY: the map above writes every ThemePalette key, which is the full
  // ResolvedDesignTokens key set.
  return resolved as ResolvedDesignTokens;
}
