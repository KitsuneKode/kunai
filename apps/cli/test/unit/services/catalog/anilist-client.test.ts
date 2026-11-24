import { beforeEach, describe, expect, test } from "bun:test";

import {
  aniListCooldownRemainingMs,
  AniListRequestError,
  postAniListGraphql,
  resetAniListClientForTest,
  setAniListClockForTest,
} from "@/services/catalog/anilist-client";

const query = { query: "query { Viewer { id } }" };
let tick = 0;

beforeEach(() => {
  resetAniListClientForTest();
  tick = 0;
  setAniListClockForTest(() => tick);
});

function stub(make: () => Response | Promise<Response>, calls: { count: number }): typeof fetch {
  return Object.assign(
    async () => {
      calls.count += 1;
      return make();
    },
    { preconnect: globalThis.fetch.preconnect },
  );
}

async function failure(promise: Promise<unknown>): Promise<AniListRequestError> {
  const caught = await promise.then(
    () => null,
    (error: AniListRequestError) => error,
  );
  if (!(caught instanceof AniListRequestError)) throw new Error("expected an AniListRequestError");
  return caught;
}

describe("rate limits", () => {
  test("a 429 starts a shared cooldown; requests fail fast during it without a fetch", async () => {
    const calls = { count: 0 };
    const limited = stub(
      () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
      calls,
    );
    expect((await failure(postAniListGraphql(query, { fetchImpl: limited }))).retryAfterMs).toBe(
      30_000,
    );
    expect(aniListCooldownRemainingMs()).toBe(30_000);

    tick = 10_000;
    const second = await failure(
      postAniListGraphql({ query: "query { b }" }, { fetchImpl: limited }),
    );
    expect(second.kind).toBe("rate-limited");
    expect(second.retryAfterMs).toBe(20_000);
    expect(calls.count).toBe(1);

    tick = 31_000;
    const ok = stub(() => Response.json({ data: { Viewer: { id: 1 } } }), calls);
    await expect(postAniListGraphql(query, { fetchImpl: ok })).resolves.toEqual({
      data: { Viewer: { id: 1 } },
    });
    expect(calls.count).toBe(2);
  });

  test("garbage or negative Retry-After falls back to the reset header, then the default; huge values are capped", async () => {
    const calls = { count: 0 };
    const resetIn20 = String(Math.floor(Date.now() / 1000) + 20);
    const withReset = await failure(
      postAniListGraphql(query, {
        fetchImpl: stub(
          () =>
            new Response("{}", {
              status: 429,
              headers: { "retry-after": "-1", "x-ratelimit-reset": resetIn20 },
            }),
          calls,
        ),
      }),
    );
    expect(withReset.retryAfterMs).toBeGreaterThan(18_000);
    expect(withReset.retryAfterMs).toBeLessThanOrEqual(20_000);

    resetAniListClientForTest();
    setAniListClockForTest(() => tick);
    const huge = await failure(
      postAniListGraphql(query, {
        fetchImpl: stub(
          () => new Response("{}", { status: 429, headers: { "retry-after": "999999999" } }),
          calls,
        ),
      }),
    );
    // Callers are told the delay that is actually enforced.
    expect(huge.retryAfterMs).toBe(120_000);
    expect(aniListCooldownRemainingMs()).toBe(120_000);
  });

  test("a nearly spent budget cools down early; absent headers do not", async () => {
    const calls = { count: 0 };
    await postAniListGraphql(query, { fetchImpl: stub(() => Response.json({ data: {} }), calls) });
    expect(aniListCooldownRemainingMs()).toBe(0);

    await postAniListGraphql(
      { query: "query { a }" },
      {
        fetchImpl: stub(
          () => Response.json({ data: {} }, { headers: { "x-ratelimit-remaining": "1" } }),
          calls,
        ),
      },
    );
    expect(aniListCooldownRemainingMs()).toBe(15_000);
  });

  test("a request started before a reset cannot reinstate a cooldown after it", async () => {
    const release = Promise.withResolvers<Response>();
    const pending = postAniListGraphql(query, {
      fetchImpl: stub(() => release.promise, { count: 0 }),
    });
    resetAniListClientForTest();
    setAniListClockForTest(() => tick);
    release.resolve(new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    await pending.catch(() => undefined);
    expect(aniListCooldownRemainingMs()).toBe(0);
  });
});

describe("dedupe and cancellation", () => {
  test("identical requests share one fetch; one caller leaving does not cancel the other", async () => {
    const calls = { count: 0 };
    const release = Promise.withResolvers<void>();
    const slow = stub(async () => {
      await release.promise;
      return Response.json({ data: { ok: true } });
    }, calls);
    const leaving = new AbortController();
    const a = postAniListGraphql(query, { fetchImpl: slow, signal: leaving.signal });
    const b = postAniListGraphql(query, { fetchImpl: slow });
    leaving.abort();
    release.resolve();
    await expect(a).rejects.toThrow();
    await expect(b).resolves.toEqual({ data: { ok: true } });
    expect(calls.count).toBe(1);
  });

  test("different deadlines do not share a fetch; the fetch aborts once nobody waits", async () => {
    const calls = { count: 0 };
    let transportSignal: AbortSignal | undefined;
    const hang: typeof fetch = Object.assign(
      (_input: string | URL | Request, init?: RequestInit) => {
        calls.count += 1;
        transportSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const only = new AbortController();
    const short = postAniListGraphql(query, {
      fetchImpl: hang,
      timeoutMs: 1_000,
      signal: only.signal,
    });
    void postAniListGraphql(query, {
      fetchImpl: hang,
      timeoutMs: 8_000,
      signal: AbortSignal.abort(),
    }).catch(() => undefined);
    only.abort();
    await expect(short).rejects.toThrow();
    expect(calls.count).toBe(1);
    expect(transportSignal?.aborted).toBe(true);
  });
});

describe("answers and failures", () => {
  test("a 404 GraphQL envelope is an answer (missing Media); an HTML 404 is an HTTP failure", async () => {
    const calls = { count: 0 };
    await expect(
      postAniListGraphql(query, {
        fetchImpl: stub(
          () =>
            Response.json(
              { data: { Media: null }, errors: [{ message: "Not Found.", status: 404 }] },
              { status: 404 },
            ),
          calls,
        ),
      }),
    ).resolves.toEqual({ data: { Media: null }, errors: [{ message: "Not Found.", status: 404 }] });

    const html = await failure(
      postAniListGraphql(
        { query: "query { x }" },
        {
          fetchImpl: stub(() => new Response("<html>404</html>", { status: 404 }), calls),
        },
      ),
    );
    expect(html.kind).toBe("http");
    expect(html.status).toBe(404);
  });

  test("transport failures, deadline aborts and GraphQL errors are told apart", async () => {
    const network = await failure(
      postAniListGraphql(query, {
        fetchImpl: Object.assign(
          async () => {
            throw new Error("getaddrinfo ENOTFOUND graphql.anilist.co");
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      }),
    );
    expect(network.kind).toBe("network");

    const timeout = await failure(
      postAniListGraphql(
        { query: "query { t }" },
        {
          fetchImpl: Object.assign(
            async () => {
              throw new DOMException("The operation timed out.", "TimeoutError");
            },
            { preconnect: globalThis.fetch.preconnect },
          ),
        },
      ),
    );
    expect(timeout.kind).toBe("timeout");

    await expect(
      postAniListGraphql(
        { query: "query { c }" },
        {
          fetchImpl: stub(() => Response.json({ data: null, errors: [{ message: "bad" }] }), {
            count: 0,
          }),
        },
      ),
    ).resolves.toEqual({ data: null, errors: [{ message: "bad" }] });
  });
});
