import { beforeEach, expect, test } from "bun:test";

import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import { SyncService, type SyncConfigPort } from "@/services/sync/SyncService";
import { syncFailed, syncOk, syncSkipped, type SyncOutcome } from "@/services/sync/types";
import {
  openKunaiDatabase,
  runMigrations,
  SyncQueueRepository,
  type HistoryProgress,
} from "@kunai/storage";

const ON = { enabled: true, trackWatched: true, syncList: true };
const OFF = { enabled: false, trackWatched: false, syncList: false };

function config(overrides: Partial<Record<"anilist" | "tmdb", typeof ON>> = {}): SyncConfigPort {
  return { sync: { anilist: ON, tmdb: ON, ...overrides } };
}

function historyEntry(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "anilist:21",
    mediaKind: "anime",
    title: "One Piece",
    season: 1,
    episode: 5,
    positionSeconds: 1400,
    completed: true,
    externalIds: { anilistId: "21" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as HistoryProgress;
}

interface StubAdapter extends SyncAdapter {
  readonly pushed: unknown[];
}

function adapter(
  id: "anilist" | "tmdb",
  overrides: {
    readonly connected?: boolean;
    readonly episodeProgress?: boolean;
    readonly outcome?: SyncOutcome | (() => SyncOutcome);
    readonly throws?: boolean;
  } = {},
): StubAdapter {
  const pushed: unknown[] = [];
  return {
    id,
    displayName: id === "anilist" ? "AniList" : "TMDB",
    capabilities: {
      episodeProgress: overrides.episodeProgress ?? true,
      lists: true,
      pull: true,
      rating: false,
    },
    pushed,
    init: async () => {},
    refreshIdentity: async () => {},
    getConnection: () =>
      overrides.connected === false ? { state: "disconnected" } : { state: "connected" },
    isConnected: () => overrides.connected !== false,
    getConnectedUsername: () => undefined,
    connect: async () => syncOk(),
    disconnect: async () => {},
    pushProgress: async (progress) => {
      if (overrides.throws) throw new Error("network unreachable");
      pushed.push(progress);
      const outcome = overrides.outcome ?? syncOk();
      return typeof outcome === "function" ? outcome() : outcome;
    },
    pushListItem: async (item) => {
      pushed.push(item);
      return syncOk();
    },
  } as StubAdapter;
}

let queue: SyncQueueRepository;

beforeEach(() => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  queue = new SyncQueueRepository(db);
});

test("a finished episode is queued and delivered to every enabled tracker", async () => {
  const anilist = adapter("anilist");
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(anilist.pushed).toHaveLength(1);
  expect(anilist.pushed[0]).toMatchObject({ titleId: "anilist:21", episode: 5, completed: true });
  expect(queue.pendingCount()).toBe(0);
});

// These toggles existed in config but nothing read them, so a user who turned
// sync off still had their progress pushed.
test("a disabled tracker is never asked to push", async () => {
  const anilist = adapter("anilist");
  const service = new SyncService({
    adapters: [anilist],
    queue,
    config: config({ anilist: OFF }),
  });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(anilist.pushed).toHaveLength(0);
  expect(queue.pendingCount()).toBe(0);
});

test("trackWatched off keeps the tracker connected but stops scrobbling", async () => {
  const anilist = adapter("anilist");
  const service = new SyncService({
    adapters: [anilist],
    queue,
    config: config({ anilist: { enabled: true, trackWatched: false, syncList: true } }),
  });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(anilist.pushed).toHaveLength(0);
});

