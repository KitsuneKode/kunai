import { expect, test } from "bun:test";

import { shouldTrackTitleForNewEpisodes } from "@/services/attention/FollowedTitleService";

test("recent multi-episode watches are eligible for shelf projection and notification", () => {
  expect(
    shouldTrackTitleForNewEpisodes({
      preference: "implicit",
      recentWatchedEpisodes: 2,
      lastWatchedAt: "2026-05-16T00:00:00.000Z",
      now: "2026-05-17T00:00:00.000Z",
    }),
  ).toEqual({ shelf: true, notification: true });
});

test("muted title suppresses shelf and notification tracking", () => {
  expect(
    shouldTrackTitleForNewEpisodes({
      preference: "muted",
      recentWatchedEpisodes: 10,
      lastWatchedAt: "2026-05-17T00:00:00.000Z",
      now: "2026-05-17T01:00:00.000Z",
    }),
  ).toEqual({ shelf: false, notification: false });
});
