import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openKunaiDatabase, QueueRepository, runMigrations } from "../src/index";

const tempDirs: string[] = [];
const NOW = "2026-07-20T12:00:00.000Z";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createRepo(): QueueRepository {
  const dir = mkdtempSync(join(tmpdir(), "kunai-queue-lifecycle-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  });
  return repo;
}

function enqueue(repo: QueueRepository, sessionId: string, title: string) {
  return repo.enqueue({
    title,
    mediaKind: "anime",
    titleId: `anilist:${title}`,
    absoluteEpisode: 1,
    queuePosition: title === "a" || title === "first" ? 0 : 1,
    source: "manual",
    sessionId,
  });
}

test("acknowledges only the exact in-flight id", () => {
  const repo = createRepo();
  const a = enqueue(repo, "session", "a");
  const b = enqueue(repo, "session", "b");
  repo.markInFlight(b.id, "session", "2026-07-20T10:00:00.000Z");

  expect(repo.acknowledgePlaybackStarted(a.id, "session", NOW)).toBe(false);
  expect(repo.acknowledgePlaybackStarted(b.id, "session", NOW)).toBe(true);
  expect(repo.getById(a.id)?.status).toBe("pending");
  expect(repo.getById(b.id)?.status).toBe("played");
});

test("pre-start rollback preserves position and failure context", () => {
  const repo = createRepo();
  const first = enqueue(repo, "session", "first");
  const second = enqueue(repo, "session", "second");
  repo.markInFlight(first.id, "session", NOW);
  expect(
    repo.restoreInFlightToPending(first.id, "session", {
      code: "mpv-launch-failed",
      stage: "player-launch",
      at: NOW,
    }),
  ).toBe(true);
  expect(repo.getAllForSession("session").map((row) => row.id)).toEqual([first.id, second.id]);
  expect(repo.getById(first.id)?.status).toBe("pending");
  expect(repo.getById(first.id)?.queuePosition).toBe(0);
  expect(repo.getById(first.id)?.lastFailure).toEqual({
    code: "mpv-launch-failed",
    stage: "player-launch",
    at: NOW,
  });
  expect(repo.getById(first.id)?.inFlightAt).toBeUndefined();
});

test("claim is compare-and-set on pending rows only", () => {
  const repo = createRepo();
  const first = enqueue(repo, "session", "first");
  const second = enqueue(repo, "session", "second");

  expect(repo.markInFlight(first.id, "session", NOW)).toBe(true);
  expect(repo.markInFlight(first.id, "session", NOW)).toBe(false);
  expect(repo.markInFlight(second.id, "other-session", NOW)).toBe(false);
  expect(repo.getById(first.id)?.status).toBe("in-flight");
  expect(repo.getById(first.id)?.inFlightAt).toBe(NOW);
  expect(repo.getById(second.id)?.status).toBe("pending");
});

test("queue transitions update session last_activity_at", () => {
  const repo = createRepo();
  const entry = enqueue(repo, "session", "first");
  expect(repo.markInFlight(entry.id, "session", "2026-07-20T10:00:00.000Z")).toBe(true);
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:00:00.000Z");

  expect(
    repo.restoreInFlightToPending(entry.id, "session", {
      code: "provider-exhausted",
      stage: "provider-resolution",
      at: "2026-07-20T10:05:00.000Z",
    }),
  ).toBe(true);
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:05:00.000Z");

  expect(repo.markInFlight(entry.id, "session", "2026-07-20T10:10:00.000Z")).toBe(true);
  expect(repo.acknowledgePlaybackStarted(entry.id, "session", "2026-07-20T10:15:00.000Z")).toBe(
    true,
  );
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:15:00.000Z");
});

test("restore resets in-flight, places contiguous block, and returns restored ids", () => {
  const repo = createRepo();
  repo.createQueueSession({
    id: "old",
    status: "recoverable",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
  });
  const playedCurrent = enqueue(repo, "session", "played-current");
  repo.markPlayed(playedCurrent.id);
  enqueue(repo, "session", "current-a");
  enqueue(repo, "session", "current-b");
  const restoredA = enqueue(repo, "old", "restored-a");
  const restoredB = enqueue(repo, "old", "restored-b");
  expect(repo.markInFlight(restoredA.id, "old", "2026-07-19T00:55:00.000Z")).toBe(true);

  const restoredIds = repo.restoreQueueSession("old", "session", NOW);

  expect(restoredIds).toEqual([restoredA.id, restoredB.id]);
  expect(repo.getById(restoredA.id)?.status).toBe("pending");
  expect(repo.getById(restoredA.id)?.inFlightAt).toBeUndefined();
  expect(repo.getAll("session").map((row) => row.titleId)).toEqual([
    "anilist:played-current",
    "anilist:restored-a",
    "anilist:restored-b",
    "anilist:current-a",
    "anilist:current-b",
  ]);
  expect(repo.getQueueSession("old")?.status).toBe("closed");
});
