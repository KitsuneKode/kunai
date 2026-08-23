import { afterEach, expect, test } from "bun:test";

import { QueueRepository } from "../src/index";
import type { KunaiDatabase } from "../src/sqlite";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

/**
 * `queue_position` is a total ordering across rows, so a half-applied reorder
 * is not a stale queue — it is an invalid one, with duplicate or missing
 * positions. Anything that can interrupt the write loop leaves it that way: a
 * crash, the memory watchdog's SIGKILL, or the shutdown coordinator's
 * force-exit deadline.
 *
 * Interruption is simulated by failing one statement mid-batch, which is the
 * only part of that scenario a unit test can reproduce deterministically.
 */
function failingDbAfter(
  db: KunaiDatabase,
  failOnRunNumber: number,
): { db: KunaiDatabase; runs: () => number } {
  let runs = 0;

  // bun:sqlite's Database and Statement use private fields, so every method has
  // to stay bound to the real object. Returning them through the proxy as the
  // receiver fails with "Cannot access invalid private field".
  const passThrough = (target: object, property: PropertyKey) => {
    const value = Reflect.get(target, property, target) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  };

  const proxy = new Proxy(db, {
    get(target, property) {
      if (property !== "query") return passThrough(target, property);
      return (sql: string) => {
        const statement = target.query(sql);
        if (!sql.includes("SET queue_position")) return statement;
        return new Proxy(statement, {
          get(stmtTarget, stmtProperty) {
            if (stmtProperty !== "run") return passThrough(stmtTarget, stmtProperty);
            return (...args: unknown[]) => {
              runs += 1;
              if (runs === failOnRunNumber) {
                throw new Error("simulated interruption mid-reorder");
              }
              return (stmtTarget.run as (...a: unknown[]) => unknown)(...args);
            };
          },
        });
      };
    },
  });
  return { db: proxy as KunaiDatabase, runs: () => runs };
}

function seedQueue(db: KunaiDatabase): { repo: QueueRepository; ids: string[] } {
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-08-23T09:00:00.000Z",
    updatedAt: "2026-08-23T09:00:00.000Z",
  });
  const ids = ["a", "b", "c", "d"].map(
    (title, index) =>
      repo.enqueue({
        title,
        mediaKind: "anime",
        titleId: `anilist:${title}`,
        absoluteEpisode: 1,
        queuePosition: index,
        source: "manual",
        sessionId: "session",
      }).id,
  );
  return { repo, ids };
}

test("a reorder interrupted mid-batch leaves the original ordering, not a partial one", () => {
  const store = stores.store("queue-reorder-atomicity", "data");
  const { ids } = seedQueue(store);
  const before = new QueueRepository(store)
    .getAll("session")
    .map((entry) => [entry.title, entry.queuePosition] as const);

  // Reverse the queue, failing on the third of four writes.
  const { db: flaky } = failingDbAfter(store, 3);
  const flakyRepo = new QueueRepository(flaky);

  expect(() => flakyRepo.setQueuePositions([...ids].reverse())).toThrow(
    "simulated interruption mid-reorder",
  );

  const after = new QueueRepository(store)
    .getAll("session")
    .map((entry) => [entry.title, entry.queuePosition] as const);

  // Without a transaction the first two writes commit and the queue is left
  // with duplicate positions — d=0, c=1, and the untouched c/d rows still at
  // 2 and 3.
  expect(after).toEqual(before);

  const positions = after.map(([, position]) => position);
  expect(new Set(positions).size).toBe(positions.length);
});

test("a completed reorder still applies every position", () => {
  const store = stores.store("queue-reorder-applies", "data");
  const { repo, ids } = seedQueue(store);

  repo.setQueuePositions([...ids].reverse());

  expect(repo.getAll("session").map((entry) => entry.title)).toEqual(["d", "c", "b", "a"]);
  expect(repo.getAll("session").map((entry) => entry.queuePosition)).toEqual([0, 1, 2, 3]);
});
