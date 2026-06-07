import { buildContextCardTile } from "./ContextCard.model";

export type PreviewPosterState = "none" | "loading" | "ready" | "failed";

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
