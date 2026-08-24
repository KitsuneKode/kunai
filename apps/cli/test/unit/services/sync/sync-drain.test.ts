import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { trackerOperationDedupeKey, type TrackerOperation } from "@/services/sync/operations";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import {
  buildProgressUpdates,
  DRAIN_MAX_OPERATIONS,
  SyncAdmissionAbortedError,
  SyncService,
  type SyncConfigPort,
} from "@/services/sync/SyncService";
import {
  syncFailed,
  syncNeedsReauth,
  syncOk,
  syncRateLimited,
  type SyncOutcome,
} from "@/services/sync/types";
import { openKunaiDatabase, runMigrations, SyncOutboxRepository } from "@kunai/storage";
import type { HistoryProgress } from "@kunai/storage";

import { waitUntil } from "../../../support/wait-until";

const dirs: string[] = [];
const openDatabases: { close(): void }[] = [];

/**
 * Windows refuses to delete a file that still has an open handle, so every
 * database opened here is closed before its directory is removed. Leaving them
 * open passes on POSIX and fails the whole suite with EBUSY on Windows.
 */
afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    try {
      db.close();
    } catch {
      // Already closed by the test; removal is what matters.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function outbox() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sync-drain-"));
  dirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  openDatabases.push(db);
  runMigrations(db, "data");
  return new SyncOutboxRepository(db);
}

const enabled = { enabled: true, trackWatched: true, syncList: true };
const disabled = { enabled: false, trackWatched: false, syncList: false };

function configPort(gate: typeof enabled = enabled) {
  const state = { anilist: gate, tmdb: gate };
  const port = {
    reads: 0,
    set(next: typeof enabled) {
      state.anilist = next;
      state.tmdb = next;
    },
    read: async () => {
      port.reads += 1;
      return { sync: { anilist: state.anilist, tmdb: state.tmdb } };
    },
  };
  return port satisfies SyncConfigPort & { reads: number };
}

function adapter(
  id: "anilist" | "tmdb",
  apply: (operation: TrackerOperation) => Promise<SyncOutcome> | SyncOutcome = () => syncOk(),
) {
  const calls: TrackerOperation[] = [];
  const value: SyncAdapter = {
    id,
    displayName: id,
    capabilities: {
      episodeProgress: id === "anilist",
      watchlistMembership: true,
      favoriteMembership: true,
      pullLists: false,
      rating: false,
    },
    isConnected: () => true,
    getConnection: () => ({ state: "connected" }),
    refreshIdentity: async () => {},
    apply: async (operation: TrackerOperation) => {
      calls.push(operation);
      return apply(operation);
    },
    connect: async () => ({ ok: true }),
    disconnect: async () => {},
  } satisfies SyncAdapter;
  return { adapter: value, calls };
}

const anilistFavourite: TrackerOperation = {
  version: 1,
  kind: "favorite-membership:set",
  target: { tracker: "anilist", anilistId: 438631, mediaKind: "anime" },
  present: true,
};

function seedOperation(repo: SyncOutboxRepository, operation: TrackerOperation): void {
  repo.enqueue({
    trackerId: operation.target.tracker,
    dedupeKey: trackerOperationDedupeKey(operation),
    payload: operation,
  });
}

function historyProgress(episode: number, updatedAt: string): HistoryProgress {
  return {
    key: `anilist:438631:s1:e${episode}`,
    titleId: "anilist:438631",
    mediaKind: "anime",
    title: "Example",
    season: 1,
    episode,
    positionSeconds: 1,
    completed: true,
    updatedAt,
    createdAt: updatedAt,
  };
}

/**
 * Production drain shape, kept in proportion rather than in size.
 *
 * Production is 100 rows per pass in batches of 25 — four batches, then a
 * continuation for whatever is left. What these tests exercise is that
 * structure, not the row count, so the numbers below hold the same shape:
 * BATCH_SIZE x 4 == BUDGET, with OVER_BUDGET spilling into a continuation.
 * Shrinking the budget alone would have collapsed each pass to a single batch
 * and stopped testing the batch loop entirely.
 */
