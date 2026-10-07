import { expect, test } from "bun:test";

import { createContainer, disposeContainer, type Container } from "@/container";

import { applyStorageRootEnv } from "../helpers/storage-env";
import { createIsolatedCliProfile, disposeIsolatedCliProfile } from "./helpers/isolated-container";

async function startupReport() {
  const profile = createIsolatedCliProfile("queue-owner-recovery");
  const restoreEnv = applyStorageRootEnv(profile.rootDir);
  const previousBackend = process.env.KUNAI_CREDENTIAL_BACKEND;
  process.env.KUNAI_CREDENTIAL_BACKEND = "file";
  const containers: Container[] = [];
  try {
    const first = await createContainer();
    containers.push(first);
    const owned = first.queueRepository.getQueueSession(first.sessionId);
    if (!owned) throw new Error("startup did not persist queue ownership");
    expect(owned.ownerHostname).toBeTruthy();
    for (const id of [first.sessionId, "reused-pid", "foreign-host"]) {
      if (id !== first.sessionId)
        first.queueRepository.createQueueSession({
          ...owned,
          id,
          ownerHostname: id === "foreign-host" ? "fixture-foreign-host" : owned.ownerHostname,
          ownerProcessStartId: "fixture-impossible-process-start",
        });
      first.queueRepository.enqueue({
        title: "Owned title",
        titleId: "tmdb:1",
        mediaKind: "movie",
        source: "manual",
        sessionId: id,
      });
    }
    const second = await createContainer();
    containers.push(second);
    return {
      ownStartId: owned.ownerProcessStartId,
      live: second.queueRepository.getQueueSession(first.sessionId)?.status,
      foreign: second.queueRepository.getQueueSession("foreign-host")?.status,
      reused: second.queueRepository.getQueueSession("reused-pid")?.status,
      retainedRows: second.queueRepository.getAll(first.sessionId),
      newRows: second.queueRepository.getAll(second.sessionId),
      currentTitle: second.stateManager.getState().currentTitle,
    };
  } finally {
    try {
      await Promise.all(containers.map(disposeContainer));
    } finally {
      restoreEnv();
      if (previousBackend === undefined) delete process.env.KUNAI_CREDENTIAL_BACKEND;
      else process.env.KUNAI_CREDENTIAL_BACKEND = previousBackend;
      disposeIsolatedCliProfile(profile);
    }
  }
}

test("second startup retains live and foreign queues and never autoplays", async () => {
  const result = await startupReport();
  expect(result.live).toBe("active");
  expect(result.foreign).toBe("active");
  expect(result.retainedRows).toHaveLength(1);
  expect(result.newRows).toEqual([]);
  expect(result.currentTitle).toBeNull();
});

test.skipIf(process.platform !== "linux")(
  "Linux startup recovers a reused PID using its real process-start identity",
  async () => {
    const result = await startupReport();
    expect(result.ownStartId).toBeTruthy();
    expect(result.reused).toBe("recoverable");
  },
);
