import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import {
  HistoryRepository,
  ListRepository,
  openKunaiDatabase,
  runMigrations,
  SyncReconciliationRepository,
} from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => stores.cleanup());

test("history mutation and reconciliation insert commit or roll back together", () => {
  const db = stores.store("sync-reconciliation-history-atomic");
  const history = new HistoryRepository(db);
  const reconciliation = new SyncReconciliationRepository(db);

  db.exec(`
    CREATE TRIGGER reject_sync_reconciliation
    BEFORE INSERT ON sync_reconciliation
    BEGIN
      SELECT RAISE(ABORT, 'reconciliation unavailable');
    END;
  `);

  expect(() =>
    history.upsertProgress({
      title: {
        id: "local-anime",
        kind: "anime",
        title: "Example",
        externalIds: { anilistId: "123" },
      },
      episode: { season: 1, episode: 12 },
      positionSeconds: 300,
      completed: true,
    }),
  ).toThrow("reconciliation unavailable");

  expect(history.listRecent(10)).toHaveLength(0);
  expect(reconciliation.listPending()).toHaveLength(0);
});

test("list mutation and reconciliation insert commit or roll back together", () => {
  const db = stores.store("sync-reconciliation-list-atomic");
  const lists = new ListRepository(db);

  db.exec(`
    CREATE TRIGGER reject_sync_reconciliation
    BEFORE INSERT ON sync_reconciliation
    BEGIN
      SELECT RAISE(ABORT, 'reconciliation unavailable');
    END;
  `);

  expect(() =>
    lists.addItem({
      listId: "watchlist",
      titleId: "local-anime",
      mediaKind: "anime",
      title: "Example",
      externalIds: { anilistId: "123" },
    }),
  ).toThrow("reconciliation unavailable");

  expect(lists.getItems("watchlist")).toHaveLength(0);
});

test("reconciliation survives a process restart with non-tracker local identity", () => {
  const dir = stores.dir("sync-reconciliation-restart");
  const path = join(dir, "data.sqlite");
  const firstDb = openKunaiDatabase(path);
  runMigrations(firstDb, "data");
  new HistoryRepository(firstDb).markWatched(
    {
      id: "local-anime",
      kind: "anime",
      title: "Example",
      externalIds: { anilistId: "123" },
    },
    { season: 1, episode: 12 },
  );
  firstDb.close(true);

  const reopened = openKunaiDatabase(path);
  const pending = new SyncReconciliationRepository(reopened).listPending();

  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    kind: "history",
    payload: { historyKey: "anime:local-anime:1:12:none" },
  });
  reopened.close(true);
});
