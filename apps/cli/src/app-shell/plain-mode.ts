// Plain / screen-reader output mode.
//
// Single source of truth for whether the shell renders in plain, line-oriented,
// screen-reader-friendly mode:
//   - No animation (implies reduced motion everywhere)
//   - No decorative glyphs, emojis, box-drawing borders, or poster images
//   - Linear single-column layout (no side-by-side preview rails interleaving lines)
//   - Explicit words for selection, focus, active tabs, toggles, progress, and states
//
// Activation precedence:
//   1. `KUNAI_PLAIN` env var (per-run override: `1`/`true`/`yes`/`on` enables;
//      `0`/`false`/`off`/`no` explicitly disables even if config enables it)
//   2. Live config / session override (`--plain` launch flag or `config.plainMode`)

const OFF_VALUES = new Set(["0", "false", "off", "no"]);

let preferenceSource: () => boolean = () => false;

/**
 * Wire the persisted/session preference (`config.plainMode`, including the
 * transient `--plain` launch override). Mirrors `setCompanionPreferenceSource`.
 */
export function setPlainModePreferenceSource(source: () => boolean): void {
  preferenceSource = source;
}

/** Whether `KUNAI_PLAIN` is explicitly set to a non-empty value in the env. */
export function plainModeEnvOverridden(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.KUNAI_PLAIN ?? "").trim() !== "";
}

/**
 * Whether plain / screen-reader mode is active for the current frame.
 * Read on every render rather than cached at module load so toggling in
 * Settings or changing `process.env.KUNAI_PLAIN` in tests applies immediately.
 */
export function plainModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.KUNAI_PLAIN?.trim().toLowerCase() ?? "";
  if (raw !== "") return !OFF_VALUES.has(raw);
  return preferenceSource();
}

// ── Shared plain-mode presentation vocabulary ────────────────────────────────

/** Row selection prefix: `[selected] ` in plain mode, `▌ ` in visual mode. */
export function selectionPrefix(
  selected: boolean,
  plain: boolean = plainModeEnabled(),
  visualMarker = "▌",
): string {
  if (plain) return selected ? "[selected] " : "  ";
  return selected ? `${visualMarker} ` : "  ";
}

/** Compact selection marker without trailing space (for tight inline slots). */
export function compactSelectionPrefix(
  selected: boolean,
  plain: boolean = plainModeEnabled(),
): string {
  if (plain) return selected ? "[selected] " : "";
  return selected ? "▌" : " ";
}

/** Suppresses Ink box-drawing borders in plain mode so screen readers skip box art. */
export function plainBorderStyle<T extends "single" | "round">(
  style: T,
  plain: boolean = plainModeEnabled(),
): T | undefined {
  return plain ? undefined : style;
}

/** Brand text without decorative fox emoji in plain mode. */
export function plainBrandLabel(plain: boolean = plainModeEnabled()): string {
  return plain ? "Kunai" : "🦊 Kunai";
}

/** Active tab / segment indicator stated in words rather than background fill. */
export function plainTabLabel(
  label: string,
  active: boolean,
  plain: boolean = plainModeEnabled(),
): string {
  if (!plain) return label;
  return active ? `[active] ${label}` : label;
}

/** Toggle state announced as plain words without decorative bullets. */
export function plainSwitchText(on: boolean, plain: boolean = plainModeEnabled()): string {
  if (plain) return on ? "[on]" : "[off]";
  return on ? "● on" : "○ off";
}

/** Checkbox state announced as plain words without Unicode ballot boxes. */
export function plainCheckboxText(checked: boolean, plain: boolean = plainModeEnabled()): string {
  if (plain) return checked ? "[checked]" : "[unchecked]";
  return checked ? "☑" : "☐";
}

/** Progress announced as percentage text instead of block-art bars. */
export function plainProgressPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

export function plainProgressText(value: number, max: number): string {
  return `Progress: ${plainProgressPercent(value, max)}%`;
}

/** Explicit text prefix for state blocks instead of geometric glyphs. */
export function plainStatePrefix(kind: "loading" | "empty" | "info" | "success" | "error"): string {
  switch (kind) {
    case "loading":
      return "Loading:";
    case "empty":
      return "Empty:";
    case "success":
      return "Done:";
    case "error":
      return "Error:";
    default:
      return "Info:";
  }
}

/** Explicit text status for setup dependency checks. */
export function plainDependencyState(state: "ok" | "blocking" | "optional" | string): string {
  if (state === "ok") return "[ok]";
  if (state === "blocking") return "[missing]";
  return "[warning]";
}

/**
 * Visual section titles keep a `─── ` prefix so scroll and grouping can find
 * them. Plain mode speaks the title and drops the rule.
 */
export const VISUAL_SECTION_RULE = "─── ";

export function plainRuleHeader(label: string, plain: boolean = plainModeEnabled()): string {
  if (!plain || !label.startsWith(VISUAL_SECTION_RULE)) return label;
  return label.slice(VISUAL_SECTION_RULE.length);
}

export type PlainTimerKind = "decorative" | "functional";

/**
 * Plain / screen-reader mode must not repaint for decoration. Search input,
 * resize, and draft persistence are functional and keep their timers.
 */
export function plainTimerAllowed(
  kind: PlainTimerKind,
  plain: boolean = plainModeEnabled(),
): boolean {
  return kind === "functional" || !plain;
}

/** Skip Kitty cleanup and other forced redraws while plain mode owns the frame. */
export function shouldSuppressRedraw(plain: boolean = plainModeEnabled()): boolean {
  return plain;
}

/** Start a dismiss timer only when plain mode is not keeping the frame still. */
export function armDecorativeTimer(
  slot: { current: ReturnType<typeof setTimeout> | null },
  fire: () => void,
  delayMs: number,
): void {
  if (!plainTimerAllowed("decorative")) return;
  slot.current = setTimeout(fire, delayMs);
}

/**
 * A visual placeholder can be a real title ("Breaking Bad"). Plain mode says
 * the field is empty and keeps the example in parentheses.
 */
export function plainPlaceholder(example: string, plain: boolean = plainModeEnabled()): string {
  const trimmed = example.trim();
  if (!plain || trimmed.length === 0 || trimmed.startsWith("(empty")) return example;
  return `(empty, e.g. ${trimmed})`;
}

/** Explicit text status for playback bootstrap stages. */
export function plainStageStatus(
  tone: "neutral" | "info" | "success" | "warning" | "error",
): string {
  switch (tone) {
    case "success":
      return "[done]";
    case "info":
      return "[in progress]";
    case "warning":
      return "[warning]";
    case "error":
      return "[failed]";
    default:
      return "[pending]";
  }
}
