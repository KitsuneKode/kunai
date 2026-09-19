import { describe, expect, test } from "bun:test";

import type {
  EndpointHealthPort,
  ProviderResolveInput,
  ProviderRuntimeContext,
} from "@kunai/types";

import { resolveVidlinkDirect } from "../src/vidlink/direct";

const COOKIE = "CloudFront-Policy=abc;CloudFront-Signature=def;CloudFront-Key-Pair-Id=ghi";

function buildContext(
  onRequest?: (url: string, init: RequestInit) => void,
  options: {
    endpointHealth?: EndpointHealthPort;
    /** Status override per host substring; defaults to the happy-path stub. */
    statuses?: Record<string, number>;
  } = {},
) {
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    onRequest?.(url, init);
    for (const [host, status] of Object.entries(options.statuses ?? {})) {
      if (url.includes(host)) {
        return new Response(`HTTP ${status}`, { status });
      }
    }
    onRequest?.(url, init);
    if (url.includes("enc-dec.app")) {
      return new Response(JSON.stringify({ result: "ENCRYPTED" }), { status: 200 });
    }
    if (url.includes("vidlink.pro/api/b")) {
      return new Response(
        JSON.stringify({
          stream: {
            type: "dash",
            playlist: "https://sacdn.hakunaymatata.com/dash/x_1080_h265/index_web.mpd",
            playlistHeaders: { Cookie: COOKIE },
            requiresProxy: true,
            playbackMetadata: {
              format: "DASH",
              codecName: "hevc",
              resolutions: ["480", "1080", "720"],
            },
            captions: [{ url: "https://cacdn.example/en.srt", language: "English", type: "srt" }],
          },
        }),
        { status: 200 },
      );
    }
    // Resolve-gate probe on the manifest: 200 only when the cookie rides along.
    const cookie = (init.headers as Record<string, string> | undefined)?.Cookie;
    return new Response(cookie === COOKIE ? '<?xml version="1.0"?><MPD/>' : "denied", {
      status: cookie === COOKIE ? 200 : 403,
    });
  };
  return {
    providerId: "vidlink",
    now: () => new Date().toISOString(),
    fetch: { runtime: "direct-http", fetch: fetchImpl },
    endpointHealth: options.endpointHealth,
  } as unknown as ProviderRuntimeContext;
}

function recordingEndpointHealth(quarantined: readonly string[] = []) {
  const failures: Array<{ endpoint: string; class: string; titleId?: string }> = [];
  const successes: string[] = [];
  const port: EndpointHealthPort = {
    shouldTry: (_providerId, endpoint) => !quarantined.includes(endpoint),
    recordFailure: (_providerId, endpoint, info) => {
      failures.push({ endpoint, class: info.class, titleId: info.titleId });
    },
    recordSuccess: (_providerId, endpoint) => {
      successes.push(endpoint);
    },
  };
  return { port, failures, successes };
}

