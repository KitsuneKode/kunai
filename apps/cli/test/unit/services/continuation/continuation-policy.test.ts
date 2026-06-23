import { expect, test } from "bun:test";

import {
  projectionFromViewDecision,
  projectContinuationState,
} from "@/services/continuation/continuation-policy";

const baseEntry = {
  key: "k",
  titleId: "tmdb:1",
  title: "Weekly Show",
  mediaKind: "series" as const,
  season: 1,
  positionSeconds: 0,
  durationSeconds: 1200,
  completed: false,
  providerId: "vidking",
  updatedAt: "2026-05-10T00:00:00.000Z",
  createdAt: "2026-05-10T00:00:00.000Z",
};

test("continuation policy resumes the most-recent episode when it is unfinished", () => {
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [
      [
        "tmdb:1",
        {
          ...baseEntry,
          episode: 6,
          positionSeconds: 120,
          completed: false,
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      [
        "tmdb:1",
        {
          ...baseEntry,
          episode: 5,
          positionSeconds: 1200,
          completed: true,
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
      ],
    ],
  });

  expect(projection).toMatchObject({
    kind: "resume-unfinished",
    season: 1,
    episode: 6,
  });
});

test("continuation policy does NOT resume an older abandoned episode when the most-recent is finished", () => {
  // Anchor rule regression guard: most-recent finished -> advance, never scan back.
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [
      [
        "tmdb:1",
        {
          ...baseEntry,
          episode: 6,
          positionSeconds: 1200,
          completed: true,
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
      [
        "tmdb:1",
        {
          ...baseEntry,
          episode: 5,
          positionSeconds: 120,
          completed: false,
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
      ],
    ],
  });

  expect(projection).toMatchObject({
    kind: "up-to-date",
    title: "Weekly Show",
  });
});

test("continuation policy offers the newly released next episode without mutating watched history", () => {
  const completedEpisodeFive = { ...baseEntry, episode: 5, positionSeconds: 1200, completed: true };
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
    entries: [["tmdb:1", { ...baseEntry, episode: 5, positionSeconds: 1200, completed: true }]],
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
    entries: [["tmdb:1", { ...baseEntry, episode: 5, positionSeconds: 1200, completed: true }]],
    releaseProgress: { newEpisodeCount: 3 },
    offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 6, jobId: "job-6" }] },
  });

  expect(projection).toMatchObject({
    kind: "offline-ready",
    season: 1,
    episode: 6,
    badge: "3 new",
    primaryAction: { kind: "play-local", season: 1, episode: 6, jobId: "job-6" },
    freshness: "cached",
  });
});

test("continuation policy surfaces release-progress-only new episodes", () => {
  const projection = projectContinuationState({
    titleId: "tmdb:1",
    entries: [["tmdb:1", { ...baseEntry, episode: 5, positionSeconds: 1200, completed: true }]],
    releaseProgress: { newEpisodeCount: 3 },
  });

  expect(projection).toMatchObject({
    kind: "new-episodes",
    titleId: "tmdb:1",
    title: "Weekly Show",
    badge: "3 new",
    freshness: "cached",
  });
});

test("projectionFromViewDecision preserves offline-ready local action and online secondary", () => {
  const projection = projectionFromViewDecision({
    state: "offline-ready",
    target: {
      titleId: "tmdb:1",
      title: "Weekly Show",
      mediaKind: "series",
      season: 1,
      episode: 6,
      sourceEntry: baseEntry,
    },
    badge: "downloaded",
    detail: "downloaded copy ready",
    primaryAction: {
      kind: "play-local",
      jobId: "job-6",
      target: {
        titleId: "tmdb:1",
        title: "Weekly Show",
        mediaKind: "series",
        season: 1,
        episode: 6,
        sourceEntry: baseEntry,
      },
    },
    secondaryActions: [
      {
        kind: "select-online",
        target: {
          titleId: "tmdb:1",
          title: "Weekly Show",
          mediaKind: "series",
          season: 1,
          episode: 6,
          sourceEntry: baseEntry,
        },
      },
    ],
    freshness: "local",
  });

  expect(projection).toMatchObject({
    kind: "offline-ready",
    season: 1,
    episode: 6,
    badge: "downloaded",
    detail: "downloaded copy ready",
    primaryAction: { kind: "play-local", season: 1, episode: 6, jobId: "job-6" },
    secondaryActions: [{ kind: "select-online", season: 1, episode: 6 }],
    freshness: "local",
  });
});

test("projectionFromViewDecision preserves next-up decision details and freshness", () => {
  const projection = projectionFromViewDecision({
    state: "next-up",
    target: {
      titleId: "tmdb:1",
      title: "Weekly Show",
      mediaKind: "series",
      season: 1,
      episode: 6,
      sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    },
    badge: "next",
    detail: "next episode ready",
    primaryAction: {
      kind: "select-online",
      target: {
        titleId: "tmdb:1",
        title: "Weekly Show",
        mediaKind: "series",
        season: 1,
        episode: 6,
        sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
      },
    },
    secondaryActions: [],
    freshness: "stale",
  });

  expect(projection).toEqual({
    kind: "next-released",
    titleId: "tmdb:1",
    title: "Weekly Show",
    season: 1,
    episode: 6,
    sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    badge: "next",
    detail: "next episode ready",
    primaryAction: { kind: "select-online", season: 1, episode: 6 },
    secondaryActions: [],
    freshness: "stale",
  });
});

test("projectionFromViewDecision preserves airing-weekly availableAt metadata", () => {
  const projection = projectionFromViewDecision({
    state: "airing-weekly",
    target: {
      titleId: "tmdb:1",
      title: "Weekly Show",
      mediaKind: "series",
      season: 1,
      episode: 6,
      sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    },
    availableAt: "2026-05-24T12:00:00.000Z",
    badge: undefined,
    detail: "next release is not provider-confirmed",
    primaryAction: undefined,
    secondaryActions: [],
    freshness: "cached",
  });

  expect(projection).toEqual({
    kind: "upcoming",
    titleId: "tmdb:1",
    title: "Weekly Show",
    season: 1,
    episode: 6,
    availableAt: "2026-05-24T12:00:00.000Z",
    sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    badge: undefined,
    detail: "next release is not provider-confirmed",
    secondaryActions: [],
    freshness: "cached",
  });
});

test("projectionFromViewDecision preserves new-episodes badge and freshness", () => {
  const projection = projectionFromViewDecision({
    state: "new-episodes",
    target: {
      titleId: "tmdb:1",
      title: "Weekly Show",
      mediaKind: "series",
      season: 1,
      episode: 5,
      sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    },
    badge: "3 new",
    detail: undefined,
    primaryAction: undefined,
    secondaryActions: [],
    freshness: "stale",
  });

  expect(projection).toEqual({
    kind: "new-episodes",
    titleId: "tmdb:1",
    title: "Weekly Show",
    sourceEntry: { ...baseEntry, episode: 5, completed: true, positionSeconds: 1200 },
    badge: "3 new",
    secondaryActions: [],
    freshness: "stale",
  });
});
