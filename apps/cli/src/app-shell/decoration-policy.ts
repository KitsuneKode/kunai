/**
 * Glyph and chrome decoration policy for plain, screen-reader-friendly output.
 *
 * Active when `minimalMode` is on (CLI `-m`, persisted config, or implied by
 * `-z`) or when `TERM=dumb`. Primitives consult this module instead of
 * scattering `if (minimal)` checks.
 */

import type { StateBlockKind } from "./primitives/StateBlock.model";

let minimalModeSource: () => boolean = () => false;

/** Wired at bootstrap to `config.minimalMode` (session overrides included). */
export function setPlainDecorationSource(source: () => boolean): void {
  minimalModeSource = source;
}

export function isDumbTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TERM ?? "").trim().toLowerCase() === "dumb";
}

/** Plain glyphs, no mascot lines, no full-width rules, no terminal posters. */
export function plainDecorationsActive(
  env: NodeJS.ProcessEnv = process.env,
  stdout: { readonly isTTY?: boolean } = process.stdout,
): boolean {
  return minimalModeSource() || (isDumbTerminal(env) && stdout.isTTY === true);
}

export function terminalPostersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !plainDecorationsActive(env);
}

/** Kanna / fox copy and glyph on empty & error surfaces. */
export function companionFlavorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !plainDecorationsActive(env);
}

export function appBrandLabel(env: NodeJS.ProcessEnv = process.env): string {
  return plainDecorationsActive(env) ? "Kunai" : "🦊 Kunai";
}

export type DecorationGlyphs = {
  readonly listCursor: string;
  readonly listCursorSpaced: string;
  readonly search: string;
  readonly sakura: string;
  readonly statusLoading: string;
  readonly statusEmpty: string;
  readonly statusSuccess: string;
  readonly statusError: string;
  readonly statusInfo: string;
  readonly statusLive: string;
  readonly warnTriangle: string;
  readonly headerStatusDot: string;
  readonly chordShift: string;
  readonly chordCtrl: string;
  readonly chordTab: string;
  readonly slashGlyph: string;
  /** On/off switch, settings radios. */
  readonly radioOn: string;
  readonly radioOff: string;
  /** Setup toggles. Rich mode keeps the bullseye; plain mode matches the radio. */
  readonly toggleOn: string;
  /** Hollow mark for queued / not-yet states. */
  readonly waitingMark: string;
  /** Filled live/airing dot. */
  readonly liveDot: string;
  readonly disclosure: string;
  readonly focusArrow: string;
  readonly failMark: string;
  readonly cycle: string;
  readonly playMark: string;
  readonly pauseMark: string;
};

const RICH_GLYPHS: DecorationGlyphs = {
  listCursor: "▌",
  listCursorSpaced: "▌ ",
  search: "⌕",
  sakura: "❀",
  statusLoading: "◐",
  statusEmpty: "·",
  statusSuccess: "✓",
  statusError: "×",
  statusInfo: "●",
  statusLive: "◐",
  warnTriangle: "△",
  headerStatusDot: "● ",
  chordShift: "⇧",
  chordCtrl: "⌃",
  chordTab: "⇥",
  slashGlyph: "⁄",
  radioOn: "●",
  radioOff: "○",
  toggleOn: "◉",
  waitingMark: "○",
  liveDot: "◉",
  disclosure: "▸",
  focusArrow: "❯",
  failMark: "✗",
  cycle: "↻",
  playMark: "▶",
  pauseMark: "⏸",
};

const PLAIN_GLYPHS: DecorationGlyphs = {
  listCursor: ">",
  listCursorSpaced: "> ",
  search: "/",
  sakura: "*",
  statusLoading: "...",
  statusEmpty: "-",
  statusSuccess: "ok",
  statusError: "x",
  statusInfo: "*",
  statusLive: "...",
  warnTriangle: "!",
  headerStatusDot: "",
  chordShift: "Shift+",
  chordCtrl: "Ctrl+",
  chordTab: "Tab",
  slashGlyph: "/",
  radioOn: "[x]",
  radioOff: "[ ]",
  toggleOn: "[x]",
  waitingMark: "-",
  liveDot: "*",
  disclosure: ">",
  focusArrow: ">",
  failMark: "x",
  cycle: "~",
  playMark: ">",
  pauseMark: "||",
};

export function decorationGlyphs(env: NodeJS.ProcessEnv = process.env): DecorationGlyphs {
  return plainDecorationsActive(env) ? PLAIN_GLYPHS : RICH_GLYPHS;
}

export function stateBlockGlyph(
  kind: StateBlockKind,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const g = decorationGlyphs(env);
  switch (kind) {
    case "loading":
      return g.statusLoading;
    case "empty":
      return g.statusEmpty;
    case "success":
      return g.statusSuccess;
    case "error":
      return g.statusError;
    default:
      return g.statusInfo;
  }
}