const HLS_MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="日本語",LANGUAGE="ja",URI="audio/ja.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",URI="subs/es.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720,AUDIO="aud",SUBTITLES="subs"
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"
1080p.m3u8
`;

function buildHlsContext(onRequest?: (url: string) => void) {
  const fetchImpl = async (url: string) => {
    onRequest?.(url);
    if (url.includes("enc-dec.app")) {
      return new Response(JSON.stringify({ result: "ENCRYPTED" }), { status: 200 });
    }
    if (url.includes("vidlink.pro/api/b")) {
      return new Response(
        JSON.stringify({
          stream: {
            type: "hls",
            playlist: "https://cdn.example/master.m3u8",
            captions: [],
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("master.m3u8")) {
      return new Response(HLS_MASTER, { status: 200 });
    }
    if (url.endsWith(".m3u8")) {
      // Variant media playlist — the stream health check needs real segment rows.
      return new Response("#EXTM3U\n#EXTINF:4,\nseg0.ts\n", { status: 200 });
    }
    // Segment probe: reachability requires ≥ HLS_SEGMENT_PROBE_MIN_BYTES (1 KiB).
    return new Response(new Uint8Array(2048), {
      status: 200,
      headers: { "content-type": "video/mp2t" },
    });
  };
  return {
    providerId: "vidlink",
    now: () => new Date().toISOString(),
    fetch: { runtime: "direct-http", fetch: fetchImpl },
  } as unknown as ProviderRuntimeContext;
}

const INPUT = {
  mediaKind: "movie",
  title: { id: "tmdb:27205", title: "Inception", tmdbId: 27205 },
  allowedRuntimes: ["direct-http"],
  qualityPreference: "best",
  startupPriority: "balanced",
} as unknown as ProviderResolveInput;

describe("vidlink DASH delivery", () => {
  test("asks for the webkit playback environment", async () => {
    const seen: Record<string, RequestInit> = {};
    await resolveVidlinkDirect(
      INPUT,
      buildContext((url, init) => {
        if (url.includes("vidlink.pro/api/b")) seen.api = init;
      }),
    );

    const headers = seen.api?.headers as Record<string, string>;
    // Without this VidLink returns proxy-locked MP4s that answer 429 to any CLI.
    expect(headers["x-playback-environment"]).toBe("webkit");
  });

  test("carries the CloudFront cookie onto the stream, so gate and mpv both pass", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());

    expect(result.status).toBe("resolved");
    const stream = result.streams[0];
    expect(stream?.url).toContain(".mpd");
    expect(stream?.protocol).toBe("dash");
    expect(stream?.headers?.Cookie).toBe(COOKIE);
  });

  test("labels the DASH stream with the highest stated rendition", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());
    // resolutions arrive unordered; without this the panel shows a bare "auto".
    expect(result.streams[0]?.qualityLabel).toBe("1080p");
  });

  test("keeps the provider's subtitle inventory", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildContext());
    expect(result.subtitles.length).toBe(1);
    expect(result.subtitles[0]?.language).toBe("en");
  });

  test("master-manifest renditions feed audioLanguages and subtitle inventory (#189)", async () => {
    const result = await resolveVidlinkDirect(INPUT, buildHlsContext());

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.qualityLabel)).toEqual(
      expect.arrayContaining(["1080p", "720p"]),
    );
    for (const stream of result.streams) {
      expect(stream.audioLanguages).toEqual(expect.arrayContaining(["en", "ja"]));
    }
    const subUrls = result.subtitles.map((subtitle) => subtitle.url);
    expect(subUrls).toEqual(
      expect.arrayContaining([
        "https://cdn.example/subs/en.m3u8",
        "https://cdn.example/subs/es.m3u8",
      ]),
    );
  });
});

// encDecCache is module-level and keyed on tmdbId — enc-dec tests each need a
// fresh id or they resolve from the happy-path cache without a request.
const INPUT_ENC_DEC = {
  ...INPUT,
  title: { id: "tmdb:998877", title: "Cache Buster", tmdbId: 998877 },
} as unknown as ProviderResolveInput;
const INPUT_ENC_DEC_2 = {
  ...INPUT,
  title: { id: "tmdb:998878", title: "Cache Buster 2", tmdbId: 998878 },
} as unknown as ProviderResolveInput;

describe("vidlink endpoint health", () => {
  test("classifies a 429 as rate-limited and records a transient failure", async () => {
    const health = recordingEndpointHealth();
    const result = await resolveVidlinkDirect(
      INPUT,
      buildContext(undefined, {
        endpointHealth: health.port,
        statuses: { "vidlink.pro/api/b": 429 },
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("rate-limited");
    expect(result.failures[0]?.retryable).toBe(true);
    expect(
      health.failures.some((f) => f.endpoint === "vidlink.pro" && f.class === "transient"),
    ).toBe(true);
    expect(health.failures[0]?.titleId).toBe("tmdb:27205");
  });

  test("classifies a 403 as blocked", async () => {
    const health = recordingEndpointHealth();
    const result = await resolveVidlinkDirect(
      INPUT,
      buildContext(undefined, {
        endpointHealth: health.port,
        statuses: { "vidlink.pro/api/b": 403 },
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("blocked");
    expect(result.failures[0]?.retryable).toBe(false);
  });

  test("a 404 is title-shaped, not health evidence: no endpoint failure is recorded", async () => {
    const health = recordingEndpointHealth();
    const result = await resolveVidlinkDirect(
      INPUT,
      buildContext(undefined, {
        endpointHealth: health.port,
        statuses: { "vidlink.pro/api/b": 404 },
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("not-found");
    expect(health.failures.filter((f) => f.endpoint === "vidlink.pro")).toHaveLength(0);
  });

  test("records a server-error class for a persistent 5xx on enc-dec.app", async () => {
    const health = recordingEndpointHealth();
    const result = await resolveVidlinkDirect(
      INPUT_ENC_DEC,
      buildContext(undefined, {
        endpointHealth: health.port,
        statuses: { "enc-dec.app": 500 },
      }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("provider-unavailable");
    const recorded = health.failures.filter((f) => f.endpoint === "enc-dec.app");
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((f) => f.class === "server-error")).toBe(true);
  });

  test("skips enc-dec.app entirely while it is quarantined", async () => {
    const health = recordingEndpointHealth(["enc-dec.app"]);
    const requestedUrls: string[] = [];
    const result = await resolveVidlinkDirect(
      INPUT_ENC_DEC_2,
      buildContext((url) => requestedUrls.push(url), { endpointHealth: health.port }),
    );

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("provider-unavailable");
    expect(requestedUrls.some((u) => u.includes("enc-dec.app"))).toBe(false);
    expect(requestedUrls.some((u) => u.includes("vidlink.pro/api/b"))).toBe(false);
  });

  test("records success on a healthy resolve", async () => {
    const health = recordingEndpointHealth();
    const result = await resolveVidlinkDirect(
      INPUT_ENC_DEC,
      buildContext(undefined, { endpointHealth: health.port }),
    );

    expect(result.status).toBe("resolved");
    expect(health.successes).toContain("enc-dec.app");
    expect(health.successes).toContain("vidlink.pro");
    expect(health.failures).toHaveLength(0);
  });
});
