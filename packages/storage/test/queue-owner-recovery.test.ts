import { afterEach, expect, test } from "bun:test";

import { QueueRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();
afterEach(() => stores.cleanup());

function fixture() {
  const repo = new QueueRepository(stores.store("queue-owner", "data"));
  const original = {
    id: "owned",
    status: "active" as const,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    ownerPid: 123,
    ownerHostname: "local",
    ownerProcessStartId: "original",
  };
  repo.createQueueSession(original);
  repo.enqueue({
    title: "Local title",
    titleId: "tmdb:1",
    mediaKind: "movie",
    source: "manual",
    sessionId: original.id,
  });
  const observed = repo.getQueueSession(original.id);
  if (!observed) throw new Error("fixture session missing");
  return { repo, original: observed };
}

test("persists the full owner identity and uses it when listing recovery candidates", () => {
  const { repo, original } = fixture();
  expect(repo.listActiveQueueSessionsWithPendingWork("other")).toEqual([original]);
});

for (const changed of [
  { ownerProcessStartId: "successor" },
  { ownerHostname: "other-host" },
  { ownerPid: 456 },
]) {
  test(`a new ${Object.keys(changed)[0]} defeats a stale recovery decision`, () => {
    const { repo, original } = fixture();
    repo.createQueueSession({ ...original, ...changed });
    repo.markQueueSessionRecoverable(original.id, "2026-10-07T00:01:00.000Z", {
      ownerPid: original.ownerPid,
      ownerHostname: original.ownerHostname,
      ownerProcessStartId: original.ownerProcessStartId,
      activityAt: original.lastActivityAt ?? original.updatedAt,
    });
    expect(repo.getQueueSession(original.id)?.status).toBe("active");
    expect(repo.getAll(original.id)).toHaveLength(1);
  });
}

test("a matching owner becomes recoverable and its rows restore exactly once", () => {
  const { repo, original } = fixture();
  repo.markQueueSessionRecoverable(original.id, "2026-10-07T00:01:00.000Z", {
    ownerPid: original.ownerPid,
    ownerHostname: original.ownerHostname,
    ownerProcessStartId: original.ownerProcessStartId,
    activityAt: original.lastActivityAt ?? original.updatedAt,
  });
  expect(repo.getQueueSession(original.id)?.status).toBe("recoverable");
  repo.createQueueSession({ ...original, id: "target" });
  expect(repo.restoreQueueSession(original.id, "target", "2026-10-07T00:02:00.000Z")).toHaveLength(
    1,
  );
  expect(repo.restoreQueueSession(original.id, "target", "2026-10-07T00:03:00.000Z")).toEqual([]);
  expect(repo.getAll("target")).toHaveLength(1);
});
