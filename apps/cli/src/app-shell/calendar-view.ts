// =============================================================================
// calendar-view.ts — pure view-model helpers for calendar schedule UI
//
// Design authority: .design/cli/kunai-sakura-calendar-locked.html
// =============================================================================

import type { BrowseShellOption } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";

function mediaTypeSortRank(option: BrowseShellOption<SearchResult>): number {
  const kind = option.value.calendar?.contentKind;
  if (kind === "anime") return 0;
  if (kind === "movie") return 2;
  return 1;
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
  // One honest chronological timeline (earliest air first). Tracked / for-you items
  // are NOT hoisted above the schedule — that produced jumbled day headers (THU 11 →
  // THU 18 → TUE 9) and a misleading "releasing today" band. Tracked rows are instead
  // marked inline (accent dot) so the timeline stays readable. Matches AniList/IMDb.
  return [...options].sort((left, right) => {
    const timeDelta = sortTimestampMs(left) - sortTimestampMs(right);
    if (timeDelta !== 0) return timeDelta;
    const typeDelta = mediaTypeSortRank(left) - mediaTypeSortRank(right);
    if (typeDelta !== 0) return typeDelta;
    return left.label.localeCompare(right.label);
  });
}
