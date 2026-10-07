import { afterEach, describe, expect, test } from "bun:test";

import type {
  EndpointHealthPort,
  ProviderResolveInput,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  buildMovyCycleCandidates,
  clearMovySeedCacheForTest,
  MOVY_LANES,
  movyProviderModule,
} from "../src/movy/direct";
import { decryptMovyPayload, MovyDecryptError } from "../src/movy/streamcrypto";

/**
 * Captured live from `api.wecollege.net/denver/sources` (TMDB 1423191,
 * "Resident Evil") — the seed is single-use but the pair is deterministic
 * for the decrypt unit test.
 */
const FIXTURE = {
  mediaId: 1423191,
  seed: "59665995.3iGZoNse-HCabgy8zEUxzK",
  body: "Gc7BiP5izH7sRFsEkE6DekTjI3ic2TJrt_QWRED0K0FJMC45xn9xgQ_Exe5Bqlm_fHWLpBJ0F1lbBy-hcT-lExM5SiuEKgtyvxjL4XEY-bG0jxJ2q-8UTrRmyFyS_TXKIFu9IOqn2kEKzM2GPZbdCNobugnwA2tqbo8Xn0ZMI6bz2IW3VXfiCsj5nF54Ix1ACC_eIWUpxov6jNLxE2f0J6m8vqG0GZ54UomRdJAGEbeFpOasUvC7xzCNUkdgmKQN2p4sTMtCH-OTiSxkg0s7S-IpHDaQ35c8cxoW5uH4Ao-H9t2QWoBxOp6KdvimvD_hn9h_eVTN6o2Fd_fh5QQcf9wSKcwGESVwsbhXGOBURl7IYp4cK0l2M8EVt93_EnFaTH4tCCgp8IJf79grTz8YePFy7KNa5zRYt5ABDCc6HhDd6fd0M3oKkYuf1dRTFkddFqYkyD1nbqCox33D",
};

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "movy",
  now: () => "2026-09-21T00:00:00.000Z",
};

const MOVIE_INPUT: ProviderResolveInput = {
  title: {
    id: "tmdb:1423191",
    kind: "movie",
    title: "Resident Evil",
    year: 2026,
    tmdbId: "1423191",
    imdbId: "tt35538033",
  },
  episode: { season: 1, episode: 1 },
  mediaKind: "movie",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

function contextReturning(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): ProviderRuntimeContext {
  return {
    ...TEST_CONTEXT,
    // SAFETY: test stub — supplies only the fetch surface this module calls.
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) => handler(String(url), init),
    } as ProviderRuntimeContext["fetch"],
  };
}

describe("decryptMovyPayload", () => {
  test("decrypts a real captured ciphertext into the sources JSON", () => {
    const plain = decryptMovyPayload(FIXTURE.body, FIXTURE.seed, FIXTURE.mediaId);
    // SAFETY: decrypted fixture is asserted structurally on the next lines;
    // a shape surprise fails the expectations, never ships silently.
    const parsed = JSON.parse(plain) as { sources?: { url?: string }[] };
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources?.length).toBe(1);
    expect(parsed.sources?.[0]?.url).toBe(
      "https://mbph.stillhaven.top/mp4/3mRCP1BX_cl-Yj_NcKYNQdKQuuqi6OW44Lyb7BXnLJUbeGfmEBhOkJ2Ext9sqv-Mt2ePyC6PuF49m0f1pCxgQlO_XCNVwu1GKF9oSV2VephzPXk9zBuVBOyypRCtJldYv866Hif8KOLrtXdUd6wo0tDGmsm3cdpdce6jawy6Gpj2z3A95OyXZkyPmRp0gkmHQ1BDZ1dhU5JXdjjUo9EdA-t-GA9l7R3pfZw3zOidE5I9Ey_Ecn3CiYvh432bBC0v",
    );
  });

  test("rejects a wrong seed via the mvm1 magic check", () => {
    expect(() => decryptMovyPayload(FIXTURE.body, "0.wrongseed", FIXTURE.mediaId)).toThrow(
      MovyDecryptError,
    );
  });

  test("rejects a wrong mediaId via the mvm1 magic check", () => {
    expect(() => decryptMovyPayload(FIXTURE.body, FIXTURE.seed, 999)).toThrow(MovyDecryptError);
  });

  test("decrypt is deterministic for the pinned seed vector", () => {
    // Rotation canary: the same (ciphertext, seed, mediaId) must always decode
    // to the same bytes — a drifting keystream fails here in CI, not in mpv.
    // Wire protocol: `.docs/provider-dossiers/movy.md` ("STREAMCRYPTO wire protocol").
    const first = decryptMovyPayload(FIXTURE.body, FIXTURE.seed, FIXTURE.mediaId);
    expect(decryptMovyPayload(FIXTURE.body, FIXTURE.seed, FIXTURE.mediaId)).toBe(first);
    // The `mvm1` magic prefix is stripped: the plaintext is bare JSON.
    expect(first.startsWith("{")).toBe(true);
  });
});

