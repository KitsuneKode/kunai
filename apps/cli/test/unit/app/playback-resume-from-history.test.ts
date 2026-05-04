import { expect, test } from "bun:test";

import { resumeSecondsFromHistoryForEpisode } from "@/app/playback-resume-from-history";
import type { EpisodeInfo } from "@/domain/types";
import type { HistoryEntry, HistoryStore } from "@/services/persistence/HistoryStore";

const ep: EpisodeInfo = { season: 1, episode: 3 };

function makeStore(entries: readonly HistoryEntry[]): HistoryStore {
  return {
    get: async () => null,
    getAll: async () => ({}),
    listByTitle: async () => entries,
    save: async () => {},
    delete: async () => {},
    clear: async () => {},
  };
}

test("resumeSecondsFromHistoryForEpisode returns 0 when no row", async () => {
  const s = makeStore([]);
  expect(await resumeSecondsFromHistoryForEpisode(s, "t:1", ep, "credits-or-90-percent")).toBe(0);
});

test("resumeSecondsFromHistoryForEpisode returns timestamp when partial", async () => {
  const entry: HistoryEntry = {
    title: "X",
    type: "series",
    season: 1,
    episode: 3,
    timestamp: 222,
    duration: 800,
    completed: false,
    provider: "p",
    watchedAt: new Date().toISOString(),
  };
  const s = makeStore([entry]);
  expect(await resumeSecondsFromHistoryForEpisode(s, "t:1", ep, "credits-or-90-percent")).toBe(222);
});

test("resumeSecondsFromHistoryForEpisode returns 0 when completed", async () => {
  const entry: HistoryEntry = {
    title: "X",
    type: "series",
    season: 1,
    episode: 3,
    timestamp: 790,
    duration: 800,
    completed: true,
    provider: "p",
    watchedAt: new Date().toISOString(),
  };
  const s = makeStore([entry]);
  expect(await resumeSecondsFromHistoryForEpisode(s, "t:1", ep, "credits-or-90-percent")).toBe(0);
});
