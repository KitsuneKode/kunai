import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import {
  HistoryRepository,
  PlaybackEventRepository,
  openKunaiDatabase,
  runMigrations,
} from "@kunai/storage";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeLedger(): { ledger: PlaybackHistoryLedger; repo: HistoryRepository } {
  const dir = mkdtempSync(join(tmpdir(), "kunai-ledger-engage-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  const events = new PlaybackEventRepository(db);
  return { ledger: new PlaybackHistoryLedger(repo, events), repo };
}

const title = { id: "show-1", kind: "series" as const, title: "Demo Show" };
const episode = { season: 1, episode: 3 };

test("finalize without bumpLastWatched preserves existing lastWatchedAt", () => {
  const { ledger, repo } = makeLedger();
  const oldTimestamp = "2026-06-01T12:00:00.000Z";

  repo.upsertProgress({
    title,
    episode,
    positionSeconds: 400,
    durationSeconds: 1_400,
    completed: false,
    watchedSeconds: 400,
    lastWatchedAt: oldTimestamp,
    updatedAt: oldTimestamp,
  });

  ledger.start({ title, episode, mediaKind: "series" }, 0);
  ledger.finalize({
    positionSeconds: 0,
    durationSeconds: 1_400,
    completed: false,
    bumpLastWatched: false,
  });

  const row = repo.getProgress(title, episode);
  expect(row?.lastWatchedAt).toBe(oldTimestamp);
  expect(row?.positionSeconds).toBe(400);
});

test("DNS checkpoint does not overwrite existing resume position or lastWatchedAt", () => {
  const { ledger, repo } = makeLedger();
  const oldTimestamp = "2026-06-01T12:00:00.000Z";

  repo.upsertProgress({
    title,
    episode,
    positionSeconds: 400,
    durationSeconds: 1_400,
    completed: false,
    watchedSeconds: 400,
    lastWatchedAt: oldTimestamp,
    updatedAt: oldTimestamp,
  });

  ledger.start({ title, episode, mediaKind: "series" }, 0);
  ledger.onPaused(0, 1_400);
  ledger.checkpoint();

  const row = repo.getProgress(title, episode);
  expect(row?.positionSeconds).toBe(400);
  expect(row?.lastWatchedAt).toBe(oldTimestamp);
  expect(row?.updatedAt).toBe(oldTimestamp);
});

test("DNS abandon clears ledger without persisting on shutdown flush", () => {
  const { ledger, repo } = makeLedger();
  const oldTimestamp = "2026-06-01T12:00:00.000Z";

  repo.upsertProgress({
    title,
    episode,
    positionSeconds: 400,
    durationSeconds: 1_400,
    completed: false,
    watchedSeconds: 400,
    lastWatchedAt: oldTimestamp,
    updatedAt: oldTimestamp,
  });

  ledger.start({ title, episode, mediaKind: "series" }, 0);
  ledger.onProgress(0, 1_400);
  ledger.abandon();
  ledger.checkpoint();

  const row = repo.getProgress(title, episode);
  expect(row?.positionSeconds).toBe(400);
  expect(row?.lastWatchedAt).toBe(oldTimestamp);
});
