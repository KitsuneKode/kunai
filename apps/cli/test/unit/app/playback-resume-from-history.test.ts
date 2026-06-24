import { expect, test } from "bun:test";

import { resumeSecondsFromHistoryForEpisode } from "@/app/playback/playback-resume-from-history";
import type { EpisodeInfo } from "@/domain/types";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

const ep: EpisodeInfo = { season: 1, episode: 3 };

function makeRepo(): HistoryRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

test("resumeSecondsFromHistoryForEpisode returns 0 when no row", () => {
  expect(resumeSecondsFromHistoryForEpisode(makeRepo(), "t:1", ep, "credits-or-90-percent")).toBe(
    0,
  );
});

test("resumeSecondsFromHistoryForEpisode returns position when partial", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "t:1", kind: "series", title: "X" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 222,
    durationSeconds: 800,
    completed: false,
  });
  expect(resumeSecondsFromHistoryForEpisode(repo, "t:1", ep, "credits-or-90-percent")).toBe(222);
});

test("resumeSecondsFromHistoryForEpisode returns 0 when completed", () => {
  const repo = makeRepo();
  repo.upsertProgress({
    title: { id: "t:1", kind: "series", title: "X" },
    episode: { season: 1, episode: 3 },
    positionSeconds: 790,
    durationSeconds: 800,
    completed: true,
  });
  expect(resumeSecondsFromHistoryForEpisode(repo, "t:1", ep, "credits-or-90-percent")).toBe(0);
});
