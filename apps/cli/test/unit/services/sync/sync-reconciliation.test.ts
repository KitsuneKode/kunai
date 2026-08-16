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

test("transient identity failure retains the fact without leaking error detail", async () => {
  const state = fixture();
  state.lists.addItem({
    listId: "favorites",
    titleId: "anidb:native-title",
    mediaKind: "anime",
    title: "Example",
    externalIds: { providerNativeIds: { anidb: "native-title-123" } },
  });
  const diagnostics: unknown[] = [];

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("sensitive ARM failure detail");
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
      context: { kind: "list", reason: "identity-error" },
    },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain("sensitive ARM failure detail");
});

test("a definitive missing crosswalk settles with an explicit diagnostic", async () => {
  const state = fixture();
  state.lists.addItem({
    listId: "favorites",
    titleId: "anidb:native-title",
    mediaKind: "anime",
    title: "Example",
    externalIds: { providerNativeIds: { anidb: "native-title-123" } },
  });
  const diagnostics: unknown[] = [];

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => ({ graph: { confidence: "low", source: "arm" } }),
    },
    diagnosticsService: { record: (entry) => diagnostics.push(entry) },
  });

  expect(result).toEqual({ processed: 1, queued: 0, retained: 0 });
  expect(state.reconciliation.listPending()).toHaveLength(0);
  expect(diagnostics).toEqual([
    {
      category: "sync",
      message: "Local sync reconciliation settled without a proven tracker identity",
      context: { kind: "list", reason: "no-mapping" },
    },
  ]);
});

test("AniDB history queues progress only after a proven AniList crosswalk", async () => {
  const state = fixture();
  state.history.upsertProgress({
    title: {
      id: "anidb:onigiri-3942",
      kind: "anime",
      title: "Onigiri",
      externalIds: {
        malId: "32606",
        providerNativeIds: { anidb: "onigiri-3942" },
      },
    },
    episode: { season: 1, episode: 4 },
    positionSeconds: 300,
    completed: true,
  });
  const inputs: unknown[] = [];

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async (input) => {
        inputs.push(input);
        return {
          externalIds: {
            ...input.externalIds,
            anilistId: "21334",
          },
          graph: {
            anilistId: "21334",
            malId: "32606",
            confidence: "high",
            source: "arm",
          },
        };
      },
    },
  });

  expect(result).toEqual({ processed: 1, queued: 1, retained: 0 });
  expect(inputs).toEqual([
    {
      id: "anidb:onigiri-3942",
      kind: "anime",
      title: "Onigiri",
      externalIds: {
        malId: "32606",
        providerNativeIds: { anidb: "onigiri-3942" },
      },
    },
  ]);
  expect(state.outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "progress:set",
    progress: 4,
    target: { tracker: "anilist", anilistId: 21334, mediaKind: "anime" },
  });
  expect(state.history.listRecent(1)[0]).toMatchObject({
    titleId: "anidb:onigiri-3942",
    mediaKind: "anime",
  });
});

test("AniDB history with a definitive missing crosswalk never guesses an AniList id", async () => {
  const state = fixture();
  state.history.upsertProgress({
    title: {
      id: "anidb:onigiri-3942",
      kind: "anime",
      title: "Onigiri",
      externalIds: {
        malId: "32606",
        providerNativeIds: { anidb: "onigiri-3942" },
      },
    },
    episode: { season: 1, episode: 4 },
    positionSeconds: 300,
    completed: true,
  });
  const diagnostics: unknown[] = [];

  const result = await reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => ({ graph: { confidence: "low", source: "arm" } }),
    },
    diagnosticsService: { record: (entry) => diagnostics.push(entry) },
  });

  expect(result).toEqual({ processed: 1, queued: 0, retained: 0 });
  expect(state.outbox.counts().pending).toBe(0);
  expect(diagnostics).toContainEqual({
    category: "sync",
    message: "Local sync reconciliation settled without a proven tracker identity",
    context: { kind: "history", reason: "no-mapping" },
  });
  expect(state.history.listRecent(1)[0]).toMatchObject({
    titleId: "anidb:onigiri-3942",
    mediaKind: "anime",
  });
});

