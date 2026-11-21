import { detectTerminalColorLevel, type TerminalColorLevel } from "@kunai/design";

/** Cached for the process lifetime — env is not expected to change mid-session. */
let cachedLevel: TerminalColorLevel | undefined;

export function getTerminalColorLevel(): TerminalColorLevel {
  cachedLevel ??= detectTerminalColorLevel();
  return cachedLevel;
}

/** Test-only: env is pinned per case and the cache must not leak across examples. */
export function resetTerminalColorLevelCacheForTests(): void {
  cachedLevel = undefined;
}

/** When false, Ink must not receive color or backgroundColor (no-color.org, TERM=dumb). */
export function terminalEmitsColor(): boolean {
  return getTerminalColorLevel() !== "none";
}

/** Prime the colour-level cache before mounting Ink; chalk 5.x does not read NO_COLOR itself. */
export function primeShellColorEnvironment(): void {
  getTerminalColorLevel();
}

export function inkColor(color: string | undefined): string | undefined {
  if (!color || !terminalEmitsColor()) return undefined;
  return color;
}

export function inkBackground(color: string | undefined): string | undefined {
  if (!color || !terminalEmitsColor()) return undefined;
  return color;
}

export function inkBorderColor(color: string | undefined): string | undefined {
  if (!color || !terminalEmitsColor()) return undefined;
  return color;
}

/** Props Ink uses to emit colour SGR — stripped when {@link terminalEmitsColor} is false. */
export const INK_COLOR_PROP_KEYS = [
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
  "borderBackgroundColor",
  "borderTopBackgroundColor",
  "borderBottomBackgroundColor",
  "borderLeftBackgroundColor",
  "borderRightBackgroundColor",
] as const;

export type InkColorProps = Partial<Record<(typeof INK_COLOR_PROP_KEYS)[number], string>>;

export function stripInkColorProps<T extends InkColorProps>(props: T): T {
  if (terminalEmitsColor()) return props;
  const next = { ...props };
  for (const key of INK_COLOR_PROP_KEYS) {
    if (key in next) delete next[key];
  }
  return next;
}
