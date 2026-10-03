import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing,
  MIRURO_KNOWN_BASE_URLS,
  miruroBaseUrls,
  orderMiruroBaseUrls,
  parseMiruroStatusMirrors,
  recordMiruroMirrorSuccess,
} from "../src/miruro/mirrors";

/** Trimmed from the live status page on 2026-09-11. */
const STATUS_PAGE = {
  config: { slug: "miruro", title: "Miruro Status" },
  publicGroupList: [
    {
      name: "mirrors",
      monitorList: [
        { id: 4, name: "miruro.to" },
        { id: 3, name: "miruro.tv" },
        { id: 5, name: "miruro.bz" },
        { id: 6, name: "miruro.ru" },
        { id: 2, name: "miruro.com" },
      ],
    },
    {
      name: "other",
      monitorList: [
        { id: 8, name: "streaming server" },
        { id: 7, name: "video player" },
      ],
    },
  ],
};

const HEARTBEAT = {
  heartbeatList: {
    "2": [{ status: 1, time: "2026-09-11 08:06:56" }],
    "3": [{ status: 1, time: "2026-09-11 08:07:21" }],
    "4": [{ status: 0, time: "2026-09-11 08:06:53" }],
    "5": [{ status: 1, time: "2026-09-11 08:07:20" }],
    "6": [{ status: 1, time: "2026-09-11 08:07:06" }],
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

afterEach(() => {
  __testing.reset();
});

describe("parseMiruroStatusMirrors", () => {
  test("reads the mirrors group and its latest heartbeat", () => {
    expect(parseMiruroStatusMirrors(STATUS_PAGE, HEARTBEAT)).toEqual([
      { name: "miruro.to", up: false },
      { name: "miruro.tv", up: true },
      { name: "miruro.bz", up: true },
      { name: "miruro.ru", up: true },
    ]);
  });

  test("drops miruro.com, which the status page lists but which serves no pipe", () => {
    const names = parseMiruroStatusMirrors(STATUS_PAGE, HEARTBEAT).map((m) => m.name);
    expect(names).not.toContain("miruro.com");
  });

  test("ignores groups other than mirrors", () => {
    const names = parseMiruroStatusMirrors(STATUS_PAGE, HEARTBEAT).map((m) => m.name);
    expect(names).not.toContain("streaming server");
  });

  test("refuses a name that is not one of Miruro's own hosts", () => {
    // The status page is a remote document; a name it supplies must never turn
    // into a host Kunai sends pipe requests to.
    const hostile = {
      publicGroupList: [
        {
          name: "mirrors",
          monitorList: [
            { id: 1, name: "evil.example.com" },
            { id: 2, name: "miruro.bz.attacker.test" },
            { id: 3, name: "miruro.zz" },
          ],
        },
      ],
    };
    expect(parseMiruroStatusMirrors(hostile, {}).map((m) => m.name)).toEqual(["miruro.zz"]);
  });

  test("a monitor with no heartbeat is unknown rather than down", () => {
    expect(parseMiruroStatusMirrors(STATUS_PAGE, {})[0]).toEqual({ name: "miruro.to", up: null });
  });

  test("malformed documents yield no mirrors instead of throwing", () => {
    for (const bad of [null, undefined, 42, "x", {}, { publicGroupList: "no" }]) {
      expect(parseMiruroStatusMirrors(bad, bad)).toEqual([]);
    }
  });
});

describe("orderMiruroBaseUrls", () => {
  const known = ["https://www.miruro.bz", "https://www.miruro.ru"];

  test("keeps the known order when nothing is discovered", () => {
    expect(orderMiruroBaseUrls({ known, discovered: [] })).toEqual(known);
  });

  test("appends a mirror Kunai did not ship with", () => {
    expect(orderMiruroBaseUrls({ known, discovered: [{ name: "miruro.xyz", up: true }] })).toEqual([
      ...known,
      "https://www.miruro.xyz",
    ]);
  });

  test("moves a mirror the status page calls down to the back, never dropping it", () => {
    // The status page's vantage point is not the user's: a mirror it cannot
    // reach may be the only one the user can.
    expect(orderMiruroBaseUrls({ known, discovered: [{ name: "miruro.bz", up: false }] })).toEqual([
      "https://www.miruro.ru",
      "https://www.miruro.bz",
    ]);
  });

  test("the mirror that last answered leads", () => {
    expect(
      orderMiruroBaseUrls({ known, discovered: [], lastSuccess: "https://www.miruro.ru" }),
    ).toEqual(["https://www.miruro.ru", "https://www.miruro.bz"]);
  });

  test("a last success that is no longer a mirror is ignored", () => {
    expect(
      orderMiruroBaseUrls({ known, discovered: [], lastSuccess: "https://www.gone.test" }),
    ).toEqual(known);
  });

  test("never repeats a mirror", () => {
    const ordered = orderMiruroBaseUrls({
      known,
      discovered: [{ name: "miruro.bz", up: true }],
      lastSuccess: "https://www.miruro.bz",
    });
    expect(ordered).toEqual([...new Set(ordered)]);
    expect(ordered).toHaveLength(2);
  });
});

describe("miruroBaseUrls", () => {
  test("a cold start returns the shipped mirrors without waiting on the network", () => {
    let called = false;
    const urls = miruroBaseUrls({
      fetchImpl: async () => {
        called = true;
        return json(STATUS_PAGE);
      },
    });

    // The refresh is kicked off, but the caller is never blocked on it.
    expect(urls).toEqual([...MIRURO_KNOWN_BASE_URLS]);
    expect(called).toBe(true);
  });

  test("a later call uses what the status page reported", async () => {
    const fetchImpl = async (url: string) =>
      json(url.includes("heartbeat") ? HEARTBEAT : STATUS_PAGE);

    miruroBaseUrls({ fetchImpl, now: 1_000 });
    await __testing.settle();

    // miruro.to is reported down, so it drops behind the rest.
    expect(miruroBaseUrls({ fetchImpl, now: 2_000 })).toEqual([
      "https://www.miruro.bz",
      "https://www.miruro.ru",
      "https://www.miruro.tv",
      "https://www.miruro.to",
    ]);
  });

  test("a status page that fails leaves the shipped mirrors in place", async () => {
    miruroBaseUrls({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      now: 1_000,
    });
    await __testing.settle();

    expect(miruroBaseUrls({ now: 2_000 })).toEqual([...MIRURO_KNOWN_BASE_URLS]);
  });

  test("a failed refresh is not retried until the cache expires", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error("offline");
    };

    miruroBaseUrls({ fetchImpl, now: 1_000 });
    await __testing.settle();
    const afterFirst = calls;

    miruroBaseUrls({ fetchImpl, now: 2_000 });
    await __testing.settle();
    expect(calls).toBe(afterFirst);

    // Past the TTL it tries again.
    miruroBaseUrls({ fetchImpl, now: 1_000 + 31 * 60_000 });
    await __testing.settle();
    expect(calls).toBeGreaterThan(afterFirst);
  });

  test("a mirror that answered leads the next call", async () => {
    const fetchImpl = async (url: string) =>
      json(url.includes("heartbeat") ? HEARTBEAT : STATUS_PAGE);
    miruroBaseUrls({ fetchImpl, now: 1_000 });
    await __testing.settle();

    recordMiruroMirrorSuccess("https://www.miruro.tv");

    expect(miruroBaseUrls({ fetchImpl, now: 2_000 })[0]).toBe("https://www.miruro.tv");
  });
});
