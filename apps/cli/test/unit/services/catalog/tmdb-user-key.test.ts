import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  classifyTmdbCredential,
  clearTmdbSessionCache,
  fetchTmdbJsonWithFallback,
  isPlausibleTmdbCredential,
  resolveTmdbApiKey,
  setTmdbUserKeySource,
  tmdbCredentialStatus,
  TMDB_ALT_BASE,
  TMDB_DIRECT_BASE,
} from "@/services/catalog/tmdb-proxy";

const originalFetch = globalThis.fetch;
const V3_KEY = "0123456789abcdef0123456789abcdef";
/** An unsigned `alg: none` JWT built at runtime from plain JSON: a shape, never a credential. */
function syntheticJwt(): string {
  const part = (json: string) => btoa(json).replaceAll("=", "");
  return [part('{"alg":"none"}'), part('{"test":1}'), "test"].join(".");
}

const V4_TOKEN = syntheticJwt();

interface SeenRequest {
  readonly url: string;
  readonly authorization: string | null;
}

function serve(respond: (url: string) => Response): SeenRequest[] {
  const seen: SeenRequest[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return respond(url);
    },
    { preconnect: originalFetch.preconnect },
  );
  return seen;
}

const isDirect = (url: string) => url.startsWith(TMDB_DIRECT_BASE) || url.startsWith(TMDB_ALT_BASE);

let originalEnvKey: string | undefined;

beforeEach(() => {
  // A developer's own KUNAI_TMDB_API_KEY would override every settings fixture.
  originalEnvKey = process.env.KUNAI_TMDB_API_KEY;
  delete process.env.KUNAI_TMDB_API_KEY;
});

afterEach(() => {
  if (originalEnvKey === undefined) delete process.env.KUNAI_TMDB_API_KEY;
  else process.env.KUNAI_TMDB_API_KEY = originalEnvKey;
  globalThis.fetch = originalFetch;
  setTmdbUserKeySource(null);
  clearTmdbSessionCache();
});

describe("the user's own TMDB key", () => {
  test("v3 keys and v4 read tokens are told apart; junk is not a credential", () => {
    expect(classifyTmdbCredential(V3_KEY)).toBe("api-key");
    expect(classifyTmdbCredential(V4_TOKEN)).toBe("bearer");
    expect(isPlausibleTmdbCredential(V3_KEY)).toBe(true);
    expect(isPlausibleTmdbCredential(` ${V4_TOKEN} `)).toBe(true);
    expect(isPlausibleTmdbCredential("hello")).toBe(false);
  });

  test("the setting is used when no env override is set, and env wins over it", () => {
    setTmdbUserKeySource(() => V3_KEY);
    expect(resolveTmdbApiKey({})).toMatchObject({ source: "user", origin: "settings" });
    expect(resolveTmdbApiKey({ KUNAI_TMDB_API_KEY: "envkey" })).toMatchObject({
      key: "envkey",
      origin: "env",
    });
  });

  test("with a user key, TMDB itself is asked first and the v3 key rides in the query", async () => {
    setTmdbUserKeySource(() => V3_KEY);
    const seen = serve(() => Response.json({ ok: true }));
    await fetchTmdbJsonWithFallback("/movie/550");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.startsWith(`${TMDB_DIRECT_BASE}/movie/550?api_key=`)).toBe(true);
  });

  test("a v4 read token is sent as a Bearer header, never in the URL", async () => {
    setTmdbUserKeySource(() => V4_TOKEN);
    const seen = serve(() => Response.json({ ok: true }));
    await fetchTmdbJsonWithFallback("/movie/550");
    expect(seen[0]?.url).toBe(`${TMDB_DIRECT_BASE}/movie/550`);
    expect(seen[0]?.authorization).toBe(`Bearer ${V4_TOKEN}`);
  });

  test("a key TMDB rejects falls back to the keyless mirrors and is set aside", async () => {
    setTmdbUserKeySource(() => V3_KEY);
    const seen = serve((url) =>
      isDirect(url) ? new Response("{}", { status: 401 }) : Response.json({ via: "mirror" }),
    );
    expect(await fetchTmdbJsonWithFallback("/movie/550")).toEqual({ via: "mirror" });
    // The refused user key is sent once; the other keyed host gets the shipped
    // key (refused here too), and then a keyless mirror answers.
    const keyed = seen.filter((request) => isDirect(request.url));
    expect(keyed.map((request) => request.url.includes(`api_key=${V3_KEY}`))).toEqual([
      true,
      false,
    ]);
    expect(tmdbCredentialStatus()).toMatchObject({
      userKeyRejected: true,
      active: { source: expect.not.stringMatching(/^user$/) },
    });

    // Fixing the key (a new value) is used straight away.
    setTmdbUserKeySource(() => "fedcba9876543210fedcba9876543210");
    expect(tmdbCredentialStatus().userKeyRejected).toBe(false);
    expect(resolveTmdbApiKey({}).source).toBe("user");
  });

  test("after a user key is refused, the other TMDB host is tried with the shipped key", async () => {
    setTmdbUserKeySource(() => V3_KEY);
    const seen = serve((url) => {
      if (!isDirect(url)) return new Response("down", { status: 503 });
      return url.includes(`api_key=${V3_KEY}`)
        ? new Response("{}", { status: 401 })
        : Response.json({ via: "shipped key" });
    });
    // Mirrors are down too: only the shipped key on the second host can answer.
    expect(await fetchTmdbJsonWithFallback("/movie/550")).toEqual({ via: "shipped key" });
    const keyed = seen.filter((request) => isDirect(request.url));
    expect(keyed).toHaveLength(2);
    expect(keyed[1]?.url.includes(`api_key=${V3_KEY}`)).toBe(false);
  });

  test("without a user key, keyless mirrors stay first", async () => {
    const seen = serve(() => Response.json({ ok: true }));
    await fetchTmdbJsonWithFallback("/movie/550");
    expect(isDirect(seen[0]?.url ?? "")).toBe(false);
  });
});
