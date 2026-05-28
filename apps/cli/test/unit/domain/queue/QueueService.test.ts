import { expect, test } from "bun:test";

import { QueueService } from "@/domain/queue/QueueService";
import { openKunaiDatabase, QueueRepository, runMigrations } from "@kunai/storage";

test("QueueService restores a recoverable queue into the current session explicitly", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);

  repo.createQueueSession({
    id: "old-session",
    status: "recoverable",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:10:00.000Z",
  });
  repo.createQueueSession({
    id: "current-session",
    status: "active",
    createdAt: "2026-05-17T00:20:00.000Z",
    updatedAt: "2026-05-17T00:20:00.000Z",
  });
  repo.enqueue({
    title: "Example",
    mediaKind: "series",
    titleId: "tmdb:1",
    season: 1,
    episode: 2,
    source: "notification",
    sessionId: "old-session",
  });

  const service = new QueueService(repo, "current-session");

  expect(service.listRecoverableSessions()[0]?.id).toBe("old-session");
  expect(service.restoreRecoverableSession("old-session")).toBe(1);
  expect(service.getUnplayed()[0]?.titleId).toBe("tmdb:1");
  expect(repo.getQueueSession("old-session")?.status).toBe("closed");
  expect(service.peekNext()?.playedAt).toBeUndefined();

  db.close();
});

test("QueueService restore only moves pending items and never autoplays them", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "old-session",
    status: "recoverable",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:10:00.000Z",
  });
  repo.createQueueSession({
    id: "current-session",
    status: "active",
    createdAt: "2026-05-17T00:20:00.000Z",
    updatedAt: "2026-05-17T00:20:00.000Z",
  });
  const played = repo.enqueue({
    title: "Already Played",
    mediaKind: "series",
    titleId: "tmdb:played",
    season: 1,
    episode: 1,
    source: "queue-recovery",
    sessionId: "old-session",
  });
  repo.markPlayed(played.id);
  repo.enqueue({
    title: "Pending",
    mediaKind: "series",
    titleId: "tmdb:pending",
    season: 1,
    episode: 2,
    source: "queue-recovery",
    sessionId: "old-session",
  });

  const service = new QueueService(repo, "current-session");

  expect(service.restoreRecoverableSession("old-session")).toBe(1);
  expect(service.getAll().map((item) => item.titleId)).toEqual(["tmdb:pending"]);
  expect(service.peekNext()?.status).toBe("pending");

  db.close();
});