const BATCH_SIZE = 2;
const BUDGET = BATCH_SIZE * 4;
const OVER_BUDGET = BUDGET + BATCH_SIZE;

describe("SyncService drain", () => {
  test("a direct startup drain schedules continuation beyond its operation budget", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
      // The property is "the pass stops at its budget and a continuation picks
      // up the rest", which only needs the queue to out-run the budget. Proving
      // it against the production 100 meant 103 real SQLite rows per test for
      // no extra coverage.
      maxOperationsPerPass: BUDGET,
      batchSize: BATCH_SIZE,
    });

    for (let id = 1; id <= OVER_BUDGET; id += 1) {
      seedOperation(repo, {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "anilist", anilistId: id, mediaKind: "anime" },
        present: true,
      });
    }

    const first = await service.drain();
    expect(first.claimed).toBe(BUDGET);
    await waitUntil(() => repo.counts().pending === 0, { label: "outbox drained" });

    expect(anilist.calls).toHaveLength(OVER_BUDGET);
    expect(repo.counts().pending).toBe(0);
  });

  test("an uninjected service uses the production drain budget, not a test-sized one", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    // No `maxOperationsPerPass`: this is the wiring the app actually gets.
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    for (let id = 1; id <= OVER_BUDGET; id += 1) {
      seedOperation(repo, {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "anilist", anilistId: id, mediaKind: "anime" },
        present: true,
      });
    }

    // OVER_BUDGET is far below the production budget, so one pass takes them
    // all. A default wired to the injected test value, or to zero, fails here.
    const summary = await service.drain();
    expect(DRAIN_MAX_OPERATIONS).toBe(100);
    expect(summary.claimed).toBe(OVER_BUDGET);
    expect(repo.counts().pending).toBe(0);
  });

  test("deliverSoon continues after its operation budget until every due row is attempted", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
      // The property is "the pass stops at its budget and a continuation picks
      // up the rest", which only needs the queue to out-run the budget. Proving
      // it against the production 100 meant 103 real SQLite rows per test for
      // no extra coverage.
      maxOperationsPerPass: BUDGET,
      batchSize: BATCH_SIZE,
    });

    for (let id = 1; id <= OVER_BUDGET; id += 1) {
      seedOperation(repo, {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "anilist", anilistId: id, mediaKind: "anime" },
        present: true,
      });
    }

    service.deliverSoon();
    await waitUntil(() => repo.counts().pending === 0, { label: "outbox drained" });

    expect(anilist.calls).toHaveLength(OVER_BUDGET);
    expect(repo.counts().pending).toBe(0);
  });

  test("deliverSoon called during an active drain delivers work enqueued behind that drain", async () => {
    const repo = outbox();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anilist = adapter("anilist", async (operation) => {
      if (operation.target.tracker === "anilist" && operation.target.anilistId === 1) {
        await held;
      }
      return syncOk();
    });
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, {
      version: 1,
      kind: "favorite-membership:set",
      target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
      present: true,
    });
    service.deliverSoon();
    await waitUntil(() => anilist.calls.length > 0, { label: "first anilist call" });

    seedOperation(repo, {
      version: 1,
      kind: "favorite-membership:set",
      target: { tracker: "anilist", anilistId: 2, mediaKind: "anime" },
      present: true,
    });
    service.deliverSoon();
    release();

    await waitUntil(() => repo.counts().pending === 0, { label: "outbox drained" });
    expect(anilist.calls).toHaveLength(2);
    expect(repo.counts().pending).toBe(0);
  });

  test("continues past a disabled first batch to deliver an eligible tracker", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const tmdb = adapter("tmdb");
    const service = new SyncService({
      adapters: [anilist.adapter, tmdb.adapter],
      outbox: repo,
      config: {
        read: async () => ({
          sync: {
            anilist: { enabled: false, trackWatched: false, syncList: false },
            tmdb: enabled,
          },
        }),
      },
    });

    for (let id = 1; id <= 26; id += 1) {
      seedOperation(repo, {
        version: 1,
        kind: "favorite-membership:set",
        target: { tracker: "anilist", anilistId: id, mediaKind: "anime" },
        present: true,
      });
    }
    seedOperation(repo, {
      version: 1,
      kind: "favorite-membership:set",
      target: { tracker: "tmdb", tmdbId: 550, mediaKind: "movie" },
      present: true,
    });

    await service.drain();

    expect(tmdb.calls).toMatchObject([
      { kind: "favorite-membership:set", target: { tracker: "tmdb", tmdbId: 550 } },
    ]);
    expect(repo.counts().pending).toBe(26);
  });

  test("does not persist automatic progress before watch tracking is opted in", async () => {
    const repo = outbox();
    const service = new SyncService({
      adapters: [adapter("anilist").adapter],
      outbox: repo,
      config: configPort({ ...enabled, trackWatched: false }),
    });

    await expect(
      service.enqueueProgressIfEnabled(historyProgress(3, "2026-08-16T12:00:00.000Z")),
    ).resolves.toBe(0);
    expect(repo.counts().pending).toBe(0);
  });

  test("does not persist favourite intent before list sync is opted in", async () => {
    const repo = outbox();
    const service = new SyncService({
      adapters: [adapter("anilist").adapter],
      outbox: repo,
      config: configPort({ ...enabled, syncList: false }),
    });

    await expect(
      service.enqueueFavoriteMembershipIfEnabled({
        identities: [{ tracker: "anilist", anilistId: 438631, mediaKind: "anime" }],
        present: true,
      }),
    ).resolves.toBe(0);
    expect(repo.counts().pending).toBe(0);
  });

  test("syncNow sends the highest proven episode regardless of history order", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    await service.syncNow([
      historyProgress(12, "2026-08-16T12:00:00.000Z"),
      historyProgress(11, "2026-08-16T11:00:00.000Z"),
    ]);

    expect(anilist.calls).toMatchObject([
      { kind: "progress:set", progress: 12, target: { anilistId: 438631 } },
    ]);
  });

  test("manual progress builder covers both orders, duplicates, movies, and mixed titles", () => {
    const episode12 = historyProgress(12, "2026-08-16T12:00:00.000Z");
    const episode11 = historyProgress(11, "2026-08-16T11:00:00.000Z");
    const duplicateWatching = { ...episode12, completed: false };
    const otherTitle = {
      ...historyProgress(4, "2026-08-16T10:00:00.000Z"),
      key: "anilist:999:s1:e4",
      titleId: "anilist:999",
      title: "Other",
    };
    const movie: HistoryProgress = {
      key: "movie:550:none:none:none",
      titleId: "tmdb:550",
      mediaKind: "movie",
      title: "Movie",
      positionSeconds: 100,
      completed: true,
      updatedAt: "2026-08-16T09:00:00.000Z",
      createdAt: "2026-08-16T09:00:00.000Z",
    };

    for (const entries of [
      [episode12, episode11, duplicateWatching, movie, otherTitle],
      [otherTitle, movie, duplicateWatching, episode11, episode12],
    ]) {
      expect(
        buildProgressUpdates(entries)
          .map((entry) => ({
            titleId: entry.titleId,
            episode: entry.episode,
            completed: entry.completed,
          }))
          .sort((left, right) => left.titleId.localeCompare(right.titleId)),
      ).toEqual([
        { titleId: "anilist:438631", episode: 12, completed: true },
        { titleId: "anilist:999", episode: 4, completed: true },
      ]);
    }
  });
  /**
   * Config is read immediately before each external mutation, not captured at
   * construction or checked only at enqueue. A user who turns a tracker off
   * expects the very next write to stop — including work already queued.
   */
  test("a tracker disabled after enqueue performs no remote mutation", async () => {
    const repo = outbox();
    const config = configPort();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config,
    });

    seedOperation(repo, anilistFavourite);
    config.set(disabled);

    const summary = await service.drain();

    expect(anilist.calls).toHaveLength(0);
    expect(repo.counts().pending).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.released).toBe(1);
  });

  /** A disabled tracker parks work; it must not burn the retry budget. */
  test("a disabled tracker leaves attempts unchanged", async () => {
    const repo = outbox();
    const config = configPort(disabled);
    const service = new SyncService({
      adapters: [adapter("anilist").adapter],
      outbox: repo,
      config,
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();
    const [claimed] = repo.claimDue(1, new Date(Date.now() + 60 * 60 * 1000));

    expect(claimed?.attempts).toBe(1);
  });

  test("automatically wakes when a retry becomes due and cancels the wake on shutdown", async () => {
    const repo = outbox();
    const scheduled: Array<{ task: () => void; delayMs: number; cancelled: boolean }> = [];
    // Set from the real clock *after* seeding, below.
    //
    // `seedOperation` stamps `next_attempt_at` from `Date.now()`, so this
    // clock has to relate to that one. A fixed literal stops being due the day
    // after it is written; reading the real clock before seeding is due only
    // while both land in the same millisecond, which held locally and failed
    // on a slower CI runner. Advancing past the seed is the only form that
    // does not depend on either the date or the machine.
    let now = new Date();
    let calls = 0;
    const anilist = adapter("anilist", () => {
      calls += 1;
      return calls === 1 ? syncFailed("temporary", "network") : syncOk();
    });
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
      now: () => now,
      scheduleWake: (task, delayMs) => {
        const wake = { task, delayMs, cancelled: false };
        scheduled.push(wake);
        return () => {
          wake.cancelled = true;
        };
      },
    });

    seedOperation(repo, anilistFavourite);
    now = new Date(Date.now() + 1000);
    await service.drain();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBeGreaterThan(0);
    now = new Date(now.getTime() + 60_000);
    scheduled[0]?.task();
    await waitUntil(() => repo.counts().pending === 0, { label: "outbox drained" });
    expect(anilist.calls).toHaveLength(2);
    expect(repo.counts().pending).toBe(0);

    seedOperation(repo, anilistFavourite);
    calls = 0;
    await service.drain();
    const lastWake = scheduled.at(-1)!;
    await service.shutdown();
    expect(lastWake.cancelled).toBe(true);
  });

  test("delivers a claimed row and removes it on success", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    const summary = await service.drain();

    expect(anilist.calls).toEqual([anilistFavourite]);
    expect(summary.succeeded).toBe(1);
    expect(repo.counts().pending).toBe(0);
  });

  /**
   * A payload that cannot be parsed can never be delivered, so it is
   * dead-lettered without an adapter call rather than retried forever.
   */
  test("dead-letters a corrupt payload without calling the adapter", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    repo.enqueue({ trackerId: "anilist", dedupeKey: "corrupt|x", payload: { version: 99 } });
    const summary = await service.drain();

    expect(anilist.calls).toHaveLength(0);
    expect(summary.deadLettered).toBe(1);
    expect(repo.counts().deadLetter).toBe(1);
  });

  test("maps each outcome onto its outbox transition", async () => {
    const cases = [
      { outcome: syncFailed("boom", "network"), field: "retrying" as const },
      { outcome: syncFailed("nope", "mapping"), field: "deadLettered" as const },
      { outcome: syncNeedsReauth("token-rejected"), field: "needsReauth" as const },
    ];

    for (const { outcome, field } of cases) {
      const repo = outbox();
      const service = new SyncService({
        adapters: [adapter("anilist", () => outcome).adapter],
        outbox: repo,
        config: configPort(),
      });
      seedOperation(repo, anilistFavourite);

      const summary = await service.drain();

      expect(summary[field], `${outcome.status}/${field}`).toBe(1);
      expect(summary.failed).toBe(1);
    }
  });

  /**
   * An adapter that throws rather than returning an outcome must not take the
   * drain down with it — one broken tracker would otherwise strand every
   * queued row, including other trackers'.
   */
  test("records an adapter that throws as a retryable failure", async () => {
    const repo = outbox();
    const service = new SyncService({
      adapters: [
        adapter("anilist", () => {
          throw new Error("network unavailable");
        }).adapter,
      ],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    const summary = await service.drain();

    expect(summary.retrying).toBe(1);
    expect(summary.failures[0]).toContain("adapter-threw");
    expect(repo.counts().pending).toBe(1);
  });

  /**
   * One awaited syncNow owns one drain. A second caller must not be told its
   * rows were delivered — they were enqueued after the batch was claimed, so
   * they are still pending and a later drain owns them.
   */
  test("a concurrent syncNow reports already-running and leaves its rows pending", async () => {
    const repo = outbox();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anilist = adapter("anilist", async () => {
      await held;
      return syncOk();
    });
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    const first = service.drain();
    await Promise.resolve();

    const second = await service.syncNow([]);
    expect(second.status).toBe("already-running");

    release();
    const summary = await first;
    expect(summary.succeeded).toBe(1);
    expect(anilist.calls).toHaveLength(1);
  });

  /** Reconnecting must unpark exactly the rows that were waiting on it. */
  test("resumeAfterReauth resets only the named tracker", async () => {
    const repo = outbox();
    const service = new SyncService({
      adapters: [adapter("anilist", () => syncNeedsReauth("token-rejected")).adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();
    expect(repo.counts().needsReauth).toBe(1);

    expect(service.resumeAfterReauth("tmdb")).toBe(0);
    expect(service.resumeAfterReauth("anilist")).toBe(1);
    expect(repo.counts().pending).toBe(1);
  });

  /** Shutdown is retryable lifetime cancellation, not a disabled user choice. */
  test("reports admission and gated enqueue as aborted after shutdown", async () => {
    const repo = outbox();
    const service = new SyncService({
      adapters: [adapter("anilist").adapter],
      outbox: repo,
      config: configPort(),
    });

    await service.shutdown();

    await expect(
      service.checkAutomaticAdmission({ tracker: "anilist", capability: "favorite" }),
    ).resolves.toBe("aborted");
    await expect(
      service.enqueueFavoriteMembershipIfEnabled({
        identities: [anilistFavourite.target],
        present: true,
      }),
    ).rejects.toBeInstanceOf(SyncAdmissionAbortedError);
    expect(repo.counts().pending).toBe(0);
  });

  /**
   * Capability mismatch is decided from the adapter's own declaration, before
   * any request — the declaration is the authority, not per-tracker branching
   * scattered through the drain.
   */
  test("dead-letters an operation the adapter does not support", async () => {
    const repo = outbox();
    const tmdb = adapter("tmdb");
    const service = new SyncService({
      adapters: [tmdb.adapter],
      outbox: repo,
      config: configPort(),
    });

    repo.enqueue({
      trackerId: "tmdb",
      dedupeKey: "tmdb:movie:550|progress:set",
      payload: {
        version: 1,
        kind: "progress:set",
        target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
        progress: 2,
        status: "watching",
      },
    });

    const summary = await service.drain();

    expect(tmdb.calls).toHaveLength(0);
    expect(summary.deadLettered).toBe(1);
  });
});

/**
 * A rate limit is a property of the connection, not of any one payload. The
 * drain used to decide per row, so a limited tracker was asked once per claimed
 * row — the exact hammering the limit exists to prevent.
 */
describe("SyncService rate limiting", () => {
  test("stops asking a rate-limited tracker for the rest of the drain", async () => {
    const repo = outbox();
    const anilist = adapter("anilist", () => syncRateLimited(30_000));
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    for (let episode = 1; episode <= 5; episode += 1) {
      seedOperation(repo, {
        version: 1,
        kind: "progress:set",
        target: { tracker: "anilist", anilistId: 100 + episode, mediaKind: "anime" },
        progress: episode,
        status: "watching",
      });
    }

    const summary = await service.drain();

    // One ask, four deferred without asking.
    expect(anilist.calls.length).toBe(1);
    expect(summary.deferred).toBe(5);
    // Deferral is not failure: nothing is retrying, dead-lettered, or reported.
    expect(summary.failed).toBe(0);
    expect(summary.failures).toEqual([]);
    // Everything is still queued, none of it lost.
    expect(summary.pending).toBe(5);
  });

  /** A deferred row must not inherit a longer backoff it did not earn. */
  test("does not spend an attempt on a deferral", async () => {
    const repo = outbox();
    const anilist = adapter("anilist", () => syncRateLimited(30_000));
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();

    const [row] = repo.claimDue(10, new Date(Date.now() + 60_000));
    expect(row?.attempts).toBe(1);
  });

  /** The server's own number decides when, not our exponential backoff. */
  test("honours the tracker's wait rather than the local backoff schedule", async () => {
    const repo = outbox();
    const anilist = adapter("anilist", () => syncRateLimited(10 * 60_000));
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: configPort(),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();

    // Well past the 30s first-retry backoff, still parked.
    expect(repo.claimDue(10, new Date(Date.now() + 60_000)).length).toBe(0);
    expect(repo.claimDue(10, new Date(Date.now() + 11 * 60_000)).length).toBe(1);
  });
});

/**
 * Pausing is "not right now", not "never". The distinction only earns its keep
 * if pausing never loses work — so enqueue keeps accepting while the drain
 * holds, and resuming delivers everything that piled up.
 */
describe("SyncService pause", () => {
  const pausedConfig = (pausedUntil: string | null) => ({
    read: async () => ({
      sync: { pausedUntil, anilist: enabled, tmdb: enabled },
    }),
  });

  test("delivers nothing while paused, and loses nothing either", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: pausedConfig(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    });

    await expect(
      service.enqueueFavoriteMembershipIfEnabled({
        identities: [anilistFavourite.target],
        present: true,
      }),
    ).resolves.toBe(1);
    const summary = await service.drain();

    expect(anilist.calls.length).toBe(0);
    expect(summary.pending).toBe(1);
    expect(summary.claimed).toBe(0);
    // No claim was taken, so nothing was left leased behind a pause.
    expect(repo.claimDue(10).length).toBe(1);
  });

  test("delivers normally once the pause has elapsed", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: pausedConfig(new Date(Date.now() - 1_000).toISOString()),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();

    expect(anilist.calls.length).toBe(1);
  });

  /** A corrupt timestamp must not stop sync forever with nothing to show why. */
  test("treats an unparseable pause as not paused", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: pausedConfig("whenever"),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();

    expect(anilist.calls.length).toBe(1);
  });
});