test("trackers without episode progress are not queued for scrobbles", async () => {
  const tmdb = adapter("tmdb", { episodeProgress: false });
  const service = new SyncService({ adapters: [tmdb], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(tmdb.pushed).toHaveLength(0);
});

test("a failed push stays queued for a later retry", async () => {
  const anilist = adapter("anilist", { outcome: syncFailed("tracker is down", "remote") });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(queue.pendingCount()).toBe(1);
  expect(queue.listAll()[0]?.attempts).toBe(1);
});

test("a queued push is retried on a later drain and then cleared", async () => {
  let attempt = 0;
  const anilist = adapter("anilist", {
    outcome: () => (attempt++ === 0 ? syncFailed("temporary", "network") : syncOk()),
  });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();
  expect(queue.pendingCount()).toBe(1);

  // A manual sync clears the backoff, which is what "Sync now" does.
  const summary = await service.syncNow([]);

  expect(summary.succeeded).toBe(1);
  expect(queue.pendingCount()).toBe(0);
});

test("an adapter throw is caught and retried rather than escaping", async () => {
  const anilist = adapter("anilist", { throws: true });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(queue.pendingCount()).toBe(1);
});

// Structural limits are not failures: retrying them forever would keep the
// health indicator amber for something that can never succeed.
test("a skipped push is dropped from the queue", async () => {
  const anilist = adapter("anilist", { outcome: syncSkipped("already up to date") });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(queue.pendingCount()).toBe(0);
});

test("re-watching the same episode does not stack duplicate queue rows", async () => {
  const anilist = adapter("anilist", { outcome: syncFailed("down", "remote") });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();
  service.trackerPush(historyEntry());
  await service.whenIdle();

  expect(queue.listAll()).toHaveLength(1);
});

test("different episodes queue independently", async () => {
  const anilist = adapter("anilist", { outcome: syncFailed("down", "remote") });
  const service = new SyncService({ adapters: [anilist], queue, config: config() });

  service.trackerPush(historyEntry({ episode: 5 }));
  await service.whenIdle();
  service.trackerPush(historyEntry({ episode: 6 }));
  await service.whenIdle();

  expect(queue.listAll()).toHaveLength(2);
});

test("work queued for an adapter that was since disconnected is dropped", async () => {
  const anilist = adapter("anilist");
  const service = new SyncService({ adapters: [anilist], queue, config: config() });
  service.trackerPush(historyEntry());

  const offline = new SyncService({
    adapters: [adapter("anilist", { connected: false })],
    queue,
    config: config(),
  });
  await offline.drain();

  expect(queue.pendingCount()).toBe(0);
});

test("health reports disconnected, warn, and ok from real queue state", async () => {
  const failing = adapter("anilist", { outcome: syncFailed("down", "remote") });

  expect(
    new SyncService({
      adapters: [adapter("anilist", { connected: false })],
      queue,
      config: config(),
    }).getHealth(),
  ).toBe("disconnected");

  const service = new SyncService({ adapters: [failing], queue, config: config() });
  expect(service.getHealth()).toBe("ok");

  service.trackerPush(historyEntry());
  await service.whenIdle();
  expect(service.getHealth()).toBe("warn");
});

test("health reports error when a tracker needs reauth", () => {
  const stale = {
    ...adapter("anilist"),
    isConnected: () => false,
    getConnection: () => ({ state: "needs-reauth" as const, reason: "token expired" }),
  } as SyncAdapter;

  expect(new SyncService({ adapters: [stale], queue, config: config() }).getHealth()).toBe("error");
});

test("forgetAdapterQueue clears only that tracker's pending work", async () => {
  const anilist = adapter("anilist", { outcome: syncFailed("down", "remote") });
  const tmdb = adapter("tmdb", { outcome: syncFailed("down", "remote") });
  const service = new SyncService({ adapters: [anilist, tmdb], queue, config: config() });

  service.trackerPush(historyEntry());
  await service.whenIdle();
  expect(queue.pendingCount()).toBe(2);

  service.forgetAdapterQueue("anilist");

  expect(queue.listAll().map((row) => row.adapterId)).toEqual(["tmdb"]);
});

test("pull only reads from connected trackers with list sync enabled", async () => {
  let pulled = 0;
  const anilist = {
    ...adapter("anilist"),
    pullList: async () => {
      pulled += 1;
      return [];
    },
  } as SyncAdapter;

  await new SyncService({
    adapters: [anilist],
    queue,
    config: config({ anilist: { enabled: true, trackWatched: true, syncList: false } }),
  }).pull();
  expect(pulled).toBe(0);

  await new SyncService({ adapters: [anilist], queue, config: config() }).pull();
  expect(pulled).toBe(1);
});
