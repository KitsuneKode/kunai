import { describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { animeparadiseProviderModule } from "../src/animeparadise/direct";

const SITE = "https://www.animeparadise.moe";
const API = "https://api.animeparadise.moe";
const MEDIA = "https://stream.animeparadise.moe";

// Sanitized shapes only: ids, uids, chunk names and locators are synthetic —
// nothing upstream-issued is copied into the repo.
const NATIVE_ID = "TESTanimeId0001";
const SLUG = "test-show";
const EPISODE_UID = "abcd1234-56ef-4789-abcd-ef0123456789";
const EPISODE_UID_2 = "abcd1234-56ef-4789-abcd-ef0123456780";
const ACTION_ID = "0123456789abcdef0123456789abcdef0123456789";
const STREAM_LOCATOR = "TESTstreamLinkLocator0001";
const STREAM_URL = `${MEDIA}/m3u8?url=${STREAM_LOCATOR}`;

const INPUT: ProviderResolveInput = {
  title: {
    id: "anilist:154587",
    kind: "anime",
    title: "Frieren: Beyond Journey's End",
    year: 2023,
    anilistId: "154587",
    aliases: ["Sousou no Frieren"],
  },
  episode: { season: 1, episode: 1 },
  mediaKind: "anime",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const SEARCH = {
  success: true,
  error: null,
  data: [
    {
      // Sequel first in the catalog: year and the detail mapping must win,
      // not document order.
      _id: "TESTanimeId0002",
      title: "Sousou no Frieren 2nd Season",
      link: "sousou-no-frieren-season-2",
      episodeCount: 10,
      animeSeason: { season: "Winter", year: 2026 },
      alternativeTitle: { english: "Frieren: Beyond Journey's End Season 2" },
    },
    {
      _id: NATIVE_ID,
      title: "Sousou no Frieren",
      link: SLUG,
      episodeCount: 28,
      animeSeason: { season: "Fall", year: 2023 },
      alternativeTitle: { english: "Frieren: Beyond Journey's End" },
    },
  ],
};

const DETAIL = {
  success: true,
  error: null,
  data: { _id: NATIVE_ID, mappings: { anilist: 154587, myanimelist: 52991 } },
};

const EPISODES = {
  success: true,
  error: null,
  data: [
    { uid: EPISODE_UID, number: "1", title: "The Journey's End" },
    { uid: EPISODE_UID_2, number: "2", title: "It Didn't Have to Be Magic..." },
  ],
};

const WATCH_HTML = `<html><script>
self.__next_f.push([1,"7:I[71147,[\\"/_next/static/chunks/test-chunk-a.js\\",\\"/_next/static/chunks/test-chunk-b.js\\"],\\"WatchProvider\\"]"])
</script></html>`;

const CHUNK_A = `"use strict"; e.s(["Nothing",0,function(e){return null}]);`;
const CHUNK_B = `"use strict"; var a=e.i(7531);
let l=(0,a.createServerReference)("${ACTION_ID}",a.callServer,void 0,a.findSourceMapURL,"getEpisode");
e.s(["WatchProvider",0,function(e){return l}]);`;

function flightBody(uid: string, origin: string): string {
  return [
    `2:"$Sreact.fragment"`,
    `7:${JSON.stringify({
      episode: {
        uid,
        origin,
        streamLink: STREAM_LOCATOR,
        subData: [
          { src: "TESTassEnglish", label: "English", type: "ass" },
          { src: `${MEDIA}/captions?url=TESTvttEn`, label: "English", type: "vtt" },
          { src: "https://thumbnails.invalid/track.jpg", label: "thumbs", type: "thumbnails" },
        ],
      },
    })}`,
  ].join("\n");
}

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1800112,RESOLUTION=1920x1080
/m3u8?url=TESTvariantLocator
`;

const MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-TARGETDURATION:11
#EXTINF:4.56,
/ts?url=TESTsegment
`;

const SEGMENT_BYTES = new Uint8Array(2048);

type Captured = { url: string; init?: RequestInit };

function contextReturning(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined,
  captured?: Captured[],
  probeFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): ProviderRuntimeContext {
  return {
    providerId: "animeparadise",
    now: () => "2026-11-27T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : url.toString();
        captured?.push({ url: href, init });
        return handler(href, init) ?? new Response("fixture miss", { status: 404 });
      },
      ...(probeFetch ? { probeFetch } : null),
    },
  };
}