/**
 * `trackWatched` and `syncList` were declared on the config port and read by
 * nothing: settings could toggle them and delivery carried on regardless.
 */
describe("SyncService per-kind config gates", () => {
  const gated = (overrides: Partial<typeof enabled>) => ({
    read: async () => {
      const gate = { ...enabled, ...overrides };
      return { sync: { pausedUntil: null, anilist: gate, tmdb: gate } };
    },
  });

  test("holds progress when the tracker is not tracking watched episodes", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: gated({ trackWatched: false }),
    });

    seedOperation(repo, {
      version: 1,
      kind: "progress:set",
      target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
      progress: 3,
      status: "watching",
    });
    await service.drain();

    expect(anilist.calls.length).toBe(0);
    // Held, not dropped: re-enabling must deliver it rather than lose it.
    expect(repo.counts().pending).toBe(1);
  });

  test("holds list and favourite writes when list sync is off", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: gated({ syncList: false }),
    });

    seedOperation(repo, anilistFavourite);
    await service.drain();

    expect(anilist.calls.length).toBe(0);
    expect(repo.counts().pending).toBe(1);
  });

  /** The gates are per kind, so one being off must not hold the other back. */
  test("still delivers progress when only list sync is off", async () => {
    const repo = outbox();
    const anilist = adapter("anilist");
    const service = new SyncService({
      adapters: [anilist.adapter],
      outbox: repo,
      config: gated({ syncList: false }),
    });

    seedOperation(repo, {
      version: 1,
      kind: "progress:set",
      target: { tracker: "anilist", anilistId: 1, mediaKind: "anime" },
      progress: 3,
      status: "watching",
    });
    await service.drain();

    expect(anilist.calls.length).toBe(1);
  });
});
