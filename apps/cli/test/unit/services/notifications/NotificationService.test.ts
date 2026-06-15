import { expect, test } from "bun:test";

import { NotificationService } from "@/services/notifications/NotificationService";
import { NotificationRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

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

  expect(JSON.parse(service.listActive()[0]?.actionJson ?? "[]")).toEqual([
    "queue-next",
    "queue-end",
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
