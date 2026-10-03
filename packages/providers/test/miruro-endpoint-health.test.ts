import { afterEach, describe, expect, test } from "bun:test";

import type { EndpointHealthFailureInfo, ProviderRuntimeContext } from "@kunai/types";

import { clearMiruroCachesForTest, miruroProviderModule } from "../src/miruro/direct";
import { __testing as mirrorsTesting } from "../src/miruro/mirrors";

/**
 * Drives the real Miruro cycle against a stubbed catalog API, so what is pinned
 * is the behaviour a user sees — whether a known-dead backend is asked again —
 * rather than which function got called.
 */

const CATALOG_KEY = "miruro/catalog";
const CATALOG_ID = "q9k1BcVSC-_RZOwRbIy6xvndxAXIt3Tb";
const DEAD_HLS = "https://hls.anidb.app/stream/dead/master.m3u8";
const GOOD_MP4 = "https://www.animegg.org/play/1/video.mp4";

/** `application/octet-stream`: gzip, then XOR every byte with the catalog key. */
async function encodeCatalog(value: Parameters<typeof JSON.stringify>[0]): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const gzipped = new Uint8Array(
    await new Response(
      new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const key = new TextEncoder().encode(CATALOG_KEY);
  for (let index = 0; index < gzipped.length; index += 1) {
    gzipped[index] = gzipped[index]! ^ key[index % key.length]!;
  }
  return gzipped;
}

const catalog = async (value: Parameters<typeof JSON.stringify>[0]) =>
  new Response(await encodeCatalog(value), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });

type Recorded = { endpoint: string; info: EndpointHealthFailureInfo };

/**
 * The play matrix the catalog answers for episode 1: `animepahe` carries the
 * rate-limited HLS backend, `icarus` the playable MP4. Server names are the
 * catalog's own strings; the endpoint-health keys follow them.
 */
function playBody(options: { readonly animepaheStreams?: boolean }) {
  return {
    episode_number: 1,
    tracks: [
      {
        track: "sub",
        providers: [
          {
            provider: "animepahe",
            servers: [
              {
                server: "animepahe",
                streams:
                  options.animepaheStreams === false ? [] : [{ url: DEAD_HLS, format: "hls" }],
              },
            ],
          },
          {
            provider: "icarus",
            servers: [
              {
                server: "icarus-1-1",
                streams: [{ url: GOOD_MP4, format: "mp4", quality: "720p" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function harness(options: {
  readonly quarantined?: readonly string[];
  readonly animepaheStatus?: number | "network-error";
  readonly animepaheStreams?: boolean;
}) {
  const requests: string[] = [];
  const failures: Recorded[] = [];
  const successes: string[] = [];
  // SAFETY: deliberately partial context stub — the provider reads only
  // providerId/now/endpointHealth/fetch here.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the stub's narrower endpoint-health lane forces the unknown hop
  const context = {
    providerId: "miruro",
    now: () => "2026-09-12T00:00:00.000Z",
    endpointHealth: {
      shouldTry: (_providerId: string, endpoint: string) =>
        !(options.quarantined ?? []).includes(endpoint),
      recordFailure: (_providerId: string, endpoint: string, info: EndpointHealthFailureInfo) =>
        void failures.push({ endpoint, info }),
      recordSuccess: (_providerId: string, endpoint: string) => void successes.push(endpoint),
    },
    fetch: {
      runtime: "direct-http" as const,
      async fetch(input: string | URL | Request) {
        const url = new URL(String(input));
        requests.push(`${url.host}${url.pathname}`);
        if (url.pathname === "/api/v1/anime") {
          return catalog({
            data: [
              {
                id: CATALOG_ID,
                external_ids: { anilist: ["154587"] },
                title: { english: "Frieren: Beyond Journey's End" },
              },
            ],
          });
        }
        if (url.pathname === `/api/v1/anime/${CATALOG_ID}/episodes`) {
          return catalog({ data: [{ episode_number: 1 }] });
        }
        if (url.pathname === `/api/v1/anime/${CATALOG_ID}/episodes/1/play`) {
          return catalog(playBody({ animepaheStreams: options.animepaheStreams }));
        }
        if (url.host === "hls.anidb.app") {
          if (options.animepaheStatus === "network-error") throw new TypeError("fetch failed");
          return new Response("", { status: options.animepaheStatus ?? 429 });
        }
        if (url.host === "www.animegg.org") return new Response("", { status: 206 });
        // Mirror discovery and anything else: absent, never a crash.
        return new Response("not found", { status: 404 });
      },
    },
  } as unknown as ProviderRuntimeContext;
  return { context, requests, failures, successes };
}

const INPUT = {
  title: { id: "anilist:154587", anilistId: "154587", kind: "anime", title: "Frieren" },
  episode: { season: 1, episode: 1 },
  mediaKind: "anime",
  intent: "play",
  startupPriority: "balanced",
  preferredAudioLanguage: "original",
  allowedRuntimes: ["direct-http"],
} as const;

describe("miruro endpoint health", () => {
  afterEach(() => {
    clearMiruroCachesForTest();
    mirrorsTesting.reset();
  });

  test("a rate-limited backend is recorded against its server, and the next one plays", async () => {
    const { context, failures } = harness({ animepaheStatus: 429 });

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.url).toBe(GOOD_MP4);
    expect(failures).toEqual([
      {
        endpoint: "animepahe",
        info: { class: "server-error", titleId: "anilist:154587", at: "2026-09-12T00:00:00.000Z" },
      },
    ]);
  });

  test("a quarantined backend is not asked at all — the point of recording it", async () => {
    // Before this, every episode paid the dead server's probe again: the
    // release signoff's anime lane took 13s against 2s for the others.
    const { context, requests } = harness({ quarantined: ["animepahe"] });

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.url).toBe(GOOD_MP4);
    expect(requests.some((request) => request.startsWith("hls.anidb.app"))).toBe(false);
  });

  test("a probe that could not reach the backend is no evidence against it", async () => {
    // Offline must not read as a dead server: that is how a healthy pool
    // got quarantined for an hour before.
    const { context, failures } = harness({ animepaheStatus: "network-error" });

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await miruroProviderModule.resolve(INPUT as never, context);

    expect(failures.filter((failure) => failure.endpoint === "animepahe")).toEqual([]);
  });

  test("an episode a server simply lacks is no evidence against the server", async () => {
    const { context, failures } = harness({ animepaheStreams: false });

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(failures.filter((failure) => failure.endpoint === "animepahe")).toEqual([]);
  });

  test("a server that plays clears its record", async () => {
    const { context, successes } = harness({ quarantined: ["animepahe"] });

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await miruroProviderModule.resolve(INPUT as never, context);

    expect(successes).toContain("icarus-1-1");
  });
});
