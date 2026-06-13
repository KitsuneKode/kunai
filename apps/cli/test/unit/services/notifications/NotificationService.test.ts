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
