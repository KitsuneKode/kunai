import { expect, test } from "bun:test";

import { markSeasonThroughEpisode } from "@/app/search/history-actions";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeRepo(): HistoryRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

const title = { id: "show-1", kind: "series" as const, title: "Demo Show" };

test("markSeasonThroughEpisode marks episodes 1 through N via markWatched", () => {
  const calls: Array<{ season: number; episode: number }> = [];
  const spy = {
    markWatched: (_title: typeof title, episode?: { season: number; episode: number }) => {
      if (episode) calls.push({ season: episode.season, episode: episode.episode });
    },
  };

  const count = markSeasonThroughEpisode(spy, title, 2, 3);

  expect(count).toBe(3);
  expect(calls).toEqual([
    { season: 2, episode: 1 },
    { season: 2, episode: 2 },
    { season: 2, episode: 3 },
  ]);
});

test("markSeasonThroughEpisode clamps throughEpisode to at least 1", () => {
  const repo = makeRepo();
  const count = markSeasonThroughEpisode(repo, title, 1, 0);

  expect(count).toBe(1);
  expect(repo.getProgress(title, { season: 1, episode: 1 })?.completed).toBe(true);
});

test("markSeasonThroughEpisode writes completed rows for each episode", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title,
    episode: { season: 1, episode: 2 },
    positionSeconds: 400,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 400,
  });

  markSeasonThroughEpisode(repo, title, 1, 2);

  expect(repo.getProgress(title, { season: 1, episode: 1 })?.completed).toBe(true);
  expect(repo.getProgress(title, { season: 1, episode: 2 })?.completed).toBe(true);
  expect(repo.getProgress(title, { season: 1, episode: 2 })?.positionSeconds).toBe(1_200);
});
