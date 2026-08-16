import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import {
  dataMigrations,
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

test("changed reconciliation state advances generation and rejects stale completion", () => {
  const db = stores.store("sync-reconciliation-generation");
  const reconciliation = new SyncReconciliationRepository(db);
  const item = {
    titleId: "local-anime",
    mediaKind: "anime" as const,
    title: "Example",
    externalIds: { anilistId: "123" },
  };

  const added = reconciliation.record({
    kind: "list",
    list: "favorites",
    present: true,
    item,
  });
  const removed = reconciliation.record({
    kind: "list",
    list: "favorites",
    present: false,
    item,
  });

  expect(added.generation).toBe(1);
  expect(removed).toMatchObject({ id: added.id, generation: 2 });
  expect(reconciliation.complete(added)).toBe(false);
  expect(reconciliation.listPending()).toEqual([removed]);
  expect(reconciliation.complete(removed)).toBe(true);
  expect(reconciliation.listPending()).toHaveLength(0);
});

test("generation migration upgrades an existing reconciliation queue without losing facts", () => {
  const db = openKunaiDatabase(":memory:");
  const throughReconciliation = dataMigrations.slice(
    0,
    dataMigrations.findIndex(
      (migration) => migration.id === "031_data_sync_reconciliation_generation",
    ),
  );
  runMigrations(db, "data", throughReconciliation);
  db.query(
    `INSERT INTO sync_reconciliation (
       id, mutation_kind, entity_key, payload_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "existing-fact",
    "list",
    "favorites:local-anime",
    JSON.stringify({
      kind: "list",
      list: "favorites",
      present: true,
      item: { titleId: "local-anime", mediaKind: "anime", title: "Example" },
    }),
    "2026-08-16T00:00:00.000Z",
    "2026-08-16T00:00:00.000Z",
  );

  runMigrations(db, "data");

  expect(new SyncReconciliationRepository(db).listPending()).toMatchObject([
    {
      id: "existing-fact",
      generation: 1,
      attempts: 0,
      nextAttemptAt: "2026-08-16T00:00:00.000Z",
    },
  ]);
  db.close();
});

test("deferred reconciliation is ineligible until its persisted retry time", () => {
  const db = stores.store("sync-reconciliation-backoff");
  const reconciliation = new SyncReconciliationRepository(db);
  const start = new Date("2026-08-16T00:00:00.000Z");
  const transient = reconciliation.record(
    {
      kind: "list",
      list: "favorites",
      present: true,
      item: { titleId: "transient", mediaKind: "anime", title: "Transient" },
    },
    start,
  );
  const eligible = reconciliation.record(
    {
      kind: "list",
      list: "favorites",
      present: true,
      item: {
        titleId: "eligible",
        mediaKind: "anime",
        title: "Eligible",
        externalIds: { anilistId: "123" },
      },
    },
    start,
  );

  expect(reconciliation.defer(transient, start)).toBe(true);
  expect(reconciliation.listDue(new Date(start.getTime() + 999))).toEqual([eligible]);
  expect(reconciliation.listDue(new Date(start.getTime() + 1_000))).toMatchObject([
    { id: eligible.id, attempts: 0 },
    { id: transient.id, attempts: 1, nextAttemptAt: "2026-08-16T00:00:01.000Z" },
  ]);
});

test("a newer local generation resets reconciliation backoff and becomes immediately due", () => {
  const db = stores.store("sync-reconciliation-backoff-reset");
  const reconciliation = new SyncReconciliationRepository(db);
  const start = new Date("2026-08-16T00:00:00.000Z");
  const initial = reconciliation.record(
    {
      kind: "list",
      list: "favorites",
      present: true,
      item: { titleId: "anime", mediaKind: "anime", title: "Anime" },
    },
    start,
  );
  reconciliation.defer(initial, start);

  const updated = reconciliation.record(
    {
      kind: "list",
      list: "favorites",
      present: false,
      item: { titleId: "anime", mediaKind: "anime", title: "Anime" },
    },
    new Date(start.getTime() + 100),
  );

  expect(updated).toMatchObject({ generation: 2, attempts: 0 });
  expect(reconciliation.listDue(new Date(start.getTime() + 100))).toEqual([updated]);
});
