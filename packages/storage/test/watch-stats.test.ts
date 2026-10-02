import { afterEach, expect, test } from "bun:test";

import { HistoryRepository, WatchStatsRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function repos(): { history: HistoryRepository; stats: WatchStatsRepository } {
  const db = stores.store("watch-stats", "data");
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

test("date and hour buckets follow the local calendar, not UTC", () => {
  const db = stores.store("watch-stats", "data");
  const history = new HistoryRepository(db);
  const stats = new WatchStatsRepository(db);

  // bun test pins JS Date to UTC only when TZ is unset, while SQLite
  // 'localtime' resolves the OS zone — so the oracle is a direct 'localtime'
  // query on the same connection and the repo must agree with it. On a UTC
  // machine the pair agrees with a UTC-bucketing regression too, making this
  // check vacuous; CI runs this file under a pinned non-UTC TZ (and the
  // platform storage legs run the whole package suite under one) so a
  // regression to UTC diverges there.
  const lateUtc = "2026-06-20T23:30:00.000Z";
  history.upsertProgress({
    title: { id: "edge", kind: "series", title: "Edge" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 1_000,
    durationSeconds: 1_000,
    completed: true,
    watchedSeconds: 500,
    updatedAt: lateUtc,
    lastWatchedAt: lateUtc,
  });

  const oracle = db
    .query<{ d: string; h: number }, [string, string]>(
      "SELECT date(?, 'localtime') AS d, CAST(strftime('%H', ?, 'localtime') AS INTEGER) AS h",
    )
    .get(lateUtc, lateUtc);

  const days = stats.dailyActivitySince(windowStart);
  expect(days).toHaveLength(1);
  expect(days[0]?.date).toBe(oracle?.d);

  const hours = stats.hourOfDaySince(windowStart);
  expect(hours.map((h) => h.hour)).toContain(oracle?.h ?? -1);

  expect(stats.streakDates()).toContain(oracle?.d ?? "");
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
