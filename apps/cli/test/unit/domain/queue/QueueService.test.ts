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

test("prepareForShutdown marks a session with pending items recoverable", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "current",
    status: "active",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
  repo.enqueue({
    title: "Example",
    mediaKind: "series",
    titleId: "tmdb:1",
    season: 1,
    episode: 2,
    source: "browse",
    sessionId: "current",
  });
  const service = new QueueService(repo, "current");

  expect(service.prepareForShutdown("2026-07-18T00:00:00.000Z")).toBe("recoverable");
  expect(repo.getQueueSession("current")?.status).toBe("recoverable");

  db.close();
});

test("prepareForShutdown closes an empty session", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "current",
    status: "active",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
  const service = new QueueService(repo, "current");

  expect(service.prepareForShutdown("2026-07-18T00:05:00.000Z")).toBe("closed");
  const session = repo.getQueueSession("current");
  expect(session?.status).toBe("closed");
  expect(session?.closedAt).toBe("2026-07-18T00:05:00.000Z");

  db.close();
});

test("moveUpInQueue / moveDownInQueue reorder the full persisted queue list", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  const enqueue = (titleId: string) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "series",
      titleId,
      source: "manual",
      sessionId: "s",
    });
  const done = enqueue("done");
  const _a = enqueue("a");
  const b = enqueue("b");
  repo.markPlayed(done.id);

  const service = new QueueService(repo, "s");
  expect(service.moveUpInQueue(b.id)).toBe(true);
  expect(service.getAll().map((item) => item.titleId)).toEqual(["done", "b", "a"]);
  expect(service.moveDownInQueue(done.id)).toBe(true);
  expect(service.getAll().map((item) => item.titleId)).toEqual(["b", "done", "a"]);

  db.close();
});

test("moveUp / moveDown reorder unplayed queue items and clamp at the ends", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  const enqueue = (titleId: string) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "series",
      titleId,
      source: "manual",
      sessionId: "s",
    });
  const a = enqueue("a");
  enqueue("b");
  const c = enqueue("c");

  const service = new QueueService(repo, "s");
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["a", "b", "c"]);

  // Move c up one → a, c, b.
  expect(service.moveDown(a.id)).toBe(true);
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["b", "a", "c"]);

  // Clamp: first item can't move up, last can't move down.
  expect(service.moveUp(service.getUnplayed()[0]!.id)).toBe(false);
  expect(service.moveDown(c.id)).toBe(false);

  db.close();
});

test("moveToTop / moveToBottom jump unplayed items to the ends and clamp", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  const enqueue = (titleId: string) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "series",
      titleId,
      source: "manual",
      sessionId: "s",
    });
  const a = enqueue("a");
  enqueue("b");
  const c = enqueue("c");

  const service = new QueueService(repo, "s");
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["a", "b", "c"]);

  // c → top ("play next").
  expect(service.moveToTop(c.id)).toBe(true);
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["c", "a", "b"]);

  // a → bottom.
  expect(service.moveToBottom(a.id)).toBe(true);
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["c", "b", "a"]);

  // No-op when already at the requested end.
  expect(service.moveToTop(service.getUnplayed()[0]!.id)).toBe(false);
  expect(service.moveToBottom(service.getUnplayed()[2]!.id)).toBe(false);

  db.close();
});

test("moveToTop keeps played items ahead of the unplayed tail", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  const enqueue = (titleId: string) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "series",
      titleId,
      source: "manual",
      sessionId: "s",
    });
  const done = enqueue("done");
  enqueue("x");
  const y = enqueue("y");
  repo.markPlayed(done.id);

  const service = new QueueService(repo, "s");
  expect(service.moveToTop(y.id)).toBe(true);
  // Played item stays first overall; y is now first among unplayed.
  expect(service.getAll().map((i) => i.titleId)).toEqual(["done", "y", "x"]);
  expect(service.getUnplayed().map((i) => i.titleId)).toEqual(["y", "x"]);

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