test("a delayed list worker cannot settle a newer removal generation", async () => {
  const state = fixture();
  state.lists.addItem({
    listId: "favorites",
    titleId: "anidb:native-title",
    mediaKind: "anime",
    title: "Example",
    externalIds: { malId: "21", providerNativeIds: { anidb: "native-title-123" } },
  });
  let markEnrichmentStarted!: () => void;
  const enrichmentStarted = new Promise<void>((resolve) => {
    markEnrichmentStarted = resolve;
  });
  let finishEnrichment!: () => void;
  const enrichmentFinished = new Promise<void>((resolve) => {
    finishEnrichment = resolve;
  });
  const identity = {
    enrich: async () => {
      markEnrichmentStarted();
      await enrichmentFinished;
      return {
        externalIds: { malId: "21", anilistId: "123" },
        graph: {
          malId: "21",
          anilistId: "123",
          confidence: "high" as const,
          source: "arm" as const,
        },
      };
    },
  };

  const run = reconcileSyncMutations({
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: identity,
  });
  await enrichmentStarted;
  state.lists.removeItemByTitle("favorites", "anidb:native-title");
  finishEnrichment();
  await run;

  expect(state.reconciliation.listPending()).toHaveLength(0);
  expect(state.outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "favorite-membership:set",
    present: false,
  });
});

test("a delayed config read cannot let stale history settle a newer completion", async () => {
  const db = stores.store("cli-sync-reconciliation-history-race");
  const outbox = new SyncOutboxRepository(db);
  const history = new HistoryRepository(db);
  const reconciliation = new SyncReconciliationRepository(db);
  const title = {
    id: "local-anime",
    kind: "anime" as const,
    title: "Example",
    externalIds: { anilistId: "123" },
  };
  history.upsertProgress({
    title,
    episode: { season: 1, episode: 12 },
    positionSeconds: 120,
    completed: false,
  });
  let markConfigStarted!: () => void;
  const configStarted = new Promise<void>((resolve) => {
    markConfigStarted = resolve;
  });
  let releaseConfig!: () => void;
  const configReleased = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  let configReads = 0;
  const gate = { enabled: true, trackWatched: true, syncList: true };
  const sync = new SyncService({
    adapters: [adapter],
    outbox,
    config: {
      read: async () => {
        configReads += 1;
        if (configReads === 1) {
          markConfigStarted();
          await configReleased;
        }
        return { sync: { anilist: gate, tmdb: gate } };
      },
    },
  });

  const run = reconcileSyncMutations({
    syncReconciliationRepository: reconciliation,
    historyRepository: history,
    syncService: sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  });
  await configStarted;
  history.markWatched(title, { season: 1, episode: 12 });
  releaseConfig();
  await run;

  expect(configReads).toBe(2);
  expect(reconciliation.listPending()).toHaveLength(0);
  expect(outbox.claimDue(1)[0]?.payload).toMatchObject({
    kind: "progress:set",
    progress: 12,
    status: "completed",
  });
});

test("reconciliation drains more than 100 mixed facts in yielding bounded batches", async () => {
  const state = fixture();
  for (let index = 0; index < 52; index += 1) {
    state.history.upsertProgress({
      title: {
        id: `local-anime-${index}`,
        kind: "anime",
        title: `Anime ${index}`,
        externalIds: { anilistId: String(10_000 + index) },
      },
      episode: { season: 1, episode: 1 },
      positionSeconds: 60,
      completed: true,
    });
  }
  for (let index = 0; index < 51; index += 1) {
    state.lists.addItem({
      listId: "watchlist",
      titleId: `local-list-anime-${index}`,
      mediaKind: "anime",
      title: `List Anime ${index}`,
      externalIds: { anilistId: String(20_000 + index) },
    });
  }
  let yields = 0;

  const result = await reconcileSyncMutations(
    {
      syncReconciliationRepository: state.reconciliation,
      historyRepository: state.history,
      syncService: state.sync,
      catalogIdentityService: {
        enrich: async () => {
          throw new Error("unexpected enrichment");
        },
      },
    },
    {
      batchSize: 25,
      maxRows: 200,
      yieldToEventLoop: async () => {
        yields += 1;
      },
    },
  );

  expect(result).toEqual({ processed: 103, queued: 103, retained: 0 });
  expect(state.reconciliation.listPending()).toHaveLength(0);
  expect(yields).toBeGreaterThanOrEqual(4);
});

