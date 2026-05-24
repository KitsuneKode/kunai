import { expect, test } from "bun:test";

import { projectContinuationState } from "@/services/continuation/continuation-policy";

const baseEntry = {
  title: "Weekly Show",
  type: "series" as const,
  season: 1,
  provider: "vidking",
  duration: 1200,
  watchedAt: "2026-05-10T00:00:00.000Z",
};

test("continuation policy prefers newest unfinished episode over completed newer history noise", () => {
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [
      ["tmdb:1", { ...baseEntry, episode: 6, timestamp: 120, completed: false }],
      ["tmdb:1", { ...baseEntry, episode: 5, timestamp: 1200, completed: true }],
    ],
  });

  expect(projection).toMatchObject({
    kind: "resume-unfinished",
    season: 1,
    episode: 6,
  });
});

test("continuation policy offers the newly released next episode without mutating watched history", () => {
  const completedEpisodeFive = { ...baseEntry, episode: 5, timestamp: 1200, completed: true };
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [["tmdb:1", completedEpisodeFive]],
    nextRelease: {
      season: 1,
      episode: 6,
      released: true,
    },
  });

  expect(projection).toEqual({
    kind: "next-released",
    titleId: "tmdb:1",
    title: "Weekly Show",
    season: 1,
    episode: 6,
    sourceEntry: completedEpisodeFive,
  });
});

test("continuation policy reports upcoming next episode without autoplaying it", () => {
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [["tmdb:1", { ...baseEntry, episode: 5, timestamp: 1200, completed: true }]],
    nextRelease: {
      season: 1,
      episode: 6,
      released: false,
      availableAt: "2026-05-24T12:00:00.000Z",
    },
  });

  expect(projection).toMatchObject({
    kind: "upcoming",
    season: 1,
    episode: 6,
    availableAt: "2026-05-24T12:00:00.000Z",
  });
});

test("continuation policy prefers ready offline continuation while retaining catalog new count", () => {
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [["tmdb:1", { ...baseEntry, episode: 5, timestamp: 1200, completed: true }]],
    releaseProgress: { newEpisodeCount: 3 },
    offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 6 }] },
  });

  expect(projection).toMatchObject({
    kind: "offline-ready",
    season: 1,
    episode: 6,
    badge: "3 new",
    primaryAction: { kind: "play-local", season: 1, episode: 6 },
    freshness: "cached",
  });
});
