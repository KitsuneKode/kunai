import { expect, test } from "bun:test";

import { disposeContainer, registerContainerDisposeHandles } from "@/container/dispose-container";
import type { Container } from "@/container/types";

function fakeContainer(calls: string[], options: { failDataClose?: boolean } = {}) {
  const container = {
    backgroundWorkScheduler: {
      beginShutdown: (reason: string) => calls.push(`scheduler:shutdown:${reason}`),
      drain: async () => {
        calls.push("scheduler:drain");
        return { completed: [], failed: [], skipped: [] };
      },
    },
    diagnosticsService: {
      flush: () => calls.push("diagnostics:flush"),
    },
    syncService: {
      shutdown: async () => {
        calls.push("sync:shutdown");
      },
    },
    syncTokenStore: {
      whenIdle: async () => {
        calls.push("sync:tokens-idle");
      },
    },
  } as unknown as Container;

  registerContainerDisposeHandles(container, {
    dataDb: {
      close: () => {
        calls.push("data:close");
        if (options.failDataClose) throw new Error("data close failed");
      },
    } as never,
    cacheDb: { close: () => calls.push("cache:close") } as never,
    downloadResolveAbort: null,
  });

  return container;
}

/**
 * The order is the contract, not an implementation detail. A drain still
 * holding an outbox claim when `dataDb` closes faults on a dead handle, and a
 * token write that has not settled loses a credential the user just granted.
 */
test("disposes in order: quiesce scheduler, drain, settle sync, flush, close DBs", async () => {
  const calls: string[] = [];
  const container = fakeContainer(calls);

  await disposeContainer(container);

  expect(calls).toEqual([
    "scheduler:shutdown:container-dispose",
    "scheduler:drain",
    "sync:shutdown",
    "sync:tokens-idle",
    "diagnostics:flush",
    "data:close",
    "cache:close",
  ]);
});

test("a failing DB close does not skip the remaining teardown", async () => {
  const calls: string[] = [];
  const container = fakeContainer(calls, { failDataClose: true });

  await disposeContainer(container);

  expect(calls).toContain("data:close");
  expect(calls).toContain("cache:close");
});

test("concurrent disposal runs every resource exactly once", async () => {
  const calls: string[] = [];
  const container = fakeContainer(calls);

  await Promise.all([disposeContainer(container), disposeContainer(container)]);
  await disposeContainer(container);

  expect(calls.filter((call) => call === "data:close")).toHaveLength(1);
  expect(calls.filter((call) => call === "cache:close")).toHaveLength(1);
  expect(calls.filter((call) => call === "scheduler:drain")).toHaveLength(1);
});

test("disposing a null or unregistered container is a no-op", async () => {
  await disposeContainer(null);
  await disposeContainer({} as Container);
});
