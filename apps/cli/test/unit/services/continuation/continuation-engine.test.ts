import { expect, test } from "bun:test";

import {
  groupLatestByTitle,
  projectContinuation,
} from "@/services/continuation/continuation-engine";
import type { HistoryProgress } from "@kunai/storage";

function row(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("resumes the most-recent episode when it is unfinished", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [
      row({ episode: 3, positionSeconds: 400, updatedAt: "2026-05-03T00:00:00.000Z" }),
      row({ episode: 2, completed: true, updatedAt: "2026-05-02T00:00:00.000Z" }),
    ],
  });
  expect(decision.state).toBe("resume");
  expect(decision).toMatchObject({ season: 1, episode: 3, positionSeconds: 400 });
});

test("does NOT resume an older abandoned episode when the most-recent is finished", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [
      row({ episode: 5, completed: true, updatedAt: "2026-05-05T00:00:00.000Z" }),
      row({ episode: 3, positionSeconds: 400, updatedAt: "2026-05-02T00:00:00.000Z" }),
    ],
  });
  expect(decision.state).not.toBe("resume");
  expect(decision.state).toBe("up-to-date");
});

test("finished anchor with +N aired episodes surfaces new-episodes", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 5, completed: true })],
    releaseProgress: { newEpisodeCount: 3 },
  });
  expect(decision.state).toBe("new-episodes");
  expect(decision).toMatchObject({ newEpisodeCount: 3 });
});

test("finished anchor with a sequel signal surfaces new-season", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    newSeason: { season: 2 },
  });
  expect(decision.state).toBe("new-season");
});

test("offline-ready next episode takes precedence over release signals", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 5, completed: true })],
    releaseProgress: { newEpisodeCount: 3 },
    offline: { enrolled: true, readyNextEpisodes: [{ season: 1, episode: 6, jobId: "job-1" }] },
  });
  expect(decision.state).toBe("offline-ready");
  expect(decision).toMatchObject({ season: 1, episode: 6, jobId: "job-1" });
});

test("finished anchor with only an upcoming release is airing-weekly", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    nextRelease: {
      season: 1,
      episode: 13,
      released: false,
      availableAt: "2026-06-01T00:00:00.000Z",
    },
  });
  expect(decision.state).toBe("airing-weekly");
  expect(decision).toMatchObject({ season: 1, episode: 13 });
});

test("finished anchor with a released next episode is next-up", () => {
  const decision = projectContinuation({
    titleId: "tmdb:1",
    rows: [row({ episode: 12, completed: true })],
    nextRelease: { season: 1, episode: 13, released: true },
  });
  expect(decision.state).toBe("next-up");
  expect(decision).toMatchObject({ season: 1, episode: 13 });
});

test("no rows for the title is empty", () => {
  expect(projectContinuation({ titleId: "tmdb:1", rows: [] }).state).toBe("empty");
});

test("groupLatestByTitle keeps one most-recent row per title, recency-ordered", () => {
  const grouped = groupLatestByTitle([
    row({ titleId: "a", updatedAt: "2026-05-01T00:00:00.000Z" }),
    row({ titleId: "a", updatedAt: "2026-05-04T00:00:00.000Z" }),
    row({ titleId: "b", updatedAt: "2026-05-03T00:00:00.000Z" }),
  ]);
  expect(grouped.map((r) => r.titleId)).toEqual(["a", "b"]);
  expect(grouped[0]?.updatedAt).toBe("2026-05-04T00:00:00.000Z");
});

test("groupLatestByTitle dedupes forked rows that share the same catalog id", () => {
  const grouped = groupLatestByTitle([
    row({
      titleId: "bxCKTopaque",
      externalIds: { anilistId: "20431" },
      mediaKind: "anime",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }),
    row({
      titleId: "20431",
      externalIds: { anilistId: "20431" },
      mediaKind: "anime",
      updatedAt: "2026-05-04T00:00:00.000Z",
    }),
  ]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0]?.titleId).toBe("20431");
});
