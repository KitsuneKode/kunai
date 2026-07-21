import { expect, test } from "bun:test";

import { resumeSecondsFromHistoryForEpisode } from "@/app/playback/playback-resume-from-history";
import type { EpisodeInfo } from "@/domain/types";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

const ep: EpisodeInfo = { season: 1, episode: 3 };
const title = { id: "t:1", kind: "series" as const, title: "X" };

function makeRepo(): HistoryRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

test("resumeSecondsFromHistoryForEpisode returns 0 when no row", () => {
  expect(resumeSecondsFromHistoryForEpisode(makeRepo(), title, ep, "credits-or-90-percent")).toBe(
    0,
  );
});

test("resumeSecondsFromHistoryForEpisode returns position when partial", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title,
    episode: { season: 1, episode: 3 },
    positionSeconds: 222,
    durationSeconds: 800,
    completed: false,
  });
  expect(resumeSecondsFromHistoryForEpisode(repo, title, ep, "credits-or-90-percent")).toBe(222);
});

test("resumeSecondsFromHistoryForEpisode returns 0 when completed", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title,
    episode: { season: 1, episode: 3 },
    positionSeconds: 790,
    durationSeconds: 800,
    completed: true,
  });
  expect(resumeSecondsFromHistoryForEpisode(repo, title, ep, "credits-or-90-percent")).toBe(0);
});

test("resumeSecondsFromHistoryForEpisode does not inherit S1E3 progress onto S1E4", () => {
  const repo = makeRepo();
  const series = {
    id: "tmdb:42",
    kind: "series" as const,
    title: "Demo",
    externalIds: { tmdbId: "42" },
  };
  repo.upsertProgress({
    title: series,
    episode: { season: 1, episode: 3 },
    positionSeconds: 333,
    durationSeconds: 900,
    completed: false,
  });

  expect(
    resumeSecondsFromHistoryForEpisode(
      repo,
      series,
      { season: 1, episode: 4 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
  expect(
    resumeSecondsFromHistoryForEpisode(
      repo,
      series,
      { season: 1, episode: 3 },
      "credits-or-90-percent",
    ),
  ).toBe(333);
});

test("resumeSecondsFromHistoryForEpisode does not treat absolute E13 as S2E1", () => {
  const repo = makeRepo();
  const anime = {
    id: "1535",
    kind: "anime" as const,
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  };
  repo.upsertProgress({
    title: anime,
    episode: { absoluteEpisode: 13 },
    positionSeconds: 640,
    durationSeconds: 1400,
    completed: false,
  });

  // S2E1 without absolute identity must not inherit abs E13 progress.
  expect(
    resumeSecondsFromHistoryForEpisode(
      repo,
      anime,
      { season: 2, episode: 1 },
      "credits-or-90-percent",
    ),
  ).toBe(0);
});

test("resumeSecondsFromHistoryForEpisode resumes absolute-only row via absolute identity", () => {
  const repo = makeRepo();
  const anime = {
    id: "1535",
    kind: "anime" as const,
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  };
  repo.upsertProgress({
    title: anime,
    episode: { absoluteEpisode: 13 },
    positionSeconds: 640,
    durationSeconds: 1400,
    completed: false,
  });

  // Abs-only queue/UI shape is synthetic S1E{abs} plus absoluteEpisode.
  expect(
    resumeSecondsFromHistoryForEpisode(
      repo,
      anime,
      { season: 1, episode: 13, absoluteEpisode: 13 },
      "credits-or-90-percent",
    ),
  ).toBe(640);
});

test("resumeSecondsFromHistoryForEpisode resolves bare TMDB lookup to tmdb: history", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: {
      id: "tmdb:99",
      kind: "series",
      title: "Show",
      externalIds: { tmdbId: "99" },
    },
    episode: { season: 1, episode: 2 },
    positionSeconds: 111,
    durationSeconds: 800,
    completed: false,
  });

  expect(
    resumeSecondsFromHistoryForEpisode(
      repo,
      {
        id: "99",
        kind: "series",
        title: "Show",
        externalIds: { tmdbId: "99" },
      },
      { season: 1, episode: 2 },
      "credits-or-90-percent",
    ),
  ).toBe(111);
});
