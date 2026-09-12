import { afterEach, describe, expect, test } from "bun:test";

import type { EndpointHealthFailureInfo, ProviderRuntimeContext } from "@kunai/types";

import { clearMiruroCachesForTest, miruroProviderModule } from "../src/miruro/direct";
import { __testing as mirrorsTesting } from "../src/miruro/mirrors";

/**
 * Drives the real Miruro cycle against a stubbed pipe, so what is pinned is the
 * behaviour a user sees — whether a known-dead backend is asked again — rather
 * than which function got called.
 */

const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";
const PEWE_MASTER = "https://hls.anidb.app/stream/dead/master.m3u8";
const MOO_FILE = "https://www.animegg.org/play/1/video.mp4";

/** `base64url(xor(json, PIPE_KEY))` — the pipe's obfuscation, without gzip. */
function encodePipe(value: unknown): string {
  const key = Uint8Array.from((PIPE_KEY.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16)));
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Buffer.from(bytes.map((byte, index) => byte ^ (key[index % key.length] ?? 0))).toString(
    "base64url",
  );
}

function pipeRequest(url: URL): { path?: string; query?: Record<string, unknown> } {
  return JSON.parse(Buffer.from(url.searchParams.get("e") ?? "", "base64url").toString("utf8"));
}

const pipe = (value: unknown) =>
  new Response(encodePipe(value), { status: 200, headers: { "x-obfuscated": "2" } });

type Recorded = { endpoint: string; info: EndpointHealthFailureInfo };

function harness(options: {
  readonly quarantined?: readonly string[];
  readonly peweStatus?: number | "network-error";
  readonly peweStreams?: boolean;
}) {
  const requests: string[] = [];
  const failures: Recorded[] = [];
  const successes: string[] = [];
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
        if (url.pathname === "/api/secure/pipe") {
          const request = pipeRequest(url);
          if (request.path === "episodes") {
            return pipe({
              providers: {
                pewe: { episodes: { sub: [{ id: "pewe-1", number: 1 }] } },
                moo: { episodes: { sub: [{ id: "moo-1", number: 1 }] } },
              },
            });
          }
          if (request.path === "sources") {
            const provider = request.query?.provider;
            if (provider === "pewe") {
              return pipe({
                streams: options.peweStreams === false ? [] : [{ url: PEWE_MASTER, type: "hls" }],
              });
            }
            return pipe({ streams: [{ url: MOO_FILE, type: "mp4", quality: "720p" }] });
          }
        }
        if (url.host === "hls.anidb.app") {
          if (options.peweStatus === "network-error") throw new TypeError("fetch failed");
          return new Response("", { status: options.peweStatus ?? 429 });
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
    const { context, failures } = harness({ peweStatus: 429 });

    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.url).toBe(MOO_FILE);
    expect(failures).toEqual([
      {
        endpoint: "pewe",
        info: { class: "server-error", titleId: "anilist:154587", at: "2026-09-12T00:00:00.000Z" },
      },
    ]);
  });

  test("a quarantined backend is not asked at all — the point of recording it", async () => {
    // Before this, every episode paid the dead server's probe again: the
    // release signoff's anime lane took 13s against 2s for the others.
    const { context, requests } = harness({ quarantined: ["pewe"] });

    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(result.streams[0]?.url).toBe(MOO_FILE);
    expect(requests.some((request) => request.startsWith("hls.anidb.app"))).toBe(false);
  });

  test("a probe that could not reach the backend is no evidence against it", async () => {
    // Offline must not read as a dead server: that is how a healthy pool
    // got quarantined for an hour before.
    const { context, failures } = harness({ peweStatus: "network-error" });

    await miruroProviderModule.resolve(INPUT as never, context);

    expect(failures.filter((failure) => failure.endpoint === "pewe")).toEqual([]);
  });

  test("an episode a server simply lacks is no evidence against the server", async () => {
    const { context, failures } = harness({ peweStreams: false });

    const result = await miruroProviderModule.resolve(INPUT as never, context);

    expect(result.status).toBe("resolved");
    expect(failures.filter((failure) => failure.endpoint === "pewe")).toEqual([]);
  });

  test("a server that plays clears its record", async () => {
    const { context, successes } = harness({ quarantined: ["pewe"] });

    await miruroProviderModule.resolve(INPUT as never, context);

    expect(successes).toContain("moo");
  });
});
