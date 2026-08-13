// =============================================================================
// playback-error-rows.ts — the failure panel's content, as rows of segments
//
// ErrorShell used to build its layout inline as nested Boxes. The petal fall
// needs to know which cells each row's text occupies, and Ink exposes no cell
// buffer, so the content becomes data first and is rendered second. Row content
// and ordering match what the panel rendered before this module existed.
// =============================================================================

import type { ErrorScenario } from "@/domain/playback/playback-problem";

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

function debugRows(excerpt: ErrorDebugExcerpt): readonly ErrorRow[] {
  const rows: ErrorRow[] = [BLANK, row("debug", "dim"), row(excerpt.message, "muted")];
  if (excerpt.topFrame) rows.push(row(excerpt.topFrame, "dim"));
  return rows;
}

export function buildErrorRows(input: {
  readonly message: string;
  readonly scenario?: ErrorScenario;
  readonly waterfall?: PlaybackFailureWaterfallModel | null;
  readonly debugExcerpt?: ErrorDebugExcerpt | null;
  readonly canRetry: boolean;
}): readonly ErrorRow[] {
  const rows: ErrorRow[] = [row("Playback failed", "danger-strong")];

  rows.push(...(input.scenario ? scenarioRows(input.scenario) : [row(input.message, "text")]));
  if (input.waterfall) rows.push(...waterfallRows(input.waterfall));
  if (input.debugExcerpt) rows.push(...debugRows(input.debugExcerpt));

  rows.push(
    BLANK,
    row(input.canRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue", "dim"),
  );

  return rows;
}