afterEach(() => {
  // The seed cache is module state — a cached seed from one resolve would
  // shadow the next test's seeded response.
  clearMovySeedCacheForTest();
});

describe("resolveMovyDirect", () => {
  test.each(["refused", "cancelled"])(
    "a %s selected CDN never reports provider success",
    async (outcome) => {
      const controller = new AbortController();
      const ctx = {
        ...contextReturning((url, init) => {
          if (url.includes("/seed"))
            return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: 30000 }));
          if (url.includes("/denver/sources")) return new Response(FIXTURE.body);
          if (outcome === "cancelled" && init?.redirect === "manual") controller.abort();
          return new Response("fixture refusal", { status: 403 });
        }),
        signal: controller.signal,
      };
      const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
      expect(result.status).toBe("exhausted");
      if (outcome === "cancelled")
        expect(result.failures.some((failure) => failure.code === "cancelled")).toBe(true);
      expect(result.trace.events?.some((event) => event.type === "provider:success")).toBe(false);
    },
  );

  test("rejects non-movie/series titles", async () => {
    const result = await movyProviderModule.resolve(
      { ...MOVIE_INPUT, mediaKind: "anime" },
      TEST_CONTEXT,
    );
    expect(result.status).toBe("exhausted");
    expect(result.failures?.[0]?.code).toBe("unsupported-title");
  });

  test("rejects titles without a TMDB id", async () => {
    const result = await movyProviderModule.resolve(
      {
        ...MOVIE_INPUT,
        title: { id: "anilist:1", kind: "movie", title: "X" },
      },
      TEST_CONTEXT,
    );
    expect(result.status).toBe("exhausted");
  });

  test("resolves a live lane into streams and keeps all lanes in the source inventory", async () => {
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: 30000 }), { status: 200 });
      }
      if (url.includes("/denver/sources")) {
        return new Response(FIXTURE.body, { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Error", message: "lane down" }), {
        status: 500,
      });
    });

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("resolved");
    expect(result.streams.length).toBeGreaterThan(0);
    // Every lane stays visible for server switching in the tracks panel.
    expect(result.sources?.length).toBe(MOVY_LANES.length);
    expect(
      result.sources?.some((s) => s.id === "source:movy:denver" && s.status === "selected"),
    ).toBe(true);
  });

  test("consults endpoint health and skips a quarantined lane without fetching it", async () => {
    const seen: string[] = [];
    const requestedLanes: string[] = [];
    const endpointHealth: EndpointHealthPort = {
      shouldTry: (_providerId, endpoint) => {
        seen.push(endpoint);
        return endpoint !== "denver";
      },
      recordSuccess: () => {},
      recordFailure: () => {},
    };
    const ctx = {
      ...contextReturning((url) => {
        const lane = url.match(/\/(\w+)\/sources/)?.[1];
        if (lane) requestedLanes.push(lane);
        if (url.includes("/seed")) {
          return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: 30000 }), {
            status: 200,
          });
        }
        if (url.includes("/atlanta/sources")) {
          return new Response(FIXTURE.body, { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Error", message: "lane down" }), {
          status: 500,
        });
      }),
      endpointHealth,
    };

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("resolved");
    // Health was consulted for denver, but the quarantined lane was never
    // asked over HTTP — the cycle skipped it before any sources fetch.
    expect(seen).toContain("denver");
    expect(requestedLanes).not.toContain("denver");
  });

  test("reports quarantine honestly when every lane is skipped", async () => {
    // `stopReason: "all-quarantined"` yields zero attempts — the failure must
    // name the quarantine, not claim the lanes were tried and exhausted.
    let fetches = 0;
    const endpointHealth: EndpointHealthPort = {
      shouldTry: () => false,
      recordSuccess: () => {},
      recordFailure: () => {},
    };
    const ctx = {
      ...contextReturning(() => {
        fetches += 1;
        return new Response("{}", { status: 500 });
      }),
      endpointHealth,
    };

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("exhausted");
    expect(fetches).toBe(0);
    expect(result.failures?.[0]?.code).toBe("provider-unavailable");
    expect(result.failures?.[0]?.message).toContain("quarantined");
  });

  test("exhausts when every lane fails", async () => {
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: 30000 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Error", message: "down" }), { status: 500 });
    });

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("exhausted");
    expect(result.failures?.length).toBeGreaterThan(0);
    // A lane 500 is upstream evidence, not a parse bug: network-error and
    // retryable, so provider health and the offline gate read it correctly.
    expect(result.failures?.every((f) => f.code === "network-error" && f.retryable === true)).toBe(
      true,
    );
  });

  test("a decrypt failure classifies as parse-failed and non-retryable, not a network error", async () => {
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        return new Response(JSON.stringify({ seed: "0.bogus-seed", ttlMs: 30000 }), {
          status: 200,
        });
      }
      // Validly-encrypted-looking body under the wrong seed → mvm1 check fails.
      return new Response(FIXTURE.body, { status: 200 });
    });

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("exhausted");
    expect(result.failures?.every((f) => f.code === "parse-failed" && f.retryable === false)).toBe(
      true,
    );
  });

  test("a pinned preferredSourceId wins the cycle", async () => {
    const calls: string[] = [];
    const ctx = contextReturning((url) => {
      calls.push(url);
      if (url.includes("/seed")) {
        return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: 30000 }), { status: 200 });
      }
      return new Response(FIXTURE.body, { status: 200 });
    });

    const result = await movyProviderModule.resolve(
      { ...MOVIE_INPUT, preferredSourceId: "source:movy:austin" },
      ctx,
    );
    expect(result.status).toBe("resolved");
    // Austin answered first — the cycle never needed other lanes.
    expect(calls.some((u) => u.includes("/austin/sources"))).toBe(true);
  });
});

