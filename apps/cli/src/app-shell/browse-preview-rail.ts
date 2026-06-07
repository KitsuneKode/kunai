import type {
  PreviewPosterState,
  PreviewRailModel,
} from "@/app-shell/primitives/PreviewRail.model";

import { buildPreviewMetaLine } from "./details-panel";
import type { PosterResult, PosterState } from "./poster-types";
import { truncateLine } from "./shell-text";
import type { BrowseShellOption, ShellPanelLine } from "./types";

/** Provider/diagnostic facts stay in the details sheet, not the compact preview rail. */
const RAIL_SKIP_LABELS = new Set([
  "Metadata source",
  "Provider detail page",
  "Image source",
  "Popularity",
]);

const RAIL_LABEL_SHORT: Record<string, string> = {
  "Watch history": "Progress",
  "Local progress": "Progress",
  "Title aliases": "Aliases",
  "Audio and subtitles": "Audio",
  Release: "Release",
  Offline: "Offline",
  Season: "Season",
  Status: "Status",
};

function shortenRailLabel(label: string): string {
  return RAIL_LABEL_SHORT[label] ?? label;
}

function normalizeRailFactValue(sourceLabel: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (sourceLabel === "Title aliases") {
    if (/^no alternate title aliases/i.test(trimmed)) return null;
    return trimmed
      .split(/\s*·\s*/)
      .map((part) => part.replace(/^(provider|english|native|romaji):\s*/i, "").trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");
  }

  if (sourceLabel === "Audio and subtitles") {
    if (/unknown until resolve/i.test(trimmed)) return null;
    return trimmed
      .replace(/\s+audio available/gi, "")
      .replace(/\s+evidence from provider search/gi, "")
      .replace(/\s+availability unknown until resolve/gi, "")
      .replace(/\s+/g, " ")
      .replace(/\s*·\s*/g, " · ")
      .trim();
  }

  if (sourceLabel === "Provider detail page" || sourceLabel === "Release") {
    if (/unavailable|no schedule|did not return/i.test(trimmed)) return null;
    return trimmed.length > 36 ? truncateLine(trimmed, 34) : trimmed;
  }

  if (sourceLabel === "Watch history" || sourceLabel === "Local progress") {
    return trimmed.length > 32 ? truncateLine(trimmed, 30) : trimmed;
  }

  return trimmed.length > 36 ? truncateLine(trimmed, 34) : trimmed;
}

function normalizePreviewBadge(badge: string): PreviewRailModel["facts"][number] | null {
  const trimmed = badge.trim();
  if (!trimmed) return null;
  if (trimmed === "wl") {
    return { label: "List", value: "watchlist", tone: "muted" };
  }
  return {
    label: "Status",
    value: trimmed.length > 28 ? truncateLine(trimmed, 26) : trimmed,
    tone: "muted",
  };
}

function normalizePreviewNote(note: string): PreviewRailModel["facts"][number] | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  if (/press enter to open/i.test(trimmed)) {
    if (/episode selection/i.test(trimmed))
      return { label: "Open", value: "Enter · episode", tone: "muted" };
    if (/playback/i.test(trimmed)) return { label: "Open", value: "Enter · play", tone: "muted" };
    return { label: "Open", value: "Enter · open", tone: "muted" };
  }
  return {
    label: "Hint",
    value: trimmed.length > 28 ? truncateLine(trimmed, 26) : trimmed,
    tone: "muted",
  };
}

function railFactFromPanelLine(fact: ShellPanelLine): PreviewRailModel["facts"][number] | null {
  if (RAIL_SKIP_LABELS.has(fact.label)) return null;
  const value = normalizeRailFactValue(fact.label, fact.detail ?? "");
  if (!value) return null;
  return {
    label: shortenRailLabel(fact.label),
    value,
    tone: previewFactTone(fact.tone),
  };
}

export function browseResultStatusLine(input: {
  readonly resultSubtitle: string;
  readonly resultFilter: string;
  readonly displayCount: number;
  readonly totalCount: number;
}): { readonly primary?: string; readonly secondary?: string } {
  const trimmedFilter = input.resultFilter.trim();
  const hasSubtitle = input.resultSubtitle.trim().length > 0;

  if (!hasSubtitle) {
    return input.displayCount > 0 ? { primary: `${input.displayCount} results` } : {};
  }

  if (trimmedFilter && input.displayCount !== input.totalCount) {
    return {
      primary: input.resultSubtitle,
      secondary: `${input.displayCount} of ${input.totalCount} shown`,
    };
  }

  return { primary: input.resultSubtitle };
}

function optionSearchText<T>(option: BrowseShellOption<T>): string {
  const facts: string[] = [];
  for (const fact of option.previewFacts ?? []) {
    if (fact.label) facts.push(fact.label);
    if (fact.detail) facts.push(fact.detail);
  }
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

  const panelFacts = (option.previewFacts ?? [])
    .map((fact) => railFactFromPanelLine(fact))
    .filter((fact): fact is PreviewRailModel["facts"][number] => fact !== null);

  const badgeFact = option.previewBadge ? normalizePreviewBadge(option.previewBadge) : null;
  const noteFact = option.previewNote ? normalizePreviewNote(option.previewNote) : null;

  const mergedFacts: PreviewRailModel["facts"][number][] = [];
  const seenLabels = new Set<string>();
  for (const fact of [badgeFact, ...panelFacts, noteFact]) {
    if (!fact || seenLabels.has(fact.label)) continue;
    seenLabels.add(fact.label);
    mergedFacts.push(fact);
    if (mergedFacts.length >= 4) break;
  }

  const overview =
    option.previewBody &&
    !/^no overview available/i.test(option.previewBody) &&
    !/^no schedule details available/i.test(option.previewBody)
      ? option.previewBody
      : undefined;

  return {
    title: option.previewTitle ?? option.label,
    subtitle: buildPreviewMetaLine(option),
    overview: overview ? truncateLine(overview, 120) : undefined,
    posterUrl: option.previewImageUrl,
    posterState,
    facts: mergedFacts,
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
