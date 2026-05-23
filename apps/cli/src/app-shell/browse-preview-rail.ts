import type { PreviewPosterState, PreviewRailModel } from "@/app-shell/primitives/PreviewRail";

import { buildPreviewMetaLine } from "./details-panel";
import type { PosterResult, PosterState } from "./poster-types";
import type { BrowseShellOption } from "./types";

const PROVIDER_FACT_LABELS = new Set(["Metadata source", "Provider detail page", "Image source"]);

function optionSearchText<T>(option: BrowseShellOption<T>): string {
  const facts =
    option.previewFacts?.flatMap((fact) => [fact.label, fact.detail]).filter(Boolean) ?? [];
  return [
    option.label,
    option.detail,
    option.previewTitle,
    option.previewBody,
    option.previewNote,
    option.previewRating,
    ...(option.previewMeta ?? []),
    ...facts,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

export function filterBrowseOptionsByResultFilter<T>(
  options: readonly BrowseShellOption<T>[],
  resultFilter: string,
): readonly BrowseShellOption<T>[] {
  const needle = resultFilter.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => optionSearchText(option).includes(needle));
}

function previewFactTone(
  tone: "neutral" | "info" | "success" | "warning" | "error" | undefined,
): PreviewRailModel["facts"][number]["tone"] {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "error") return "danger";
  return "muted";
}

export function buildPreviewRailModelFromBrowseOption<T>(
  option: BrowseShellOption<T> | undefined,
  posterState: PreviewPosterState,
): PreviewRailModel | null {
  if (!option) return null;

  const facts = (option.previewFacts ?? [])
    .filter((fact) => fact.detail && !PROVIDER_FACT_LABELS.has(fact.label))
    .slice(0, 4)
    .map((fact) => ({
      label: fact.label,
      value: fact.detail ?? "",
      tone: previewFactTone(fact.tone),
    }));

  const statusFact = option.previewBadge
    ? [{ label: "Status", value: option.previewBadge, tone: "muted" as const }]
    : [];

  const actionFact = option.previewNote
    ? [{ label: "Action", value: option.previewNote, tone: "muted" as const }]
    : [];

  return {
    title: option.previewTitle ?? option.label,
    subtitle: buildPreviewMetaLine(option),
    overview: option.previewBody,
    posterUrl: option.previewImageUrl,
    posterState,
    facts: [...statusFact, ...facts, ...actionFact].slice(0, 4),
  };
}

export function mapPosterPreviewState(input: {
  readonly hasPosterPath: boolean;
  readonly poster: PosterResult;
  readonly posterState: PosterState;
}): PreviewPosterState {
  if (!input.hasPosterPath) return "none";
  if (input.posterState === "loading") return "loading";
  if (
    input.poster.kind === "kitty" ||
    input.poster.kind === "text" ||
    input.posterState === "ready"
  ) {
    return "ready";
  }
  if (input.posterState === "unavailable") return "failed";
  return "none";
}
