import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HistoryRepository, openKunaiDatabase, runMigrations } from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(): HistoryRepository {
  const dir = mkdtempSync(join(tmpdir(), "kunai-history-ledger-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return new HistoryRepository(db);
}

const title = { id: "show-1", kind: "series" as const, title: "Demo Show" };
const episode = { season: 1, episode: 3 };

test("markWatched sets completed, completed_at, and snaps position when duration known", () => {
  const r = repo();
  r.upsertProgress({
    title,
    episode,
    positionSeconds: 400,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 400,
    updatedAt: "2026-06-01T00:00:00.000Z",
  });

  r.markWatched(title, episode, "2026-06-20T12:00:00.000Z");

  const row = r.getProgress(title, episode);
  expect(row?.completed).toBe(true);
  expect(row?.positionSeconds).toBe(1_200);
  expect(row?.watchedSeconds).toBe(1_200);
  expect(row?.completedAt).toBe("2026-06-20T12:00:00.000Z");
  expect(row?.lastWatchedAt).toBe("2026-06-20T12:00:00.000Z");
});

test("markUnwatched clears completed while preserving position and watched_seconds", () => {
  const r = repo();
  r.markWatched(title, episode, "2026-06-20T12:00:00.000Z");
  const before = r.getProgress(title, episode);
  expect(before?.completed).toBe(true);

  r.markUnwatched(title, episode, "2026-06-21T12:00:00.000Z");

  const row = r.getProgress(title, episode);
  expect(row?.completed).toBe(false);
  expect(row?.completedAt).toBeUndefined();
  expect(row?.positionSeconds).toBe(before?.positionSeconds);
  expect(row?.watchedSeconds).toBe(before?.watchedSeconds);
});

test("checkpointProgress never clears completed flag", () => {
  const r = repo();
  r.markWatched(title, episode, "2026-06-20T12:00:00.000Z");

  r.checkpointProgress({
    title,
    episode,
    positionSeconds: 1_100,
    durationSeconds: 1_200,
    watchedSeconds: 900,
    updatedAt: "2026-06-20T12:30:00.000Z",
  });

  const row = r.getProgress(title, episode);
  expect(row?.completed).toBe(true);
  expect(row?.completedAt).toBe("2026-06-20T12:00:00.000Z");
});

test("explicit low watchedSeconds cannot shrink stored engaged time", () => {
  const r = repo();
  r.upsertProgress({
    title,
    episode,
    positionSeconds: 800,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 800,
  });

  r.upsertProgress({
    title,
    episode,
    positionSeconds: 800,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 100,
  });

  expect(r.getProgress(title, episode)?.watchedSeconds).toBe(800);
});

test("upsertProgress preserves completed when the flag is omitted", () => {
  const r = repo();
  r.markWatched(title, episode, "2026-06-20T12:00:00.000Z");

  r.upsertProgress({
    title,
    episode,
    positionSeconds: 1_100,
    durationSeconds: 1_200,
    watchedSeconds: 1_100,
    updatedAt: "2026-06-20T12:30:00.000Z",
  });

  const row = r.getProgress(title, episode);
  expect(row?.completed).toBe(true);
  expect(row?.completedAt).toBe("2026-06-20T12:00:00.000Z");
});

test("re-mark watched is idempotent", () => {
  const r = repo();
  r.markWatched(title, episode, "2026-06-20T12:00:00.000Z");
  const first = r.getProgress(title, episode);

  r.markWatched(title, episode, "2026-06-21T12:00:00.000Z");
  const second = r.getProgress(title, episode);

  expect(second?.positionSeconds).toBe(first?.positionSeconds);
  expect(second?.watchedSeconds).toBe(first?.watchedSeconds);
  expect(second?.completed).toBe(true);
});
