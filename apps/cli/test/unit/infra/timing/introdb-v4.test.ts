import { afterEach, expect, test } from "bun:test";

import { fetchPlaybackTimingMetadataDetailed as timing } from "@/introdb";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const tv = { tmdbId: "1396", type: "series" as const, season: 1, episode: 2 };
function reply(body: unknown, status = 200) {
  globalThis.fetch = (async () => Response.json(body, { status })) as typeof fetch;
}

test("v4 TV response keeps requested TMDB identity and all segment buckets", async () => {
  let requested = "";
  globalThis.fetch = (async (url) => {
    requested = String(url);
    return Response.json({
      tvdb_id: 81189,
      type: "tv",
      season: 1,
      episode: 2,
      intro: [{ start_ms: null, end_ms: 25000 }],
      recap: [{ start_ms: 25000, end_ms: 30000 }],
      credits: [{ start_ms: 1400000, end_ms: null }],
      preview: [{ start_ms: 1300000, end_ms: 1350000 }],
    });
  }) as typeof fetch;
  const result = await timing(tv);
  expect(requested).toBe("https://api.theintrodb.org/v4/media?tmdb_id=1396&season=1&episode=2");
  expect(result).toEqual({
    failureClass: null,
    metadata: {
      tmdbId: "1396",
      type: "series",
      intro: [{ startMs: null, endMs: 25000 }],
      recap: [{ startMs: 25000, endMs: 30000 }],
      credits: [{ startMs: 1400000, endMs: null }],
      preview: [{ startMs: 1300000, endMs: 1350000 }],
    },
  });
});

test("v4 movie omits TV coordinates and preserves movie identity", async () => {
  let requested = "";
  globalThis.fetch = (async (url) => {
    requested = String(url);
    return Response.json({ tvdb_id: 169, type: "movie", intro: [{ start_ms: 0, end_ms: 20000 }] });
  }) as typeof fetch;
  const result = await timing({ ...tv, tmdbId: "550", type: "movie" });
  expect(requested).toBe("https://api.theintrodb.org/v4/media?tmdb_id=550");
  expect(result.metadata).toMatchObject({
    tmdbId: "550",
    type: "movie",
    intro: [{ startMs: 0, endMs: 20000 }],
  });
});

for (const body of [
  null,
  [],
  {},
  { tvdb_id: 1, type: "tv", versions: [] },
  { tvdb_id: 1, type: "tv", episodes: [] },
  { tvdb_id: 0, type: "tv" },
  { tvdb_id: 1, type: "movie" },
  { tvdb_id: 1, type: "tv", season: 2, episode: 2 },
]) {
  test(`rejects malformed or non-timestamp TV response ${JSON.stringify(body)}`, async () => {
    reply(body);
    expect(await timing(tv)).toEqual({ metadata: null, failureClass: "http-error" });
  });
}

test("missing segment buckets are empty; invalid boundaries cannot become skip windows", async () => {
  reply({
    tvdb_id: 1,
    type: "tv",
    season: 1,
    episode: 2,
    intro: [
      null,
      {},
      { start_ms: -1, end_ms: 200 },
      { start_ms: 400, end_ms: 200 },
      { start_ms: "12garbage", end_ms: 25000 },
      { start_ms: 0, end_ms: 25000 },
    ],
  });
  expect((await timing(tv)).metadata).toMatchObject({
    intro: [{ startMs: 0, endMs: 25000 }],
    recap: [],
    credits: [],
    preview: [],
  });
});

test("v4 TV echo of season/episode is optional but never a different episode", async () => {
  reply({ tvdb_id: 1, type: "tv", intro: [{ start_ms: 1, end_ms: 2 }] });
  expect((await timing(tv)).metadata?.intro).toEqual([{ startMs: 1, endMs: 2 }]);
  reply({ tvdb_id: 1, type: "tv", season: null, episode: null, intro: [] });
  expect((await timing(tv)).failureClass).toBeNull();
  reply({ tvdb_id: 1, type: "tv", season: 1, episode: 3 });
  expect(await timing(tv)).toEqual({ metadata: null, failureClass: "http-error" });
});

test("end_ms 0 is the documented no-segment marker, not a skip window", async () => {
  reply({
    tvdb_id: 1,
    type: "movie",
    intro: [{ start_ms: null, end_ms: 0 }],
    credits: [
      { start_ms: 0, end_ms: 0 },
      { start_ms: 5000, end_ms: null },
    ],
  });
  expect((await timing({ ...tv, type: "movie" })).metadata).toMatchObject({
    intro: [],
    credits: [{ startMs: 5000, endMs: null }],
  });
});

test("cancellation while the body is read is cancelled, not a malformed response", async () => {
  const parent = new AbortController();
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => {
      parent.abort();
      return { tvdb_id: 1, type: "tv", season: 1, episode: 2 };
    },
  })) as unknown as typeof fetch;
  expect(await timing({ ...tv, signal: parent.signal, parentSignal: parent.signal })).toEqual({
    metadata: null,
    failureClass: "cancelled",
  });
});

test("series without both coordinates never silently requests a movie", async () => {
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({});
  }) as typeof fetch;
  expect(await timing({ ...tv, episode: undefined })).toEqual({
    metadata: null,
    failureClass: "identity-missing",
  });
  expect(fetched).toBe(false);
});

test("pre-cancelled request is cancelled before dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return Response.json({});
  }) as typeof fetch;
  expect(await timing({ ...tv, signal: controller.signal })).toEqual({
    metadata: null,
    failureClass: "cancelled",
  });
  expect(fetched).toBe(false);
});

test("parent cancellation remains cancelled with a custom abort reason", async () => {
  const parent = new AbortController();
  globalThis.fetch = (async () => {
    parent.abort(new Error("navigation changed"));
    throw parent.signal.reason;
  }) as typeof fetch;
  expect(await timing({ ...tv, signal: parent.signal, parentSignal: parent.signal })).toEqual({
    metadata: null,
    failureClass: "cancelled",
  });
});

for (const [status, failureClass] of [
  [404, "not-found"],
  [429, "http-error"],
  [503, "http-error"],
] as const) {
  test(`HTTP ${status} is ${failureClass}`, async () => {
    reply({}, status);
    expect((await timing(tv)).failureClass).toBe(failureClass);
  });
}
for (const [error, failureClass] of [
  [new DOMException("deadline", "TimeoutError"), "timeout"],
  [new TypeError("getaddrinfo ENOTFOUND api.theintrodb.org"), "offline"],
  [new SyntaxError("invalid JSON"), "http-error"],
] as const) {
  test(`${error.name} is ${failureClass}`, async () => {
    globalThis.fetch = (async () => {
      throw error;
    }) as typeof fetch;
    expect((await timing(tv)).failureClass).toBe(failureClass);
  });
}
