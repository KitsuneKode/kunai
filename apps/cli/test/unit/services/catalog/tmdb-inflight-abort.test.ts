import { afterEach, describe, expect, test } from "bun:test";

import { clearTmdbSessionCache, fetchTmdbJsonCached } from "@/services/catalog/tmdb-proxy";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTmdbSessionCache();
});

/** Count unhandled rejections for the duration of `run`, then one macrotask. */
async function unhandledDuring(run: () => Promise<void>): Promise<number> {
  let seen = 0;
  const onUnhandled = () => {
    seen += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

describe("TMDB in-flight requests and cancelled callers", () => {
  test("an already-cancelled caller starts no request", async () => {
    let calls = 0;
    globalThis.fetch = Object.assign(
      async (): Promise<Response> => {
        calls += 1;
        return Response.json({});
      },
      { preconnect: originalFetch.preconnect },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(fetchTmdbJsonCached("/movie/550", controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test("a shared request that fails after every caller left is not an unhandled rejection", async () => {
    // Offline: every host fails, and nothing is saved to fall back on.
    let failNow: (() => void) | undefined;
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          failNow = () => reject(new TypeError("offline"));
        }),
      { preconnect: originalFetch.preconnect },
    );
    const unhandled = await unhandledDuring(async () => {
      const controller = new AbortController();
      const joined = fetchTmdbJsonCached("/movie/551", controller.signal);
      controller.abort();
      await expect(joined).rejects.toThrow();
      // The leader request is still running; now it fails with no listener.
      while (failNow) {
        const fail: () => void = failNow;
        failNow = undefined;
        fail();
        await new Promise((resolve) => setImmediate(resolve));
      }
    });
    expect(unhandled).toBe(0);
  });
});
