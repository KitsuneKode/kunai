import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  clearRivestreamCachesForTest,
  RIVESTREAM_REFERER,
  rivestreamProviderModule,
} from "../src/rivestream/direct";

/**
 * Rivestream's `m3u8-proxy` URLs embed a `headers=` JSON param — the proxy's
 * own credential for the upstream CDN it wraps, not headers the client
 * replays. Replaying them sent the upstream's referer (`bingr.one`) to a proxy
 * that only answers the site's own identity, and the resolve gate saw the same
 * 403 mpv would have hit at playback. Measured live on 2026-10-03:
 * `proxy.valhallastream.com` answers 403 to the embedded referer and 200 to
 * Rivestream's.
 *
 * The cycle's early-stop then made it worse: the gate's `candidate-blocked`
 * verdict is endpoint-scoped evidence about one service's mirrors, but the
 * stop predicate treated it like a front-door WAF block and never walked the
 * sibling services — which host elsewhere (citadel → klnwm, primevids →
 * ngcorp; only the valhallastream trio shares a CDN).
 */

const MEDIA_PLAYLIST =
  "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nsegment-0.ts\n#EXT-X-ENDLIST\n";
const SEGMENT_BODY = new Uint8Array(2048);

function seriesInput(): ProviderResolveInput {
  return {
    title: {
      id: "1396",
      tmdbId: "1396",
      kind: "series",
      title: "Breaking Bad",
    },
    episode: { season: 1, episode: 1 },
    mediaKind: "series",
    startupPriority: "balanced",
    intent: "play",
    allowedRuntimes: ["direct-http"],
  } as unknown as ProviderResolveInput;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sourceEnvelope(url: string) {
  return {
    data: { sources: [{ url, quality: "1080p" }], captions: [] as never[] },
  };
}

type FetchCall = { url: string; referer: string | null };

function contextServing(
  services: readonly string[],
  /** service name → stream URL the API answers for it */
  sourceUrls: Record<string, string>,
  /** How a stream host answers, given the referer the probe/playback sent. */
  streamHostResponse: (url: string, referer: string | null) => Response,
  calls: FetchCall[],
): ProviderRuntimeContext {
  return {
    now: () => "2026-10-03T00:00:00.000Z",
    signal: AbortSignal.timeout(30_000),
    emit: () => {},
    fetch: {
      runtime: "direct-http",
      fetch: async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("VideoProviderServices")) {
          return jsonResponse({ data: [...services] });
        }
        if (url.includes("backendfetch")) {
          const service = new URL(url).searchParams.get("service") ?? "";
          const sourceUrl = sourceUrls[service];
          return jsonResponse(sourceUrl ? sourceEnvelope(sourceUrl) : { data: { sources: [] } });
        }
        const referer = new Headers(init?.headers).get("referer");
        calls.push({ url, referer });
        return streamHostResponse(url, referer);
      },
    },
  } as unknown as ProviderRuntimeContext;
}

describe("rivestream proxy headers and cycle resilience", () => {
  beforeEach(() => {
    clearRivestreamCachesForTest();
  });
  afterEach(() => {
    clearRivestreamCachesForTest();
  });

  test("an embedded `headers=` param is the proxy's upstream credential, not client headers", async () => {
    const embedded = {
      Origin: "https://bingr.one",
      Referer: "https://bingr.one/",
    };
    const streamUrl =
      "https://proxy.example/m3u8-proxy" +
      `?url=${encodeURIComponent("https://cdn.upstream.example/tv/index.m3u8")}` +
      `&headers=${encodeURIComponent(JSON.stringify(embedded))}`;

    const calls: FetchCall[] = [];
    // Mirrors the measured valhallastream contract: the site's referer gets
    // the playlist, the embedded upstream referer is refused.
    const context = contextServing(
      ["apogee"],
      { apogee: streamUrl },
      (url, referer) => {
        if (referer?.includes("bingr.one")) return new Response("Forbidden", { status: 403 });
        if (url.includes("m3u8-proxy")) return new Response(MEDIA_PLAYLIST, { status: 200 });
        return new Response(SEGMENT_BODY, { status: 200 });
      },
      calls,
    );

    const result = await rivestreamProviderModule.resolve(seriesInput(), context);

    expect(result.status).toBe("resolved");
    expect(result.streams.length).toBeGreaterThan(0);
    for (const stream of result.streams) {
      expect(stream.headers?.referer).toBe(RIVESTREAM_REFERER);
      expect(
        Object.values(stream.headers ?? {}).every((value) => !value.includes("bingr.one")),
      ).toBe(true);
    }
    // The shipped headers are the ones the gate probed — and the ones mpv sends.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.referer === RIVESTREAM_REFERER)).toBe(true);
  });

  test("one service's dead mirrors do not stop the cycle before its siblings", async () => {
    const calls: FetchCall[] = [];
    const context = contextServing(
      ["deadsvc", "livesvc"],
      {
        deadsvc: "https://dead.example/index.m3u8",
        livesvc: "https://live.example/index.m3u8",
      },
      (url) => {
        if (url.includes("dead.example") && !url.endsWith(".m3u8")) {
          // Playlist answers, every segment refuses — the dead-mirror pattern.
          return new Response("domain forbidden", { status: 403 });
        }
        if (url.endsWith(".m3u8")) return new Response(MEDIA_PLAYLIST, { status: 200 });
        return new Response(SEGMENT_BODY, { status: 200 });
      },
      calls,
    );

    const result = await rivestreamProviderModule.resolve(seriesInput(), context);

    expect(result.status).toBe("resolved");
    expect((result.sources ?? []).some((source) => source.id.includes("livesvc"))).toBe(true);
    const events = result.trace.events ?? [];
    expect(
      events.some(
        (event) =>
          event.type === "source:failed" && event.attributes?.failureClass === "candidate-blocked",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "source:success")).toBe(true);
  });
});
