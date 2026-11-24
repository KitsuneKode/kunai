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

describe("TMDB in-flight requests and a session clear", () => {
  test("a request cleared mid-flight answers its caller but never writes the cache", async () => {
    const answers: Array<(body: { readonly title: string }) => void> = [];
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        new Promise<Response>((resolve) => {
          answers.push((body) => resolve(Response.json(body)));
        }),
      { preconnect: originalFetch.preconnect },
    );
    const before = fetchTmdbJsonCached("/movie/552");
    clearTmdbSessionCache();
    // A caller after the refresh starts its own request instead of joining.
    const after = fetchTmdbJsonCached("/movie/552");
    expect(answers).toHaveLength(2);

    answers[1]?.({ title: "Newer" });
    expect(await after).toEqual({ title: "Newer" });
    // The pre-refresh request settles last; its caller still gets an answer.
    answers[0]?.({ title: "Older" });
    expect(await before).toEqual({ title: "Older" });

    // The session cache holds the post-refresh answer, with no new request.
    expect(await fetchTmdbJsonCached("/movie/552")).toEqual({ title: "Newer" });
    expect(answers).toHaveLength(2);
  });
});
