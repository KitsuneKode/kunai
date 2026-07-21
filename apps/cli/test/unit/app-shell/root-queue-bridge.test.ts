import { afterEach, expect, mock, test } from "bun:test";

import {
  claimQueuePlaybackLaunch,
  hasPendingRootQueueSelection,
  resolveQueueRowPlaySelection,
  resolveRootQueueSelection,
  waitForRootQueueSelection,
} from "@/app-shell/root-queue-bridge";
import { QueueService } from "@/domain/queue/QueueService";
import { openKunaiDatabase, QueueRepository, runMigrations } from "@kunai/storage";

afterEach(() => {
  if (hasPendingRootQueueSelection()) {
    resolveRootQueueSelection(null);
  }
});

function setupQueue() {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "s",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  const enqueue = (titleId: string, absoluteEpisode: number) =>
    repo.enqueue({
      title: titleId,
      mediaKind: "anime",
      titleId,
      absoluteEpisode,
      source: "manual",
      sessionId: "s",
    });
  const head = enqueue("head", 1);
  const selected = enqueue("selected", 13);
  const service = new QueueService(repo, "s");
  return { db, repo, service, head, selected };
}

test("claimQueuePlaybackLaunch claims row B via beginPlayback, not head", () => {
  const { db, repo, service, head, selected } = setupQueue();

  const launch = claimQueuePlaybackLaunch(service, selected.id, "queue");

  expect(launch).toEqual({
    title: "selected",
    intent: {
      queueEntryId: selected.id,
      titleId: "selected",
      mediaKind: "anime",
      absoluteEpisode: 13,
      source: "queue",
    },
  });
  expect(repo.getById(head.id)?.status).toBe("pending");
  expect(repo.getById(selected.id)?.status).toBe("in-flight");

  db.close();
});

test("failed compare-and-set leaves overlay open (no resolve, no close)", () => {
  const { db, service, selected } = setupQueue();
  expect(claimQueuePlaybackLaunch(service, selected.id, "queue")).toBeDefined();

  const resolve = mock(() => {});
  const closeOverlay = mock(() => {});
  const outcome = resolveQueueRowPlaySelection(service, selected.id, resolve, closeOverlay);

  expect(outcome).toBe("failed");
  expect(resolve).not.toHaveBeenCalled();
  expect(closeOverlay).not.toHaveBeenCalled();

  db.close();
});

test("Enter path resolves bridge with claimed intent then closes overlay", () => {
  const { db, service, selected } = setupQueue();
  const resolve = mock(() => {});
  const closeOverlay = mock(() => {});

  const outcome = resolveQueueRowPlaySelection(service, selected.id, resolve, closeOverlay);

  expect(outcome).toBe("claimed");
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(resolve.mock.calls[0]?.[0]).toMatchObject({
    title: "selected",
    intent: { queueEntryId: selected.id, absoluteEpisode: 13, source: "queue" },
  });
  expect(closeOverlay).toHaveBeenCalledTimes(1);

  db.close();
});

test("Escape resolves null without mutating queue state", async () => {
  const { db, repo, head, selected } = setupQueue();
  const pending = waitForRootQueueSelection();

  resolveRootQueueSelection(null);
  await expect(pending).resolves.toBeNull();

  expect(repo.getById(head.id)?.status).toBe("pending");
  expect(repo.getById(selected.id)?.status).toBe("pending");
  expect(repo.getById(head.id)?.playedAt).toBeUndefined();
  expect(repo.getById(selected.id)?.playedAt).toBeUndefined();

  db.close();
});
