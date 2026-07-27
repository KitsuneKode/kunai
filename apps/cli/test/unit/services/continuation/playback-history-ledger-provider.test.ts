import { afterEach, expect, test } from "bun:test";

import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import { HistoryRepository, PlaybackEventRepository } from "@kunai/storage";

import { createTempStoreRegistry } from "../../../helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function makeLedger(): { ledger: PlaybackHistoryLedger; repo: HistoryRepository } {
  const dir = stores.dir("ledger-provider");
  const db = stores.db(dir);
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