test("row-budget exhaustion schedules continuation until the durable queue is empty", async () => {
  const state = fixture();
  for (let index = 0; index < 3; index += 1) {
    state.lists.addItem({
      listId: "favorites",
      titleId: `local-anime-${index}`,
      mediaKind: "anime",
      title: `Anime ${index}`,
      externalIds: { anilistId: String(30_000 + index) },
    });
  }
  const scheduled: Array<() => Promise<void>> = [];
  const options = {
    maxRows: 2,
    batchSize: 1,
    scheduleContinuation: (task: () => Promise<void>) => scheduled.push(task),
  };
  const deps = {
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  };

  const first = await reconcileSyncMutations(deps, options);

  expect(first).toEqual({ processed: 2, queued: 2, retained: 0 });
  expect(state.reconciliation.listPending()).toHaveLength(1);
  expect(scheduled).toHaveLength(1);
  await scheduled.shift()!();
  expect(state.reconciliation.listPending()).toHaveLength(0);
});

test("time-budget exhaustion schedules later batches instead of blocking the current turn", async () => {
  const state = fixture();
  for (let index = 0; index < 3; index += 1) {
    state.lists.addItem({
      listId: "favorites",
      titleId: `timed-anime-${index}`,
      mediaKind: "anime",
      title: `Anime ${index}`,
      externalIds: { anilistId: String(40_000 + index) },
    });
  }
  const scheduled: Array<() => Promise<void>> = [];
  let clock = 0;
  const options = {
    maxRows: 10,
    timeBudgetMs: 10,
    now: () => {
      const current = clock;
      clock += 6;
      return current;
    },
    scheduleContinuation: (task: () => Promise<void>) => scheduled.push(task),
  };
  const deps = {
    syncReconciliationRepository: state.reconciliation,
    historyRepository: state.history,
    syncService: state.sync,
    catalogIdentityService: {
      enrich: async () => {
        throw new Error("unexpected enrichment");
      },
    },
  };

  const first = await reconcileSyncMutations(deps, options);

  expect(first.processed).toBe(1);
  expect(scheduled).toHaveLength(1);
  while (scheduled.length > 0) await scheduled.shift()!();
  expect(state.reconciliation.listPending()).toHaveLength(0);
});

test("caller abort during identity lookup retains the fact with a bounded diagnostic", async () => {
  const state = fixture();
  state.lists.addItem({
    listId: "favorites",
    titleId: "anidb:native-title",
    mediaKind: "anime",
    title: "Example",
    externalIds: { malId: "21", providerNativeIds: { anidb: "native-title-123" } },
  });
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const diagnostics: unknown[] = [];

  const run = reconcileSyncMutations(
    {
      syncReconciliationRepository: state.reconciliation,
      historyRepository: state.history,
      syncService: state.sync,
      catalogIdentityService: {
        enrich: async () => {
          markStarted();
          return await new Promise(() => {});
        },
      },
      diagnosticsService: { record: (entry) => diagnostics.push(entry) },
    },
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  const result = await run;

  expect(result).toEqual({ processed: 0, queued: 0, retained: 1 });
  expect(state.reconciliation.listPending()).toHaveLength(1);
  expect(diagnostics).toContainEqual({
    category: "sync",
    message: "Local sync reconciliation retained for retry",
    context: { kind: "list", reason: "caller-aborted" },
  });
});