function healthyHandler(url: string, init?: RequestInit): Response | undefined {
  if (init?.method === "POST" && url.startsWith(`${SITE}/watch/`)) {
    const uid = /\/watch\/([^?]+)/.exec(url)?.[1];
    return new Response(flightBody(uid ?? "", NATIVE_ID));
  }
  if (url.startsWith(`${API}/search`)) return Response.json(SEARCH);
  if (url === `${API}/anime/${SLUG}`) return Response.json(DETAIL);
  if (url === `${API}/anime/${NATIVE_ID}/episode`) return Response.json(EPISODES);
  if (url.startsWith(`${SITE}/watch/`)) return new Response(WATCH_HTML);
  if (url === `${SITE}/_next/static/chunks/test-chunk-a.js`) return new Response(CHUNK_A);
  if (url === `${SITE}/_next/static/chunks/test-chunk-b.js`) return new Response(CHUNK_B);
  if (url === STREAM_URL) {
    return new Response(MASTER, {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }
  if (url === `${MEDIA}/m3u8?url=TESTvariantLocator`) {
    return new Response(MEDIA_PLAYLIST, {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
  }
  if (url === `${MEDIA}/ts?url=TESTsegment`) {
    return new Response(SEGMENT_BYTES, {
      status: 206,
      headers: { "content-type": "video/mp2t", "content-range": "bytes 0-2047/2048" },
    });
  }
  return undefined;
}

describe("AnimeParadise direct resolver", () => {
  test("verifies catalog identity, replays the Flight action, and ships the verified stream", async () => {
    const captured: Captured[] = [];
    const result = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning(healthyHandler, captured),
    );

    expect(result.status).toBe("resolved");
    expect(result.streamReachabilityVerified).toBe(true);
    // Canonical identity: the year-2023 row won over the first-listed sequel,
    // and the detail fetch hit its slug — never the sequel's.
    expect(captured.some(({ url }) => url === `${API}/anime/${SLUG}`)).toBe(true);
    expect(captured.some(({ url }) => url.includes("season-2"))).toBe(false);

    // The Flight POST replayed the bundle's own action id and [uid, origin] args.
    const action = captured.find(({ init }) => init?.method === "POST");
    expect(action).toBeDefined();
    expect(new Headers(action?.init?.headers).get("Next-Action")).toBe(ACTION_ID);
    expect(action?.init?.body).toBe(JSON.stringify([EPISODE_UID, NATIVE_ID]));

    // One verified 1080p stream, sub presentation, playback Referer attached.
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]?.qualityLabel).toBe("1080p");
    expect(result.streams[0]?.presentation).toBe("sub");
    expect(result.streams[0]?.headers?.Referer).toBe(`${SITE}/`);
    expect(
      captured
        .filter(({ url }) => new URL(url).origin === MEDIA)
        .every(({ init }) => new Headers(init?.headers).get("referer") === `${SITE}/`),
    ).toBe(true);

    // ASS sidecar and VTT caption both mapped; the thumbnails row is dropped.
    expect(result.subtitles.map((subtitle) => [subtitle.url, subtitle.format])).toEqual(
      expect.arrayContaining([
        [`${API}/stream/file/TESTassEnglish`, "ass"],
        [`${MEDIA}/captions?url=TESTvttEn`, "vtt"],
      ]),
    );
    expect(result.subtitles).toHaveLength(2);
  });

  test("a wrong catalog mapping refuses before the episode catalog is read", async () => {
    const wrong = { ...DETAIL, data: { ...DETAIL.data, mappings: { anilist: 999999 } } };
    const captured: Captured[] = [];
    const result = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning(
        (url, init) =>
          url === `${API}/anime/${SLUG}` ? Response.json(wrong) : healthyHandler(url, init),
        captured,
      ),
    );

    expect(result.status).not.toBe("resolved");
    expect(captured.some(({ url }) => url === `${API}/anime/${SLUG}`)).toBe(true);
    expect(captured.some(({ url }) => url.endsWith("/episode"))).toBe(false);
    expect(captured.some(({ url }) => url.startsWith(`${SITE}/watch/`))).toBe(false);
  });

  test("season-relative UI episode wins over absolute numbering", async () => {
    const captured: Captured[] = [];
    await animeparadiseProviderModule.resolve(
      { ...INPUT, episode: { season: 1, episode: 2, absoluteEpisode: 9 } },
      contextReturning(healthyHandler, captured),
    );

    const action = captured.find(({ init }) => init?.method === "POST");
    expect(action?.init?.body).toBe(JSON.stringify([EPISODE_UID_2, NATIVE_ID]));
  });

  test("a missing or rotated action id yields no stream", async () => {
    const noModule = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning((url) =>
        url.startsWith(`${SITE}/watch/`)
          ? new Response("<html>no rsc</html>")
          : healthyHandler(url),
      ),
    );
    expect(noModule.status).not.toBe("resolved");

    const noAction = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning((url) =>
        url === `${SITE}/_next/static/chunks/test-chunk-b.js`
          ? new Response(CHUNK_A)
          : healthyHandler(url),
      ),
    );
    expect(noAction.status).not.toBe("resolved");
  });

  test("an explicit dub request stops before any upstream call", async () => {
    const captured: Captured[] = [];
    const result = await animeparadiseProviderModule.resolve(
      { ...INPUT, preferredAudioLanguage: "dub" },
      contextReturning(healthyHandler, captured),
    );

    expect(result.status).not.toBe("resolved");
    expect(captured).toHaveLength(0);
  });

  test("a wrong uid or malformed Flight body yields no stream", async () => {
    const wrongUid = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning((url, init) =>
        init?.method === "POST"
          ? new Response(flightBody("ffffffff-ffff-ffff-ffff-ffffffffffff", NATIVE_ID))
          : healthyHandler(url),
      ),
    );
    expect(wrongUid.status).not.toBe("resolved");

    const malformed = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning((url, init) =>
        init?.method === "POST" ? new Response("7:not-json\n8:[]") : healthyHandler(url),
      ),
    );
    expect(malformed.status).not.toBe("resolved");
  });

  test("a failed media probe fails the strict gate and ships no streams", async () => {
    const result = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning((url) =>
        url === `${MEDIA}/ts?url=TESTsegment`
          ? new Response("gone", { status: 500 })
          : healthyHandler(url),
      ),
    );

    expect(result.status).not.toBe("resolved");
    expect(result.streams).toEqual([]);
  });

  test("an inconclusive probe cannot stand in as verified under the strict gate", async () => {
    const abortingProbe = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    };
    const result = await animeparadiseProviderModule.resolve(
      INPUT,
      contextReturning(healthyHandler, undefined, abortingProbe),
    );

    expect(result.status).not.toBe("resolved");
    expect(result.streams).toEqual([]);
  });
});
