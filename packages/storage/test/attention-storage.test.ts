import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FollowedTitleRepository,
  NotificationRepository,
  openKunaiDatabase,
  QueueRepository,
  PlaylistsRepository,
  runMigrations,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("QueueRepository: queue sessions can be marked recoverable and restored", () => {
  const db = migratedDataDb();
  const repo = new QueueRepository(db);

  repo.createQueueSession({
    id: "session-1",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  repo.enqueue({
    title: "Example",
    mediaKind: "series",
    titleId: "tmdb:1",
    season: 1,
    episode: 2,
    priority: 0,
    queuePosition: 0,
    source: "notification",
    sessionId: "session-1",
  });
  repo.markQueueSessionRecoverable("session-1", "2026-05-17T00:05:00.000Z");

  const recoverable = repo.listRecoverableQueueSessions();
  expect(recoverable).toHaveLength(1);
  expect(recoverable[0]?.itemCount).toBe(1);

  db.close();
});

test("QueueRepository: startup recovery only exposes prior active sessions with pending items", () => {
  const db = migratedDataDb();
  const repo = new QueueRepository(db);

  repo.createQueueSession({
    id: "previous-session",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  repo.createQueueSession({
    id: "empty-session",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  repo.enqueue({
    title: "Example",
    mediaKind: "series",
    titleId: "tmdb:1",
    season: 1,
    episode: 2,
    priority: 0,
    source: "notification",
    sessionId: "previous-session",
  });

  repo.markActiveQueueSessionsRecoverable("current-session", "2026-05-17T00:10:00.000Z");

  expect(repo.listRecoverableQueueSessions().map((session) => session.id)).toEqual([
    "previous-session",
  ]);

  db.close();
});

test("QueueRepository: restore moves recoverable queue items into the current session", () => {
  const db = migratedDataDb();
  const repo = new QueueRepository(db);

  repo.createQueueSession({
    id: "previous-session",
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
    priority: 0,
    source: "notification",
    sessionId: "previous-session",
  });

  const restored = repo.restoreQueueSession(
    "previous-session",
    "current-session",
    "2026-05-17T00:21:00.000Z",
  );

  expect(restored).toHaveLength(1);
  expect(repo.getUnplayed("current-session")).toHaveLength(1);
  expect(repo.getQueueSession("previous-session")?.status).toBe("closed");

  db.close();
});

test("NotificationRepository: upsert dedupes and dismiss hides active rows", () => {
  const db = migratedDataDb();
  const repo = new NotificationRepository(db);

  repo.upsert({
    dedupKey: "new-playable-episode:tmdb:1:1:2:vidking",
    kind: "new-episode",
    title: "Example E2",
    body: "Episode 2 is available",
    itemJson: JSON.stringify({ titleId: "tmdb:1" }),
    actionJson: JSON.stringify([{ id: "queue-end" }]),
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  repo.upsert({
    dedupKey: "new-playable-episode:tmdb:1:1:2:vidking",
    kind: "new-episode",
    title: "Example E2",
    body: "Episode 2 is still available",
    itemJson: JSON.stringify({ titleId: "tmdb:1" }),
    actionJson: JSON.stringify([{ id: "queue-end" }]),
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:01:00.000Z",
  });

  expect(repo.listActive()).toHaveLength(1);
  // Active is now defined by archive state (read/archive model); archive hides the row.
  repo.archive("new-playable-episode:tmdb:1:1:2:vidking", "2026-05-17T00:02:00.000Z");
  expect(repo.listActive()).toHaveLength(0);

  db.close();
});

test("FollowedTitleRepository stores explicit follow and mute preferences", () => {
  const db = migratedDataDb();
  const repo = new FollowedTitleRepository(db);

  repo.upsert({
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    preference: "following",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  expect(repo.get("tmdb:1")?.preference).toBe("following");

  repo.upsert({
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    preference: "muted",
    updatedAt: "2026-05-17T00:01:00.000Z",
  });
  expect(repo.get("tmdb:1")?.preference).toBe("muted");

  db.close();
});

test("PlaylistsRepository stores durable playlist items without progress copies", () => {
  const db = migratedDataDb();
  const repo = new PlaylistsRepository(db);

  repo.create({
    id: "playlist-1",
    name: "Weekend",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  repo.addItem({
    id: "item-1",
    playlistId: "playlist-1",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 2,
    sortOrder: 0,
    providerHintsJson: JSON.stringify([{ providerId: "vidking" }]),
    addedAt: "2026-05-17T00:01:00.000Z",
  });

  expect(repo.listItems("playlist-1")[0]?.title).toBe("Example");
  expect(JSON.stringify(repo.listItems("playlist-1")[0])).not.toContain("positionSeconds");

  db.close();
});

function migratedDataDb() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-attention-storage-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return db;
}
