import { tokens as rawTokens, type TokenName, type TokenValue } from "./tokens";

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

  info: { ansi256: "#5fafff", ansi16: "blue" },
  infoDim: { ansi256: "#5f87d7", ansi16: "blue" },
  infoFill: { ansi256: "#1c2633", ansi16: "black" },

  milestone: { ansi256: "#875fff", ansi16: "magenta" },
  milestoneDim: { ansi256: "#5f5fd7", ansi16: "magenta" },
  milestoneFill: { ansi256: "#1c1a30", ansi16: "black" },

  text: { ansi256: "#eeeeee", ansi16: "white" },
  textDim: { ansi256: "#c6c6c6", ansi16: "white" },
  muted: { ansi256: "#afafaf", ansi16: "gray" },
  dim: { ansi256: "#808080", ansi16: "gray" },
  faint: { ansi256: "#5f5f5f", ansi16: "gray" },

  typeAnime: { ansi256: "#af87ff", ansi16: "magenta" },
  typeSeries: { ansi256: "#5fd7d7", ansi16: "cyan" },
  typeMovie: { ansi256: "#ffd75f", ansi16: "yellow" },
  typeMixed: { ansi256: "#af87d7", ansi16: "magenta" },
};

const HEAT_RAMP_FALLBACKS: Record<"ansi256" | "ansi16", ResolvedHeatRamp> = {
  ansi256: ["#262626", "#5f2f3f", "#875f5f", "#d75f87", "#ff87af"],
  ansi16: ["black", "gray", "magenta", "magenta", "magenta"],
};

function currentEnv(): TerminalColorEnv {
  return ((globalThis as { process?: { env?: TerminalColorEnv } }).process?.env ??
    {}) as TerminalColorEnv;
}

export function detectTerminalColorLevel(env: TerminalColorEnv = currentEnv()): TerminalColorLevel {
  const forced = env.FORCE_COLOR;
  if (forced === "3") return "truecolor";
  if (forced === "2") return "256";
  if (forced === "1") return "16";
  if (forced === "0" || env.NO_COLOR !== undefined) return "16";

  if (TRUECOLOR_HINTS.test(env.COLORTERM ?? "")) return "truecolor";
  if (ANSI_256_HINTS.test(env.TERM ?? "")) return "256";
  return "16";
}

function resolveColorToken(
  name: TokenName,
  value: TokenValue,
  level: TerminalColorLevel,
): ResolvedTokenValue {
  if (level === "truecolor") return value;
  if (name === "heatRamp") {
    return level === "256" ? HEAT_RAMP_FALLBACKS.ansi256 : HEAT_RAMP_FALLBACKS.ansi16;
  }
  const fallback = ANSI_FALLBACKS[name];
  if (!fallback) return value;
  return level === "256" ? fallback.ansi256 : fallback.ansi16;
}

export function resolveDesignTokens(
  level: TerminalColorLevel = detectTerminalColorLevel(),
): ResolvedDesignTokens {
  return Object.fromEntries(
    Object.entries(rawTokens).map(([name, value]) => [
      name,
      resolveColorToken(name as TokenName, value, level),
    ]),
  ) as ResolvedDesignTokens;
}
