// =============================================================================
// calendar-view.ts — pure view-model helpers for calendar schedule UI
//
// Design authority: .design/cli/kunai-sakura-calendar-locked.html
// =============================================================================

import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

import { calendarPriorityBand } from "./calendar-ui.model";

function mediaTypeSortRank(option: BrowseShellOption<SearchResult>): number {
  const kind = option.value.calendar?.contentKind;
  if (kind === "anime") return 0;
  if (kind === "movie") return 2;
  return 1;
}

function priorityBandSortRank(option: BrowseShellOption<SearchResult>): number {
  const band = calendarPriorityBand(option);
  if (band === "for-you") return 0;
  if (band === "also-today") return 1;
  return 2;
}

function sortTimestampMs(option: BrowseShellOption<SearchResult>): number {
  const releaseAt = option.value.calendar?.releaseAt;
  if (releaseAt) {
    const ms = Date.parse(releaseAt);
    if (Number.isFinite(ms)) return ms;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function sortCalendarOptions(
  options: readonly BrowseShellOption<SearchResult>[],
): readonly BrowseShellOption<SearchResult>[] {
  return [...options].sort((left, right) => {
    const priorityDelta = priorityBandSortRank(left) - priorityBandSortRank(right);
    if (priorityDelta !== 0) return priorityDelta;
    const timeDelta = sortTimestampMs(left) - sortTimestampMs(right);
    if (timeDelta !== 0) return timeDelta;
    const typeDelta = mediaTypeSortRank(left) - mediaTypeSortRank(right);
    if (typeDelta !== 0) return typeDelta;
    return left.label.localeCompare(right.label);
  });
}
