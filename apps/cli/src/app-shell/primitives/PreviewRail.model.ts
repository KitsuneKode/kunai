import { wrapText } from "../shell-text";
import { buildContextCardTile } from "./ContextCard.model";

/**
 * `loading` = a fetch is in flight but may still land within a frame (cache hit,
 * warm source) — show the calm placeholder tile. `pending` = it missed the cache
 * and has been in flight past POSTER_SPINNER_DELAY_MS, which is the only state
 * that earns a spinner.
 */
export type PreviewPosterState = "none" | "loading" | "pending" | "ready" | "failed";

export type PreviewFact = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "warning" | "danger" | "muted";
};

export type PreviewRailModel = {
  readonly title: string;
  readonly subtitle?: string;
  readonly overview?: string;
  readonly posterUrl?: string;
  readonly posterState: PreviewPosterState;
  readonly facts: readonly PreviewFact[];
};

export function getPreviewPosterLabel(
  input: Pick<PreviewRailModel, "title" | "posterState">,
): string {
  if (input.posterState === "loading") return "loading poster";
  // `pending` renders a spinner instead of a label, so it keeps the tile text.
  return buildContextCardTile(input.title);
}

export function visiblePreviewFacts(facts: readonly PreviewFact[]): readonly PreviewFact[] {
  // Defensive: a fact value can be undefined if a caller builds it from a missing
  // field (e.g. a history row without a provider). Treat blank/missing as hidden
  // rather than crashing the whole rail.
  return facts.filter(
    (fact) => (fact.label ?? "").trim().length > 0 && (fact.value ?? "").trim().length > 0,
  );
}

/** Minimum terminal width before the compact preview rail replaces the details sheet. */
export const PREVIEW_RAIL_MIN_COLUMNS = 100;

/** Browse keeps at least this many columns for the results list when the rail sits beside it. */
export const BROWSE_PREVIEW_RAIL_MIN_LIST_COLUMNS = 60;

export function shouldRenderPreviewRail(input: {
  readonly columns: number;
  readonly hasModel: boolean;
}): boolean {
  return input.hasModel && input.columns >= PREVIEW_RAIL_MIN_COLUMNS;
}

/** Browse only shows the rail in the wide beside-list layout with a usable list column. */
export function shouldRenderBrowsePreviewRail(input: {
  readonly companionBesideList: boolean;
  readonly listWidth: number;
  readonly hasModel: boolean;
}): boolean {
  return (
    input.hasModel &&
    input.companionBesideList &&
    input.listWidth >= BROWSE_PREVIEW_RAIL_MIN_LIST_COLUMNS
  );
}

export function estimatePreviewRailRowBudget(
  model: PreviewRailModel | null,
  input: { readonly reserveRows: number; readonly bodyWidth: number },
): number {
  if (!model) return 0;
  const facts = visiblePreviewFacts(model.facts).slice(0, 4);
  const overviewLines = model.overview
    ? wrapText(model.overview, Math.max(16, input.bodyWidth), 3)
    : [];
  let rows = input.reserveRows;
  rows += 1; // marginTop before the title block
  rows += 1; // title
  if (model.subtitle) rows += 1;
  if (overviewLines.length > 0) rows += 1 + overviewLines.length;
  if (facts.length > 0) rows += 1 + facts.length;
  return rows;
}
