import { expect, test } from "bun:test";

import { buildStatsView } from "@/app-shell/stats-view";
import { StatsFormatter } from "@/domain/lists/StatsFormatter";
import type { WatchStats } from "@/domain/lists/StatsService";
import { localDayKey } from "@/domain/local-day-key";

function makeStats(overrides: Partial<WatchStats> = {}): WatchStats {
  return {
    streakDays: 0,
    longestStreak: 0,
    totalEpisodes: 1,
    completedEpisodes: 1,
    completionRate: 1,
    seriesCompleted: 0,
    totalSeconds: 3_600,
    avgEpisodesPerDay: 1,
    activeDays: 1,
    mostActiveDay: null,
    typeBreakdown: {
      animeSeconds: 0,
      seriesSeconds: 3_600,
      movieSeconds: 0,
      videoSeconds: 0,
    },
    providerBreakdown: [],
    hourOfDay: [],
    dailyKindMix: [],
    heatmap: [],
    topShows: [],
    weeklyBuckets: [],
    genreBreakdown: [],
    genreAffinityNote: null,
    ...overrides,
  };
}

test("heatmap cells are keyed to local days, matching 'localtime' SQL buckets", () => {
  // Yesterday on the local calendar is the day the SQL 'localtime' bucket emits
  // for last night's watch. A UTC-slice lookup in the view used to miss it in
  // every UTC+ timezone.
  const nowMs = Date.now();
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);

  const stats = makeStats({
    heatmap: [{ date: yesterdayKey, watchedCount: 4, totalSeconds: 3_600 }],
  });

  const view = buildStatsView({
    stats,
    statsFormatter: new StatsFormatter(),
    tab: "overview",
    range: "all",
    kind: "all",
    innerWidth: 120,
    availableRows: 30,
    nowMs,
  });

  const cell = view.heatmap?.grid
    .flatMap((week) => week.cells)
    .find((c) => c.date === yesterdayKey);

  expect(cell).toBeDefined();
  expect(cell?.count).toBe(4);
  expect(cell?.char).not.toBe("·");
});
