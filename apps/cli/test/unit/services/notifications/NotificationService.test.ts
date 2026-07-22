import { expect, test } from "bun:test";

import { NotificationService } from "@/services/notifications/NotificationService";
import {
  NotificationRepository,
  openKunaiDatabase,
  runMigrations,
  type NotificationRecord,
} from "@kunai/storage";

test("NotificationService stores derived notices and lists active inbox rows", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new NotificationService({
    repo: new NotificationRepository(db),
    getMutedTitleIds: () => new Set(),
  });

  service.recordSignals(
    [
      {
        type: "queue-recoverable",
        queueSessionId: "queue-session-1",
        itemCount: 2,
        updatedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    "2026-05-17T00:01:00.000Z",
  );

  expect(service.listActive()[0]).toMatchObject({
    dedupKey: "queue-recoverable:queue-session-1",
    kind: "queue-recovery",
    title: "Previous queue available",
  });
  expect(JSON.parse(service.listActive()[0]?.itemJson ?? "{}")).toEqual({
    queueSessionId: "queue-session-1",
  });
  expect(JSON.parse(service.listActive()[0]?.actionJson ?? "[]")).toEqual([
    "restore-queue",
    "dismiss",
  ]);

  db.close();
});

test("NotificationService only stores notification actions the root overlay can execute", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new NotificationService({
    repo: new NotificationRepository(db),
    getMutedTitleIds: () => new Set(),
  });

  service.recordSignals(
    [
      {
        type: "new-playable-episode",
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 6,
        providerId: "vidking",
        availableAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    "2026-05-17T00:01:00.000Z",
  );

  // A new-episode notice must be able to play the episode it announces — the
  // payload used to offer only queueing, so the inbox could never start playback.
  expect(JSON.parse(service.listActive()[0]?.actionJson ?? "[]")).toEqual([
    "play-now",
    "open-details",
    "add-to-up-next",
    "queue-end",
    "mute",
    "dismiss",
  ]);

  db.close();
});

test("delete is sticky: a re-emitted signal does not resurrect a deleted notification", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new NotificationService({
    repo: new NotificationRepository(db),
    getMutedTitleIds: () => new Set(),
  });

  const signal = {
    type: "queue-recoverable" as const,
    queueSessionId: "q1",
    itemCount: 1,
    updatedAt: "2026-06-16T00:00:00.000Z",
  };
  service.recordSignals([signal], "2026-06-16T00:00:00.000Z");
  const row = service.listActive()[0];
  expect(row?.dedupKey).toBe("queue-recoverable:q1");

  service.delete(row!.dedupKey, "2026-06-16T00:01:00.000Z");
  expect(service.listActive()).toHaveLength(0);

  // The same signal fires again next cycle — it must stay gone.
  service.recordSignals([signal], "2026-06-16T00:02:00.000Z");
  expect(service.listActive()).toHaveLength(0);

  // A genuinely new session (different dedupKey) still appears.
  service.recordSignals([{ ...signal, queueSessionId: "q2" }], "2026-06-16T00:03:00.000Z");
  expect(service.listActive().map((n) => n.dedupKey)).toEqual(["queue-recoverable:q2"]);

  db.close();
});

test("NotificationService exposes a revision for render-safe snapshots", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new NotificationService({
    repo: new NotificationRepository(db),
    getMutedTitleIds: () => new Set(),
  });
  const revisions: number[] = [];
  const unsubscribe = service.subscribe(() => revisions.push(service.getRevision()));

  expect(service.getRevision()).toBe(0);
  service.recordSignals(
    [
      {
        type: "queue-recoverable",
        queueSessionId: "q1",
        itemCount: 1,
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    ],
    "2026-07-16T00:00:00.000Z",
  );
  service.markAllRead("2026-07-16T00:01:00.000Z");

  expect(revisions).toEqual([1, 2]);
  expect(service.getRevision()).toBe(2);

  unsubscribe();
  service.clearArchived();
  expect(revisions).toEqual([1, 2]);
  expect(service.getRevision()).toBe(3);
  db.close();
});

test("NotificationService passes complete inbox lists through and keeps limited paging", () => {
  const record = (dedupKey: string): NotificationRecord => ({
    id: dedupKey,
    dedupKey,
    kind: "new-episode",
    title: `T ${dedupKey}`,
    body: "b",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  });

  const listActiveCalls: Array<readonly [number, number]> = [];
  const repoDouble = {
    listActive: (limit: number, offset: number) => {
      listActiveCalls.push([limit, offset] as const);
      return [record("active-3"), record("active-2")].slice(0, limit);
    },
    listAllActive: () => [record("active-3"), record("active-2"), record("active-1")],
    listAllArchived: () => [record("archived-2"), record("archived-1")],
  } as unknown as NotificationRepository;

  const service = new NotificationService({
    repo: repoDouble,
    getMutedTitleIds: () => new Set(),
  });

  expect(service.listAllActive().map((row) => row.dedupKey)).toEqual([
    "active-3",
    "active-2",
    "active-1",
  ]);
  expect(service.listAllArchived().map((row) => row.dedupKey)).toEqual([
    "archived-2",
    "archived-1",
  ]);

  expect(service.listActive(2)).toHaveLength(2);
  expect(listActiveCalls).toEqual([[2, 0]]);
});

test("NotificationService lifecycle: records, counts unread, archives", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new NotificationService({
    repo: new NotificationRepository(db),
    getMutedTitleIds: () => new Set(),
  });

  service.recordSignals(
    [
      {
        type: "queue-recoverable",
        queueSessionId: "q1",
        itemCount: 3,
        updatedAt: "2026-06-14T01:00:00.000Z",
      },
    ],
    "2026-06-14T01:00:00.000Z",
  );
  expect(service.countUnread()).toBe(1);
  service.markAllRead("2026-06-14T02:00:00.000Z");
  expect(service.countUnread()).toBe(0);

  const first = service.listActive(50, 0)[0];
  service.archive(first!.dedupKey, "2026-06-14T03:00:00.000Z");
  expect(service.listActive(50, 0)).toHaveLength(0);
  expect(service.listArchived(50, 0)).toHaveLength(1);

  db.close();
});
