// =============================================================================
// playback-error-rows.ts — the failure panel's content, as rows of segments
//
// ErrorShell used to build its layout inline as nested Boxes. The petal fall
// needs to know which cells each row's text occupies, and Ink exposes no cell
// buffer, so the content becomes data first and is rendered second. Row content
// and ordering match what the panel rendered before this module existed.
// =============================================================================

import type { ErrorScenario } from "@/domain/playback/playback-problem";
import { wrapText } from "@/domain/text-display";

import type { ErrorDebugExcerpt } from "./error-debug-excerpt";
import type { PlaybackFailureWaterfallModel } from "./playback-failure-waterfall";

export type ErrorRowTone = "danger-strong" | "danger" | "accent" | "text" | "ok" | "muted" | "dim";

export type ErrorRowSegment = { readonly text: string; readonly tone: ErrorRowTone };
export type ErrorRow = { readonly segments: readonly ErrorRowSegment[] };

const BLANK: ErrorRow = { segments: [] };

const row = (text: string, tone: ErrorRowTone): ErrorRow => ({ segments: [{ text, tone }] });

/** The plain text of a row — what the renderer measures and tests assert on. */
export function rowText(input: ErrorRow): string {
  return input.segments.map((segment) => segment.text).join("");
}

function scenarioRows(scenario: ErrorScenario): readonly ErrorRow[] {
  switch (scenario.kind) {
    case "provider-timeout":
      return [
        row(`✗  timed out after ${scenario.elapsedSec}s`, "danger"),
        row(scenario.providerName, "dim"),
        row("r retry · /fallback for another provider", "dim"),
      ];
    case "stream-broken":
      return [
        row("✗  stream interrupted", "danger"),
        row(`attempt ${scenario.attempt} of ${scenario.maxAttempts}`, "dim"),
        row("r retry · /recover to refresh the stream", "dim"),
      ];
    case "network-offline":
      return [row("○  offline", "dim"), row("/library for downloaded titles", "accent")];
    case "provider-session":
      return [
        row(`●  ${scenario.providerName} session required`, "danger"),
        row("/settings · add Videasy session token", "dim"),
        row("/fallback for another provider", "dim"),
      ];
    case "title-unavailable":
      return [
        row(`◌  ${scenario.title} not found`, "dim"),
        row("r retry · /watchlist to save for later", "dim"),
      ];
  }
}

function waterfallRows(model: PlaybackFailureWaterfallModel): readonly ErrorRow[] {
  const heading = `${model.title}${model.truncated ? "  ·  more in /diagnostics" : ""}`;
  const rows: ErrorRow[] = [BLANK, row(heading, "dim")];

  for (const entry of model.rows) {
    const marker = entry.status === "succeeded" ? "✓" : entry.status === "failed" ? "x" : "·";
    const tone: ErrorRowTone =
      entry.status === "succeeded" ? "ok" : entry.status === "failed" ? "danger" : "dim";
    const segments: ErrorRowSegment[] = [{ text: `${marker} ${entry.label}`, tone }];
    if (entry.detail) segments.push({ text: `  ·  ${entry.detail}`, tone: "dim" });
    rows.push({ segments });
  }

  return rows;
}

/**
 * A free-text row, wrapped to the panel's text column when the caller knows
 * it. The renderer clips cells at the panel edge — without wrapping, the one
 * sentence that says *what failed* was cut mid-word.
 */
function textRows(
  text: string,
  tone: ErrorRowTone,
  textWidth: number | undefined,
  maxLines: number,
): readonly ErrorRow[] {
  if (textWidth === undefined || textWidth <= 0) return [row(text, tone)];
  return wrapText(text, textWidth, maxLines).map((line) => row(line, tone));
}

const MESSAGE_MAX_LINES = 3;
const DEBUG_MAX_LINES = 2;

function debugRows(excerpt: ErrorDebugExcerpt, textWidth?: number): readonly ErrorRow[] {
  const rows: ErrorRow[] = [
    BLANK,
    row("debug", "dim"),
    ...textRows(excerpt.message, "muted", textWidth, DEBUG_MAX_LINES),
  ];
  if (excerpt.topFrame) rows.push(...textRows(excerpt.topFrame, "dim", textWidth, DEBUG_MAX_LINES));
  return rows;
}

export function buildErrorRows(input: {
  readonly message: string;
  readonly scenario?: ErrorScenario;
  readonly waterfall?: PlaybackFailureWaterfallModel | null;
  readonly debugExcerpt?: ErrorDebugExcerpt | null;
  readonly canRetry: boolean;
  /** Panel text width in columns; free-text rows wrap to it instead of clipping. */
  readonly textWidth?: number;
}): readonly ErrorRow[] {
  const rows: ErrorRow[] = [row("Playback failed", "danger-strong")];

  rows.push(
    ...(input.scenario
      ? scenarioRows(input.scenario)
      : textRows(input.message, "text", input.textWidth, MESSAGE_MAX_LINES)),
  );
  if (input.waterfall) rows.push(...waterfallRows(input.waterfall));
  if (input.debugExcerpt) rows.push(...debugRows(input.debugExcerpt, input.textWidth));

  rows.push(
    BLANK,
    row(input.canRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue", "dim"),
  );

  return rows;
}
