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

export const RETURN_LOOP_NAV_HINT = "/calendar for schedule · /history for shows";

export const RETURN_LOOP_HISTORY_SUBTITLE = "Resume first, then picks ready for you now.";

export const RETURN_LOOP_HISTORY_NEW_SECTION = "Ready for you now";

export const RETURN_LOOP_HISTORY_NEW_EMPTY =
  "Nothing ready for you now — you're caught up on tracked shows.";

export const RETURN_LOOP_CALENDAR_EMPTY_TAIL =
  "Tracked releases ready for you now appear under For you when they drop.";

export const RETURN_LOOP_POST_PLAY_CAUGHT_UP_CALENDAR = "see what's ready for you now";
