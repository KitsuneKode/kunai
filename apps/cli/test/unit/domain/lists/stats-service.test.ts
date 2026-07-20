import { expect, test } from "bun:test";

import { StatsService } from "@/domain/lists/StatsService";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeStatsService(): { service: StatsService; history: HistoryRepository } {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return { service: new StatsService(db), history: new HistoryRepository(db) };
}

// Relative timestamps keep these fixtures inside the default 30-day stats
// window regardless of when the suite runs (absolute dates silently expire).
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

test("getStats uses watched_seconds and completed episodes for honesty", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "show-a", kind: "series", title: "Show A" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_200,
    durationSeconds: 1_200,
    completed: true,
    watchedSeconds: 900,
    updatedAt: daysAgo(3),
  });
  history.upsertProgress({
    title: { id: "show-a", kind: "series", title: "Show A" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 400,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 400,
    updatedAt: daysAgo(2),
  });

  const stats = service.getStats(30);

  expect(stats.totalEpisodes).toBe(1);
  expect(stats.completedEpisodes).toBe(1);
  expect(stats.completionRate).toBe(0.5);
  expect(stats.totalSeconds).toBe(1_300);
});

test("getStats honors windowDays for heatmap and weekly buckets", () => {
  const { service, history } = makeStatsService();

  // Use relative dates so this test stays valid regardless of when it runs.
  // "recent" is 2 days ago (well inside the 7-day window).
  // "old" is 200 days ago (outside the 7-day window but captured by allTime).
  const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const oldDate = new Date(Date.now() - 200 * 86_400_000).toISOString();

  history.upsertProgress({
    title: { id: "recent", kind: "series", title: "Recent" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: recentDate,
  });
  history.upsertProgress({
    title: { id: "old", kind: "series", title: "Old" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 2_000,
    updatedAt: oldDate,
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
    updatedAt: daysAgo(3),
  });
  history.upsertProgress({
    title: { id: "tmdb:2", kind: "series", title: "Regular Drama" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 500,
    providerId: "videasy",
    updatedAt: daysAgo(2),
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
    updatedAt: daysAgo(3),
  });
  history.upsertProgress({
    title: { id: "done", kind: "series", title: "Done Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: daysAgo(2),
  });
  history.upsertProgress({
    title: { id: "partial", kind: "series", title: "Partial Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 500,
    durationSeconds: 1_000,
    completed: false,
    watchedSeconds: 500,
    updatedAt: daysAgo(1),
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
    updatedAt: daysAgo(2),
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
  const now = Date.now();

  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: new Date(now - 2 * 86400000).toISOString(),
  });
  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: new Date(now - 86400000).toISOString(),
  });

  const stats = service.getStats(10);
  expect(stats.avgEpisodesPerDay).toBe(0.2);
});

test("all-time avgEpisodesPerDay uses active days, not the sentinel window", () => {
  const { service, history } = makeStatsService();
  const now = Date.now();

  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: new Date(now - 2 * 86400000).toISOString(),
  });
  history.upsertProgress({
    title: { id: "show", kind: "series", title: "Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: new Date(now - 86400000).toISOString(),
  });

  const stats = service.getStats(99_999);
  expect(stats.activeDays).toBe(2);
  expect(stats.avgEpisodesPerDay).toBe(1);
});

test("getStats includes video kind in type breakdown", () => {
  const { service, history } = makeStatsService();

  history.upsertProgress({
    title: { id: "youtube:abc", kind: "video", title: "Clip" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 600,
    durationSeconds: 600,
    completed: true,
    watchedSeconds: 600,
    updatedAt: daysAgo(3),
  });

  const stats = service.getStats(30, "video");
  expect(stats.typeBreakdown.videoSeconds).toBe(600);
  expect(stats.totalSeconds).toBe(600);
});
