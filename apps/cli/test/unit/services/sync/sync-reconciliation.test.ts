import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import { reconcileSyncMutations } from "@/services/sync/reconcile-sync-mutations";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import { SyncService } from "@/services/sync/SyncService";
import {
  HistoryRepository,
  ListRepository,
  openKunaiDatabase,
  runMigrations,
  SyncOutboxRepository,
  SyncReconciliationRepository,
} from "@kunai/storage";
import { createTempStoreRegistry } from "@kunai/storage/testing";

const stores = createTempStoreRegistry();

afterEach(() => stores.cleanup());

const adapter: SyncAdapter = {
  id: "anilist",
  displayName: "AniList",
  capabilities: {
    episodeProgress: true,
    watchlistMembership: true,
    favoriteMembership: true,
    pullLists: false,
    rating: false,
  },
  isConnected: () => true,
  getConnection: () => ({ state: "connected" }),
  refreshIdentity: async () => {},
  apply: async () => ({ status: "ok" }),
  connect: async () => ({ ok: true }),
  disconnect: async () => {},
};

function fixture(enabled = true) {
  const db = stores.store("cli-sync-reconciliation");
  const outbox = new SyncOutboxRepository(db);
  const history = new HistoryRepository(db);
  const reconciliation = new SyncReconciliationRepository(db);
  const lists = new ListRepository(db);
  const gate = { enabled, trackWatched: enabled, syncList: enabled };
  const sync = new SyncService({
    adapters: [adapter],
    outbox,
    config: { read: async () => ({ sync: { anilist: gate, tmdb: gate } }) },
  });
  return { db, outbox, history, lists, reconciliation, sync };
}

test("startup reconciliation projects a durable local history fact then settles it", async () => {
  const state = fixture();
  state.history.markWatched(
    {
      id: "local-anime",
      kind: "anime",
      title: "Example",
      externalIds: { anilistId: "123" },
    },
    { season: 1, episode: 12 },
  );

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  });

  expect(result).toEqual({ processed: 1, queued: 1, retained: 0 });
  expect(state.reconciliation.listPending()).toHaveLength(0);
  expect(state.outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "progress:set",
    progress: 12,
    target: { tracker: "anilist", anilistId: 123 },
  });
});

test("list reconciliation resolves local identity before creating an opted-in outbox row", async () => {
  const state = fixture();
  state.lists.addItem({
    listId: "favorites",
    titleId: "local-anime",
    mediaKind: "anime",
    title: "Example",
    externalIds: { anilistId: "123" },
  });

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  });

  expect(result).toEqual({ processed: 1, queued: 1, retained: 0 });
  expect(state.outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "favorite-membership:set",
    present: true,
    target: { tracker: "anilist", anilistId: 123 },
  });
});

test("disabled reconciliation settles the local fact without persisting remote intent", async () => {
  const state = fixture(false);
  state.history.markWatched(
    {
      id: "local-anime",
      kind: "anime",
      title: "Example",
      externalIds: { anilistId: "123" },
    },
    { season: 1, episode: 12 },
  );

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  });

  expect(result).toEqual({ processed: 1, queued: 0, retained: 0 });
  expect(state.reconciliation.listPending()).toHaveLength(0);
  expect(state.outbox.counts().pending).toBe(0);
});

test("a hard-kill fact is replayed into the outbox after the database reopens", async () => {
  const path = join(stores.dir("cli-sync-reconciliation-restart"), "data.sqlite");
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
  const reconciliation = new SyncReconciliationRepository(reopened);
  const history = new HistoryRepository(reopened);
  const outbox = new SyncOutboxRepository(reopened);
  const gate = { enabled: true, trackWatched: true, syncList: true };
  const sync = new SyncService({
    adapters: [adapter],
    outbox,
    config: { read: async () => ({ sync: { anilist: gate, tmdb: gate } }) },
  });

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: reconciliation,
    historyRepository: history,
    syncService: sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  });

  expect(result).toEqual({ processed: 1, queued: 1, retained: 0 });
  expect(reconciliation.listPending()).toHaveLength(0);
  expect(outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "progress:set",
    progress: 12,
  });
  reopened.close(true);
});

test("outbox projection failure retains reconciliation with a bounded diagnostic", async () => {
  const state = fixture();
  state.history.markWatched(
    {
      id: "local-anime",
      kind: "anime",
      title: "Example",
      externalIds: { anilistId: "123" },
    },
    { season: 1, episode: 12 },
  );
  state.db.exec(`
    CREATE TRIGGER reject_sync_outbox
    BEFORE INSERT ON sync_outbox
    BEGIN
      SELECT RAISE(ABORT, 'sensitive sqlite detail');
    END;
  `);
  const diagnostics: unknown[] = [];

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
    diagnosticsService: { record: (entry) => diagnostics.push(entry) },
  });

  expect(result).toEqual({ processed: 0, queued: 0, retained: 1 });
  expect(state.reconciliation.listPending()).toHaveLength(1);
  expect(diagnostics).toEqual([
    {
      category: "sync",
      message: "Local sync reconciliation retained for retry",
      context: { kind: "history", error: "SQLiteError" },
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("sensitive sqlite detail");
});
