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
  const dir = mkdtempSync(join(tmpdir(), "kunai-ledger-provider-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  const repo = new HistoryRepository(db);
  const events = new PlaybackEventRepository(db);
  return { ledger: new PlaybackHistoryLedger(repo, events), repo };
}

const title = { id: "show-1", kind: "anime" as const, title: "Demo Show" };
const episode = { season: 1, episode: 3 };

test("alignProvider updates checkpoint providerId", () => {
  const { ledger, repo } = makeLedger();

  ledger.start({ title, episode, mediaKind: "anime", providerId: "allanime" }, 0);
  ledger.alignProvider("miruro");
  ledger.onProgress(45, 1_400);
  ledger.checkpoint();

  expect(repo.getProgress(title, episode)?.providerId).toBe("miruro");
});

test("sub-engage checkpoint does not invent lastWatchedAt on net-new row", () => {
  const { ledger, repo } = makeLedger();

  ledger.start({ title, episode, mediaKind: "anime", providerId: "miruro" }, 0);
  ledger.onProgress(15, 1_400);
  ledger.checkpoint();

  const row = repo.getProgress(title, episode);
  expect(row?.positionSeconds).toBe(15);
  expect(row?.lastWatchedAt).toBeUndefined();
});
