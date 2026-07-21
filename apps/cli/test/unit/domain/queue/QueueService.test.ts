import { expect, test } from "bun:test";

import { QueueService } from "@/domain/queue/QueueService";
import { openKunaiDatabase, QueueRepository, runMigrations } from "@kunai/storage";

test("beginPlayback claims requested row, not head", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  const enqueue = (titleId: string) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "anime",
      titleId,
      absoluteEpisode: titleId === "selected" ? 13 : 1,
      source: "manual",
      sessionId: "s",
    });
  const first = enqueue("first");
  const selected = enqueue("selected");
  const service = new QueueService(repo, "s");

  expect(service.beginPlayback(selected.id, "queue")?.queueEntryId).toBe(selected.id);
  expect(repo.getById(first.id)?.status).toBe("pending");
  expect(repo.getById(selected.id)?.status).toBe("in-flight");

  db.close();
});

test("acknowledgePlaybackStarted and rollbackBeforeStart use exact intent id", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  const entry = repo.enqueue({
    title: "Anime",
    mediaKind: "anime",
    titleId: "anilist:1",
    absoluteEpisode: 7,
    queuePosition: 0,
    source: "manual",
    sessionId: "s",
  });
  const service = new QueueService(repo, "s");
  const intent = service.beginPlayback(entry.id, "post-play", "2026-07-20T10:00:00.000Z");
  expect(intent?.absoluteEpisode).toBe(7);

  expect(
    service.rollbackBeforeStart(intent!, {
      code: "mpv-launch-failed",
      stage: "player-launch",
      at: "2026-07-20T10:01:00.000Z",
    }),
  ).toBe(true);
  expect(repo.getById(entry.id)?.status).toBe("pending");
  expect(repo.getById(entry.id)?.queuePosition).toBe(0);

  const claimed = service.beginPlayback(entry.id, "queue", "2026-07-20T10:02:00.000Z");
  expect(service.acknowledgePlaybackStarted(claimed!, "2026-07-20T10:03:00.000Z")).toBe(true);
  expect(repo.getById(entry.id)?.status).toBe("played");

  db.close();
});

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
  const restored = service.restoreRecoverableSession("old-session");
  expect(restored.restoredIds).toHaveLength(1);
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

  const restored = service.restoreRecoverableSession("old-session");
  expect(restored.restoredIds).toHaveLength(1);
  expect(service.getAll().map((item) => item.titleId)).toEqual(["tmdb:pending"]);
  expect(service.peekNext()?.status).toBe("pending");

  db.close();
});

test("QueueService restore inserts a contiguous block between current played and pending", () => {
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
  const playedCurrent = repo.enqueue({
    title: "played-current",
    mediaKind: "series",
    titleId: "played-current",
    source: "manual",
    sessionId: "current-session",
  });
  repo.markPlayed(playedCurrent.id);
  repo.enqueue({
    title: "current-a",
    mediaKind: "series",
    titleId: "current-a",
    source: "manual",
    sessionId: "current-session",
  });
  repo.enqueue({
    title: "current-b",
    mediaKind: "series",
    titleId: "current-b",
    source: "manual",
    sessionId: "current-session",
  });
  repo.enqueue({
    title: "restored-a",
    mediaKind: "series",
    titleId: "restored-a",
    source: "watchlist",
    sessionId: "old-session",
  });
  repo.enqueue({
    title: "restored-b",
    mediaKind: "series",
    titleId: "restored-b",
    source: "watchlist",
    sessionId: "old-session",
  });

  const service = new QueueService(repo, "current-session");
  const restored = service.restoreRecoverableSession("old-session");

  expect(restored.restoredIds).toHaveLength(2);
  expect(service.getAll().map((item) => item.titleId)).toEqual([
    "played-current",
    "restored-a",
    "restored-b",
    "current-a",
    "current-b",
  ]);

  db.close();
});
