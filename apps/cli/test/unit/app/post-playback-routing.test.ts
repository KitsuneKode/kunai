import { describe, expect, test } from "bun:test";

import {
  resolvePostPlaybackEpisodeNavigationRoute,
  resolvePostPlaybackExitOutcome,
  resolvePostPlaybackTrackPanelSection,
} from "@/app/post-playback-routing";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";

const availability: EpisodeAvailability = {
  previousEpisode: { season: 1, episode: 4 },
  nextEpisode: { season: 1, episode: 6 },
  nextSeasonEpisode: { season: 2, episode: 1 },
  upcomingNext: null,
  animeNextReleaseUnknown: false,
  tmdbUnavailable: false,
};

describe("post playback routing", () => {
  test("maps shell exit routes to playback outcomes", () => {
    expect(resolvePostPlaybackExitOutcome("quit")).toEqual({ status: "quit" });
    expect(resolvePostPlaybackExitOutcome("mode-switch")).toEqual({
      status: "success",
      value: "back_to_search",
    });
    expect(resolvePostPlaybackExitOutcome("calendar")).toEqual({
      status: "success",
      value: { type: "browse_route", route: "calendar" },
    });
  });

  test("maps history-entry routes without losing the episode", () => {
    expect(
      resolvePostPlaybackExitOutcome({
        type: "history-entry",
        title: { id: "1396", name: "Demo", type: "series" },
        episode: { season: 3, episode: 2 },
      }),
    ).toEqual({
      status: "success",
      value: {
        type: "history_entry",
        title: { id: "1396", name: "Demo", type: "series" },
        episode: { season: 3, episode: 2 },
      },
    });
  });

  test("resolves post-play episode navigation only for series", () => {
    expect(
      resolvePostPlaybackEpisodeNavigationRoute({
        action: "previous",
        titleType: "series",
        availability,
      }),
    ).toEqual({ episode: { season: 1, episode: 4 }, source: "previous" });

    expect(
      resolvePostPlaybackEpisodeNavigationRoute({
        action: "next",
        titleType: "movie",
        availability,
      }),
    ).toBeNull();
  });

  test("maps track routes to their initial panel section", () => {
    expect(resolvePostPlaybackTrackPanelSection("provider")).toBe("provider");
    expect(resolvePostPlaybackTrackPanelSection("quality")).toBe("quality");
    expect(resolvePostPlaybackTrackPanelSection("download")).toBeNull();
  });
});
