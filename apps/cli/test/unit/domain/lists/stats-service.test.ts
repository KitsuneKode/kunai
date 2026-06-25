import { expect, test } from "bun:test";

import { StatsService } from "@/domain/lists/StatsService";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeStatsService(): { service: StatsService; history: HistoryRepository } {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return { service: new StatsService(db), history: new HistoryRepository(db) };
}

test("getStats uses watched_seconds and completed episodes for honesty", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "show-a", kind: "series", title: "Show A" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_200,
    durationSeconds: 1_200,
    completed: true,
    watchedSeconds: 900,
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "show-a", kind: "series", title: "Show A" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 400,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 400,
    updatedAt: "2026-06-21T12:00:00.000Z",
  });

  const stats = service.getStats(30);

  expect(stats.totalEpisodes).toBe(1);
  expect(stats.completedEpisodes).toBe(1);
  expect(stats.completionRate).toBe(0.5);
  expect(stats.totalSeconds).toBe(1_300);
});

test("getStats honors windowDays for heatmap and weekly buckets", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "recent", kind: "series", title: "Recent" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "old", kind: "series", title: "Old" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 2_000,
    updatedAt: "2026-01-01T12:00:00.000Z",
  });

  const sevenDay = service.getStats(7);
  const allTime = service.getStats(99_999);

  expect(sevenDay.heatmap).toHaveLength(1);
  expect(sevenDay.totalSeconds).toBe(1_000);
  expect(allTime.heatmap.length).toBeGreaterThanOrEqual(2);
  expect(allTime.totalSeconds).toBe(3_000);
  expect(sevenDay.weeklyBuckets.length).toBeLessThanOrEqual(allTime.weeklyBuckets.length);
});

test("anime kind filter uses corrected provider markers", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "aa:1", kind: "series", title: "Via AllAnime" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    providerId: "allanime",
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "tmdb:2", kind: "series", title: "Regular Drama" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 500,
    providerId: "videasy",
    updatedAt: "2026-06-20T13:00:00.000Z",
  });

  const animeStats = service.getStats(30, "anime");
  const seriesStats = service.getStats(30, "series");

  expect(animeStats.totalEpisodes).toBe(1);
  expect(animeStats.totalSeconds).toBe(1_000);
  expect(seriesStats.totalEpisodes).toBe(1);
  expect(seriesStats.totalSeconds).toBe(500);
});

test("computeStreak breaks on gaps and counts longest run", () => {
  const { service, history } = makeStatsService();
  const day = (offset: number) =>
    new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  const days = [day(0), day(1), day(3), day(4), day(5)];

  for (const [index, watchDay] of days.entries()) {
    history.upsertProgress({
      title: { id: `title-${index}`, kind: "series", title: `Title ${index}` },
      episode: { season: 1, episode: 1 },
      positionSeconds: 1_000,
      durationSeconds: 1_000,
      completed: true,
      watchedSeconds: 1_000,
      updatedAt: `${watchDay}T20:00:00.000Z`,
    });
  }

  const streak = service.computeStreak();
  expect(streak.current).toBe(2);
  expect(streak.longest).toBe(3);
});

test("seriesCompleted counts titles with all stored episodes completed", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "done", kind: "series", title: "Done Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "done", kind: "series", title: "Done Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-06-21T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "partial", kind: "series", title: "Partial Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 500,
    durationSeconds: 1_000,
    completed: false,
    watchedSeconds: 500,
    updatedAt: "2026-06-21T13:00:00.000Z",
  });

  const stats = service.getStats(30);
  expect(stats.seriesCompleted).toBe(1);
});

test("exportStatsJson and exportStatsCsv include extended metrics", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Export Me" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    providerId: "allanime",
    updatedAt: "2026-06-20T21:00:00.000Z",
  });

  const json = service.exportStatsJson(30);
  const csv = service.exportStatsCsv(30);

  expect(json).toContain('"completedEpisodes": 1');
  expect(json).toContain('"providerBreakdown"');
  expect(csv).toContain("summary,avgEpisodesPerDay,");
  expect(csv).toContain("providers,allanime,1,1000");
  expect(csv).toContain("Export Me");
});

test("avgEpisodesPerDay divides completed episodes by window length", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-06-21T12:00:00.000Z",
  });

  const stats = service.getStats(10);
  expect(stats.avgEpisodesPerDay).toBe(0.2);
});