export function listSelectionPrefix(
  selected: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return selected ? decorationGlyphs(env).listCursorSpaced : "  ";
}

/** Replace decorative modifier glyphs in an already-formatted chord or shortcut string. */
export function localizeShortcutGlyphs(
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!plainDecorationsActive(env)) return label;
  const g = PLAIN_GLYPHS;
  return label
    .replaceAll("⇧", g.chordShift)
    .replaceAll("⌃", g.chordCtrl)
    .replaceAll("⇥", g.chordTab)
    .replaceAll("⁄", g.slashGlyph)
    .replaceAll("▌", g.listCursor)
    .replaceAll("✓", g.statusSuccess)
    .replaceAll("△", g.warnTriangle)
    .replaceAll("❀", g.sakura)
    .replaceAll("⌕", g.search)
    .replaceAll("❯", g.focusArrow)
    .replaceAll("▸", g.disclosure)
    .replaceAll("◉", g.liveDot)
    .replaceAll("●", g.statusInfo)
    .replaceAll("○", g.waitingMark)
    .replaceAll("✗", g.failMark)
    .replaceAll("↻", g.cycle)
    .replaceAll("▶", g.playMark)
    .replaceAll("⏸", g.pauseMark)
    .replaceAll("┌", "")
    .replaceAll("│", "")
    .replaceAll("└", "")
    .replaceAll("─", "");
}

/**
 * Status words (`ok`) and one-cell marks (`!`, `x`) share a column in plain mode.
 * Rich marks are already one cell, so they stay as drawn.
 */
export function alignedStatusMark(glyph: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!plainDecorationsActive(env)) return glyph;
  const g = decorationGlyphs(env);
  const width = Math.max(g.statusSuccess.length, g.statusError.length, g.warnTriangle.length);
  return glyph.padEnd(width);
}

/** Ink border, omitted when plain mode drops box drawing. */
export function decorativeBorderStyle<T extends string>(
  style: T,
  env: NodeJS.ProcessEnv = process.env,
): T | undefined {
  return plainDecorationsActive(env) ? undefined : style;
}

/** Box-drawing gutter. Plain mode keeps the same column width with spaces. */
export function verticalRulePrefix(spaced = true, env: NodeJS.ProcessEnv = process.env): string {
  if (plainDecorationsActive(env)) return spaced ? "  " : " ";
  return spaced ? "│ " : "│";
}

const SECTION_RULE_PREFIX = "─── ";

/** `─── Synopsis` becomes `Synopsis` in plain mode. Detection can keep the prefix. */
export function displaySectionRuleLabel(
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!plainDecorationsActive(env) || !label.startsWith(SECTION_RULE_PREFIX)) return label;
  return label.slice(SECTION_RULE_PREFIX.length);
}

/** Tab-strip hints. Plain mode spells the chord so it does not double the word "Tab". */
export function tabCycleHint(which: "tabs" | "type", env: NodeJS.ProcessEnv = process.env): string {
  if (!plainDecorationsActive(env)) {
    return which === "tabs" ? "⇥ Tab · ⇧⇥ cycles tabs" : "⇥ Tab cycles type";
  }
  return which === "tabs" ? "Tab · Shift+Tab cycles tabs" : "Tab cycles type";
}

export type SectionSeparatorModel =
  | { readonly kind: "rule"; readonly text: string }
  | { readonly kind: "label"; readonly text: string }
  | { readonly kind: "blank" };

/**
 * Full-width `─` rules become a blank line or a short label in plain mode.
 * Rich mode keeps the decorative rule text unchanged.
 */
export function sectionSeparatorText(
  options: { readonly label?: string; readonly width: number; readonly ruleWidth?: number },
  env: NodeJS.ProcessEnv = process.env,
): SectionSeparatorModel {
  const label = options.label?.trim();
  if (plainDecorationsActive(env)) {
    if (label) return { kind: "label", text: label };
    return { kind: "blank" };
  }
  const width = options.ruleWidth ?? options.width;
  const rule = "─".repeat(Math.max(2, width));
  if (label) {
    const side = Math.max(0, options.width - label.length - 2);
    const left = Math.min(2, side);
    const right = Math.max(0, side - left);
    return {
      kind: "rule",
      text: `${"─".repeat(left)} ${label.toLowerCase()} ${"─".repeat(right)}`,
    };
  }
  return { kind: "rule", text: rule };
}

/** For tests: detect Extended_Pictographic / common mascot emoji in captured frames. */
export const EMOJI_OR_MASCOT = /[\p{Extended_Pictographic}]|🦊/u;
export const LONG_BOX_RULE = /─{10,}/;
