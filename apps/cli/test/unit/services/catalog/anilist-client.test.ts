import { describe, expect, test } from "bun:test";

import {
  aniListCooldownRemainingMs,
  AniListRequestError,
  postAniListGraphql,
  resetAniListClientForTest,
} from "@/services/catalog/anilist-client";

const NOW = Date.parse("2026-11-24T00:00:00.000Z");
const query = { query: "query { Viewer { id } }" };

function fetchReturning(make: () => Response, calls: { count: number }): typeof fetch {
  return Object.assign(
    async () => {
      calls.count += 1;
      return make();
    },
    { preconnect: globalThis.fetch.preconnect },
  );
}

describe("shared AniList client", () => {
  test("a 429 starts a shared cooldown; requests fail fast during it without a fetch", async () => {
    resetAniListClientForTest();
    const calls = { count: 0 };
    const limited = fetchReturning(
      () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }),
      calls,
    );
    const first = await postAniListGraphql(query, { fetchImpl: limited, now: () => NOW }).catch(
      (error: AniListRequestError) => error,
    );
    expect(first).toBeInstanceOf(AniListRequestError);
    expect((first as AniListRequestError).kind).toBe("rate-limited");
    expect(aniListCooldownRemainingMs(NOW)).toBe(30_000);

    // Another surface asks 10 s later: no request goes out.
    const second = await postAniListGraphql(
      { query: "query { Page { pageInfo { total } } }" },
      { fetchImpl: limited, now: () => NOW + 10_000 },
    ).catch((error: AniListRequestError) => error);
    expect((second as AniListRequestError).kind).toBe("rate-limited");
    expect(calls.count).toBe(1);

    // After the cooldown the next request is sent.
    const ok = fetchReturning(() => Response.json({ data: { Viewer: { id: 1 } } }), calls);
    await expect(
      postAniListGraphql(query, { fetchImpl: ok, now: () => NOW + 31_000 }),
    ).resolves.toEqual({
      data: { Viewer: { id: 1 } },
    });
    expect(calls.count).toBe(2);
  });

  test("a nearly spent budget cools down before the server says 429; absent headers do not", async () => {
    resetAniListClientForTest();
    const calls = { count: 0 };
    await postAniListGraphql(query, {
      fetchImpl: fetchReturning(() => Response.json({ data: {} }), calls),
      now: () => NOW,
    });
    expect(aniListCooldownRemainingMs(NOW)).toBe(0);

    const resetAt = Math.floor(NOW / 1000) + 20;
    await postAniListGraphql(
      { query: "query { a }" },
      {
        fetchImpl: fetchReturning(
          () =>
            Response.json(
              { data: {} },
              { headers: { "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(resetAt) } },
            ),
          calls,
        ),
        now: () => NOW,
      },
    );
    expect(aniListCooldownRemainingMs(NOW)).toBe(20_000);
  });

  test("identical concurrent requests share one fetch; one caller cancelling does not cancel the other", async () => {
    resetAniListClientForTest();
    const calls = { count: 0 };
    const release = Promise.withResolvers<void>();
    const slow: typeof fetch = Object.assign(
      async () => {
        calls.count += 1;
        await release.promise;
        return Response.json({ data: { ok: true } });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const leaving = new AbortController();
    const a = postAniListGraphql(query, { fetchImpl: slow, signal: leaving.signal });
    const b = postAniListGraphql(query, { fetchImpl: slow });
    leaving.abort();
    release.resolve();
    await expect(a).rejects.toThrow();
    await expect(b).resolves.toEqual({ data: { ok: true } });
    expect(calls.count).toBe(1);
  });

  test("HTTP errors, transport failures and GraphQL errors are told apart", async () => {
    resetAniListClientForTest();
    const calls = { count: 0 };
    const http = await postAniListGraphql(query, {
      fetchImpl: fetchReturning(() => new Response("nope", { status: 500 }), calls),
    }).catch((error: AniListRequestError) => error);
    expect((http as AniListRequestError).kind).toBe("http");
    expect((http as AniListRequestError).status).toBe(500);

    const network = await postAniListGraphql(
      { query: "query { b }" },
      {
        fetchImpl: Object.assign(
          async () => {
            throw new Error("getaddrinfo ENOTFOUND graphql.anilist.co");
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      },
    ).catch((error: AniListRequestError) => error);
    expect((network as AniListRequestError).kind).toBe("network");

    // A 200 with GraphQL errors is returned for the caller to read.
    await expect(
      postAniListGraphql(
        { query: "query { c }" },
        {
          fetchImpl: fetchReturning(
            () => Response.json({ data: null, errors: [{ message: "bad" }] }),
            calls,
          ),
        },
      ),
    ).resolves.toEqual({ data: null, errors: [{ message: "bad" }] });
  });

  test("a request the deadline aborted is reported as a timeout", async () => {
    resetAniListClientForTest();
    const timedOut: typeof fetch = Object.assign(
      async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    const error = await postAniListGraphql(query, { fetchImpl: timedOut }).catch(
      (caught: AniListRequestError) => caught,
    );
    expect((error as AniListRequestError).kind).toBe("timeout");
  });
});
