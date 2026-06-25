import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HistoryRepository,
  openKunaiDatabase,
  runMigrations,
  WatchStatsRepository,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repos(): { history: HistoryRepository; stats: WatchStatsRepository } {
  const dir = mkdtempSync(join(tmpdir(), "kunai-watch-stats-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return { history: new HistoryRepository(db), stats: new WatchStatsRepository(db) };
}

const windowStart = "2026-06-01T00:00:00.000Z";

test("activity window uses last_watched_at when it is newer than updated_at", () => {
  const { history, stats } = repos();

  history.upsertProgress({
    title: { id: "show-a", kind: "series", title: "Show A" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 1_000,
    updatedAt: "2026-05-01T12:00:00.000Z",
    lastWatchedAt: "2026-06-20T12:00:00.000Z",
  });

  const totals = stats.totalsSince(windowStart);
  expect(totals.rowCount).toBe(1);
  expect(totals.totalSeconds).toBe(1_000);

  const days = stats.dailyActivitySince(windowStart);
  expect(days).toHaveLength(1);
  expect(days[0]?.date).toBe("2026-06-20");
});

test("rows outside activity window are excluded from totals", () => {
  const { history, stats } = repos();

  history.upsertProgress({
    title: { id: "in-window", kind: "series", title: "In" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 800,
    updatedAt: "2026-06-10T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "out-window", kind: "series", title: "Out" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 2_000,
    updatedAt: "2026-05-01T12:00:00.000Z",
    lastWatchedAt: "2026-05-01T12:00:00.000Z",
  });

  const totals = stats.totalsSince(windowStart);
  expect(totals.rowCount).toBe(1);
  expect(totals.totalSeconds).toBe(800);
});

test("anime kind filter uses corrected provider markers", () => {
  const { history, stats } = repos();

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

  const animeTotals = stats.totalsSince(windowStart, "anime");
  const seriesTotals = stats.totalsSince(windowStart, "series");

  expect(animeTotals.rowCount).toBe(1);
  expect(animeTotals.totalSeconds).toBe(1_000);
  expect(seriesTotals.rowCount).toBe(1);
  expect(seriesTotals.totalSeconds).toBe(500);
});

test("seriesCompleted counts only series with every in-window episode completed", () => {
  const { history, stats } = repos();

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

  const totals = stats.totalsSince(windowStart);
  expect(totals.seriesCompleted).toBe(1);
  expect(totals.completedEpisodes).toBe(2);
  expect(totals.rowCount).toBe(3);
});

test("completedTitleWatchSecondsSince aggregates completed rows only", () => {
  const { history, stats } = repos();

  history.upsertProgress({
    title: {
      id: "show-1",
      kind: "series",
      title: "Show",
      externalIds: { tmdbId: "99" },
    },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 600,
    updatedAt: "2026-06-20T12:00:00.000Z",
  });
  history.upsertProgress({
    title: { id: "show-1", kind: "series", title: "Show" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 400,
    durationSeconds: 1_000,
    completed: false,
    watchedSeconds: 400,
    updatedAt: "2026-06-21T12:00:00.000Z",
  });

  const rows = stats.completedTitleWatchSecondsSince(windowStart);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.titleId).toBe("show-1");
  expect(rows[0]?.title).toBe("Show");
  expect(rows[0]?.totalSeconds).toBe(600);
});
