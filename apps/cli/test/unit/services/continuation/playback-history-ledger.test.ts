import { afterEach, expect, test } from "bun:test";

import { ActivePlaybackCheckpoint } from "@/services/continuation/active-playback-checkpoint";
import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import { HistoryRepository, PlaybackEventRepository } from "@kunai/storage";

import { createTempStoreRegistry } from "../../../helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

const CONTEXT = {
  title: { id: "show-1", kind: "series" as const, title: "Demo Show" },
  episode: { season: 1, episode: 3 },
  mediaKind: "series" as const,
};

function makeHarness(): {
  ledger: PlaybackHistoryLedger;
  history: HistoryRepository;
  active: ActivePlaybackCheckpoint;
} {
  const dir = stores.dir("ledger-discard");
  const db = stores.db(dir);
  const history = new HistoryRepository(db);
  const events = new PlaybackEventRepository(db);
  return {
    ledger: new PlaybackHistoryLedger(history, events),
    history,
    active: new ActivePlaybackCheckpoint(),
  };
}

test("rejected short session cannot be flushed on shutdown", () => {
  const { ledger, history, active } = makeHarness();
  ledger.start(CONTEXT, 0);
  ledger.onProgress(4, 1400);
  const unregister = active.register(() => ledger.checkpoint());
  ledger.discard();
  unregister();
  active.flush();
  expect(history.listAllProgress()).toEqual([]);
});

test("discard is idempotent and clears state even if flush still holds a callback", () => {
  const { ledger, history, active } = makeHarness();
  ledger.start(CONTEXT, 0);
  ledger.onProgress(4, 1400);
  active.register(() => ledger.checkpoint());
  ledger.discard();
  ledger.discard();
  active.flush();
  expect(history.listAllProgress()).toEqual([]);
});
