// =============================================================================
// return-loop-copy.ts — shared habit-loop strings (browse · calendar · history · post-play)
// =============================================================================

export const RETURN_LOOP_READY_HEADING = "Ready for you now";
export const RETURN_LOOP_FOR_YOU_NOW_HEADING = "For you now";
/** @deprecated use RETURN_LOOP_FOR_YOU_NOW_HEADING */
export const RETURN_LOOP_BROWSE_RELEASES_HEADING = "Unwatched releases";

export function formatReadyForYouNowMeta(episodeCount: number, titleCount: number): string {
  const episodes = episodeCount === 1 ? "1 new episode" : `${episodeCount} new episodes`;
  const shows = titleCount > 0 ? ` · ${titleCount} ${titleCount === 1 ? "show" : "shows"}` : "";
  return `${episodes}${shows}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * "since Tuesday"-style anchor for the new-since-visit strip: today /
 * yesterday / weekday inside the last week / short date beyond it.
 * `nowMs` is injectable so the label never reads the wall clock in tests.
 */
export function formatSinceVisitDayLabel(sinceMs: number, nowMs: number): string {
  const today = localDayStart(nowMs);
  const day = localDayStart(sinceMs);
  const deltaDays = Math.round((today - day) / DAY_MS);
  if (deltaDays <= 0) return "since today";
  if (deltaDays === 1) return "since yesterday";
  if (deltaDays < 7) {
    return `since ${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
      new Date(sinceMs),
    )}`;
  }
  return `since ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(sinceMs),
  )}`;
}

/** The strip line itself — terse, no exclamation (kanna voice). */
export function formatNewSinceVisitLine(
  episodeCount: number,
  sinceMs: number,
  nowMs: number,
): string {
  const episodes = episodeCount === 1 ? "1 new episode" : `${episodeCount} new episodes`;
  return `${episodes} ${formatSinceVisitDayLabel(sinceMs, nowMs)}`;
}

export const RETURN_LOOP_NAV_HINT = "/calendar for schedule · /history for shows";

export const RETURN_LOOP_HISTORY_SUBTITLE = "Resume first, then picks ready for you now.";

export const RETURN_LOOP_HISTORY_NEW_SECTION = "Ready for you now";

export const RETURN_LOOP_HISTORY_NEW_EMPTY =
  "Nothing ready for you now — you're caught up on tracked shows.";

export const RETURN_LOOP_CALENDAR_EMPTY_TAIL =
  "Tracked releases ready for you now appear under For you when they drop.";

export const RETURN_LOOP_POST_PLAY_CAUGHT_UP_CALENDAR = "see what's ready for you now";
