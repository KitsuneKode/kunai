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

export function shouldRenderPreviewRail(input: {
  readonly columns: number;
  readonly hasModel: boolean;
}): boolean {
  return input.hasModel && input.columns >= 124;
}