describe("buildMovyCycleCandidates", () => {
  test("produces one candidate per lane in lane order", () => {
    const candidates = buildMovyCycleCandidates(MOVY_LANES);
    expect(candidates.length).toBe(MOVY_LANES.length);
    expect(candidates[0]?.serverId).toBe("denver");
  });

  test("preferred source outranks lane order", () => {
    const candidates = buildMovyCycleCandidates(MOVY_LANES, "source:movy:paris");
    const paris = candidates.find((c) => c.serverId === "paris");
    expect(paris).toBeDefined();
    expect(Math.min(...candidates.map((c) => c.priority ?? 0))).toBe(paris?.priority ?? -1);
  });
});

describe("movy seed cache — untrusted envelope", () => {
  test("a non-string seed fails closed and is never cached", async () => {
    let seedCalls = 0;
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        seedCalls += 1;
        return new Response(JSON.stringify({ seed: 12345, ttlMs: 30000 }), { status: 200 });
      }
      return new Response(FIXTURE.body, { status: 200 });
    });

    const r1 = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(r1.status).toBe("exhausted");
    const r2 = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(r2.status).toBe("exhausted");
    // A poisoned seed must not be cached — every lane refetches rather than
    // reusing a stored non-string.
    expect(seedCalls).toBeGreaterThan(2);
  });

  test("a null body fails closed instead of throwing a TypeError", async () => {
    const ctx = contextReturning((url) =>
      url.includes("/seed")
        ? new Response("null", { status: 200 })
        : new Response(FIXTURE.body, { status: 200 }),
    );
    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("exhausted");
    expect(result.failures?.some((f) => f.code === "parse-failed")).toBe(true);
  });

  test("a string ttlMs degrades to the default TTL rather than corrupting expiry", async () => {
    let seedCalls = 0;
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        seedCalls += 1;
        return new Response(JSON.stringify({ seed: FIXTURE.seed, ttlMs: "30000" }), {
          status: 200,
        });
      }
      if (url.includes("/denver/sources")) return new Response(FIXTURE.body, { status: 200 });
      return new Response("{}", { status: 500 });
    });

    const r1 = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(r1.status).toBe("resolved");
    const r2 = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(r2.status).toBe("resolved");
    // The entry is cached on sane arithmetic — no second seed fetch.
    expect(seedCalls).toBe(1);
  });

  test("a seed that cannot decrypt a lane is dropped, refetched, and retried once", async () => {
    let seedCalls = 0;
    const ctx = contextReturning((url) => {
      if (url.includes("/seed")) {
        seedCalls += 1;
        // First draw is a well-formed seed that does not fit the ciphertext;
        // the retry draw serves the good one — the site's own 401 recovery.
        const seed = seedCalls === 1 ? "0.wrongseed" : FIXTURE.seed;
        return new Response(JSON.stringify({ seed, ttlMs: 30000 }), { status: 200 });
      }
      if (url.includes("/denver/sources")) return new Response(FIXTURE.body, { status: 200 });
      return new Response("{}", { status: 500 });
    });

    const result = await movyProviderModule.resolve(MOVIE_INPUT, ctx);
    expect(result.status).toBe("resolved");
    expect(seedCalls).toBe(2);
  });
});
