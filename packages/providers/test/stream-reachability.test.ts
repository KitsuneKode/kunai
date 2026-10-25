import { describe, expect, test } from "bun:test";

import { HLS_SEGMENT_PROBE_MIN_BYTES } from "../src/shared/hls-manifest";
import {
  fetchGuardedStreamTarget,
  isGuardedPlatformFetch,
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeStreamReachability,
  shouldAbortPlaybackForPreflight,
} from "../src/shared/stream-reachability";

function response(
  status: number,
  body: string | Uint8Array = "",
  headers?: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

function mediaBytes(size = HLS_SEGMENT_PROBE_MIN_BYTES): Uint8Array {
  return new Uint8Array(size).fill(0xab);
}

function mp4Box(type: string, ...parts: readonly Uint8Array[]): Uint8Array {
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function fmp4Segment(withDecodeTime = true, sampleCount = 1): Uint8Array {
  const tfhd = Buffer.alloc(8);
  tfhd.writeUInt32BE(0x020000, 0); // default-base-is-moof
  tfhd.writeUInt32BE(1, 4); // track id
  const trun = Buffer.alloc(12 + sampleCount * 4);
  trun.writeUInt32BE(0x201, 0); // data-offset-present + sample-size-present
  trun.writeUInt32BE(sampleCount, 4);
  for (let index = 0; index < sampleCount; index++) trun.writeUInt32BE(1, 12 + index * 4);
  const fragmentParts = [mp4Box("tfhd", tfhd)];
  if (withDecodeTime) fragmentParts.push(mp4Box("tfdt", Buffer.alloc(8)));
  fragmentParts.push(mp4Box("trun", trun));
  const fragment = mp4Box(
    "moof",
    mp4Box("mfhd", Buffer.alloc(8)),
    mp4Box("traf", ...fragmentParts),
  );
  trun.writeInt32BE(fragment.length + 8, 8);
  const finalized = mp4Box(
    "moof",
    mp4Box("mfhd", Buffer.alloc(8)),
    mp4Box(
      "traf",
      mp4Box("tfhd", tfhd),
      ...(withDecodeTime ? [mp4Box("tfdt", Buffer.alloc(8))] : []),
      mp4Box("trun", trun),
    ),
  );
  return Buffer.concat([
    finalized,
    mp4Box("mdat", mediaBytes(Math.max(sampleCount, HLS_SEGMENT_PROBE_MIN_BYTES))),
  ]);
}

function extendedMdatSegment(validSize: boolean): Uint8Array {
  const segment = Buffer.from(fmp4Segment());
  const dataOffset = segment.indexOf("mdat") - 4;
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1);
  header.write("mdat", 4, "ascii");
  header.writeBigUInt64BE(validSize ? BigInt(16 + HLS_SEGMENT_PROBE_MIN_BYTES) : 0n, 8);
  segment.writeInt32BE(dataOffset + 16, segment.indexOf("trun") + 12);
  return Buffer.concat([segment.subarray(0, dataOffset), header, mediaBytes()]);
}

describe("stream reachability", () => {
  test("HLS media playlists probe first media segment after playlist fetch", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith("stream.m3u8")) {
        return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
      }
      expect(init.headers).toMatchObject({
        Range: "bytes=0-65535",
      });
      return response(206, mediaBytes());
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl,
      timeoutMs: 200,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(urls).toEqual(["https://cdn.example/stream.m3u8", "https://cdn.example/seg-1.jpg"]);
  });

  test("HLS master playlists follow video variant then media segment", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.endsWith("master.m3u8")) {
        return response(
          200,
          [
            "#EXTM3U",
            "#EXT-X-STREAM-INF:BANDWIDTH=800000",
            "index-v1-a1.m3u8",
            "#EXT-X-STREAM-INF:BANDWIDTH=400000",
            "index-a1.m3u8",
          ].join("\n"),
        );
      }
      if (url.endsWith("index-v1-a1.m3u8")) {
        return response(200, "#EXTM3U\n#EXTINF:4,\nseg-1-v1-a1.ts.html\n");
      }
      return response(206, mediaBytes());
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/token/master.m3u8",
      fetchImpl,
      timeoutMs: 500,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(urls).toEqual([
      "https://cdn.example/token/master.m3u8",
      "https://cdn.example/token/index-v1-a1.m3u8",
      "https://cdn.example/token/seg-1-v1-a1.ts.html",
    ]);
  });

  test("HLS segment probe fails when first segment is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      headers: { referer: "https://provider.example" },
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(404, "missing");
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("HLS segment unreachable");
    }
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("master OK + segment 403 is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("master.m3u8")) {
          return response(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1.m3u8\n");
        }
        if (url.endsWith("index-v1.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg.ts\n");
        }
        return response(403, "blocked");
      },
      timeoutMs: 500,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("a mid-body segment read error is not misclassified as a definitive small body", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.ts\n");
        }
        // Fewer bytes than the probe needs, then the socket dies — a transient
        // failure, not a server truthfully answering with a tiny body.
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(8).fill(0xab));
              controller.error(new Error("socket hang up"));
            },
          }),
          { status: 200, headers: { "content-type": "video/mp2t" } },
        );
      },
      timeoutMs: 500,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("socket hang up");
      expect(probe.reason).not.toContain("body too small");
      expect(probe.definitive).toBe(false);
    }
  });

  test("junk tiny segment body is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(200, "x", { "content-type": "application/octet-stream" });
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("body too small");
      expect(probe.definitive).toBe(true);
    }
  });

  test("HTML content-type on segment is unreachable", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return response(200, mediaBytes(), { "content-type": "text/html; charset=utf-8" });
      },
      timeoutMs: 200,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("text/html");
    }
  });

  for (const syncCount of [1, 2, 3]) {
    test(`HTML MIME override requires three TS sync boundaries (${syncCount} present)`, async () => {
      const bytes = mediaBytes();
      for (let packet = 0; packet < syncCount; packet++) bytes[packet * 188] = 0x47;
      const probe = await probeStreamReachability({
        url: "https://cdn.example/stream.m3u8",
        fetchImpl: async (url: string) =>
          url.endsWith("stream.m3u8")
            ? response(200, "#EXTM3U\n#EXTINF:3,\n/seg.ts\n")
            : response(200, bytes, { "content-type": "text/html" }),
      });
      expect(probe.status).toBe(syncCount === 3 ? "reachable" : "unreachable");
    });
  }

  test("mislabeled TS probes cancel after the prefix when Range is ignored", async () => {
    let chunksRead = 0;
    let cancelled = false;
    const bytes = mediaBytes();
    for (const offset of [0, 188, 376]) bytes[offset] = 0x47;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunksRead++;
          controller.enqueue(bytes);
          if (chunksRead === 100) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) =>
        url.endsWith("stream.m3u8")
          ? response(200, "#EXTM3U\n#EXTINF:3,\n/seg.ts\n")
          : new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
    });
    expect(probe.status).toBe("reachable");
    expect(cancelled).toBe(true);
    expect(chunksRead).toBe(1);
  });

  for (const [contentType, expectedChunks] of [
    ["text/html", 64],
    ["video/mp2t", 1],
  ] as const) {
    test(`segment probe caps reads when Range is ignored (${contentType})`, async () => {
      let chunksRead = 0;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            chunksRead++;
            controller.enqueue(mediaBytes());
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const probe = await probeStreamReachability({
        url: "https://cdn.example/stream.m3u8",
        fetchImpl: async (url: string) =>
          url.endsWith("stream.m3u8")
            ? response(200, "#EXTM3U\n#EXTINF:3,\n/seg.m4s\n")
            : new Response(body, { status: 200, headers: { "content-type": contentType } }),
      });
      expect(probe.status).toBe(contentType === "text/html" ? "unreachable" : "reachable");
      expect(chunksRead).toBe(expectedChunks);
      expect(cancelled).toBe(true);
    });
  }

  for (const [label, bytes, accepted] of [
    ["moof/mdat", fmp4Segment(), true],
    ["movie fragment larger than 1 KiB", fmp4Segment(true, 512), true],
    ["extended mdat", extendedMdatSegment(true), true],
    ["invalid extended mdat size", extendedMdatSegment(false), false],
    [
      "styp/moof/mdat",
      Buffer.concat([mp4Box("styp", Buffer.from("msdh0000msdh", "ascii")), fmp4Segment()]),
      true,
    ],
    ["missing decode-time box", fmp4Segment(false), false],
    ["empty fragment", Buffer.concat([mp4Box("moof"), mp4Box("mdat", mediaBytes())]), false],
    [
      "MP4 marker without fragment",
      Buffer.concat([mp4Box("ftyp", Buffer.from("iso60000iso6", "ascii")), mediaBytes()]),
      false,
    ],
  ] as const) {
    test(`HTML-labeled fMP4 prefix: ${label}`, async () => {
      const probe = await probeStreamReachability({
        url: "https://cdn.example/stream.m3u8",
        fetchImpl: async (url: string) =>
          url.endsWith("stream.m3u8")
            ? response(200, "#EXTM3U\n#EXTINF:3,\n/seg.m4s\n")
            : response(200, bytes, { "content-type": "text/html" }),
      });
      expect(probe.status).toBe(accepted ? "reachable" : "unreachable");
    });
  }

  test("a segment body that errors mid-read is not reported as a small body", async () => {
    // readPrefixBytes used to catch the read failure and return the partial
    // count, so a dying socket masqueraded as a definitive "body too small".
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8).fill(0xab));
      },
      pull() {
        throw new Error("socket reset mid-body");
      },
    });
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
        }
        return new Response(failingBody, { status: 200 });
      },
      timeoutMs: 500,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("socket reset mid-body");
      expect(probe.reason).not.toContain("body too small");
      // A transient network failure is retryable — not a definitive refusal.
      expect(probe.definitive).toBe(false);
    }
  });

  test("abort mid-probe returns timeout", async () => {
    const controller = new AbortController();
    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort();
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
      timeoutMs: 500,
    });

    expect(probe).toEqual({ status: "timeout" });
  });

  test("resolve gate rejects definitive unreachable probes", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/dead.m3u8",
      fetchImpl: async () => response(403, "blocked"),
      timeoutMs: 50,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
    expect(isStreamReachableForPlaybackPreflight(probe)).toBe(false);
    expect(shouldAbortPlaybackForPreflight(probe, false)).toBe(true);
  });

  test("a rate-limited CDN blocks the resolve gate", async () => {
    // Treating 429 as transient let the gate pass a stream whose CDN was
    // refusing every request, so mpv received an nginx error page. Verified
    // live against bcdn.hakunaymatata.com on 2026-08-24.
    const probe = await probeStreamReachability({
      url: "https://cdn.example/rate-limited.m3u8",
      fetchImpl: async () => response(429, "slow down"),
      timeoutMs: 50,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("404 stays definitive", async () => {
    const probe = await probeStreamReachability({
      url: "https://cdn.example/missing.m3u8",
      fetchImpl: async () => response(404, "gone"),
      timeoutMs: 50,
    });

    expect(probe.status).toBe("unreachable");
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("unverifiable TLS chain is definitive, not a retryable transport blip", async () => {
    // hls.aniwatch.al served a chain OpenSSL could not verify (2026-10): the
    // probe used to retry then pass the dead stream through leniently, and
    // mpv's TLS stack failed on the exact same trust decision.
    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      fetchImpl: async () => {
        throw new TypeError("unable to verify the first certificate");
      },
      timeoutMs: 50,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.definitive).toBe(true);
    }
    expect(isStreamReachableForResolve(probe)).toBe(false);
  });

  test("self-signed and issuer-chain failures are definitive too", async () => {
    for (const message of [
      "self signed certificate in certificate chain",
      "unable to get local issuer certificate",
      "certificate verify failed",
    ]) {
      const probe = await probeStreamReachability({
        url: "https://cdn.example/stream.m3u8",
        fetchImpl: async () => {
          throw new TypeError(message);
        },
        timeoutMs: 50,
      });
      expect(probe.status).toBe("unreachable");
      if (probe.status === "unreachable") {
        expect(probe.definitive).toBe(true);
      }
    }
  });

  test("playback preflight stays lenient on timeout", async () => {
    const probe = { status: "timeout" } as const;
    expect(isStreamReachableForResolve(probe)).toBe(true);
    expect(isStreamReachableForPlaybackPreflight(probe)).toBe(true);
    expect(shouldAbortPlaybackForPreflight(probe, false)).toBe(false);
  });

  test("non-HLS URLs fall back from HEAD to ranged GET", async () => {
    const methods: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      methods.push(String(init.method));
      if (init.method === "HEAD") return response(405);
      return response(206);
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/movie.mp4",
      fetchImpl,
      timeoutMs: 50,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(methods).toEqual(["HEAD", "GET"]);
  });

  test("rejects a provider URL aimed at a private literal host without fetching", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data",
      "http://127.0.0.1:8080/internal",
      "http://10.0.0.4/lan",
      "http://172.16.5.4/lan",
      "http://172.31.255.250/lan",
      "http://192.168.1.10/jellyfin",
      "http://0.0.0.0/internal",
      "http://[::1]/loopback",
      "http://[::ffff:7f00:1]/mapped-loopback",
      "http://[fd00::5]/ula",
      "https://localhost/private",
      "http://nas/intranet",
      "file:///etc/passwd",
    ]) {
      let called = false;
      const probe = await probeStreamReachability({
        url,
        fetchImpl: async () => {
          called = true;
          return response(200);
        },
        timeoutMs: 50,
      });
      expect(probe.status).toBe("unreachable");
      if (probe.status === "unreachable") {
        expect(probe.reason).toContain("blocked stream target");
        expect(probe.definitive).toBe(true);
      }
      expect(called).toBe(false);
    }
  });

  test("a normal public CDN host is fetched, not blocked", async () => {
    let called = false;
    const probe = await probeStreamReachability({
      url: "https://cdn.example/movie.mp4",
      fetchImpl: async () => {
        called = true;
        return response(200);
      },
      timeoutMs: 50,
    });

    expect(called).toBe(true);
    expect(probe).toEqual({ status: "reachable" });
  });

  test("follows a public redirect but refuses a redirect into a private target", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url === "https://cdn.example/start.mp4") {
        return response(302, "", { location: "http://169.254.169.254/meta" });
      }
      return response(200);
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/start.mp4",
      fetchImpl,
      timeoutMs: 100,
    });

    expect(urls).toEqual(["https://cdn.example/start.mp4"]);
    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("blocked stream target");
      expect(probe.definitive).toBe(true);
    }
  });

  test("public redirect hops still resolve to reachable", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url === "https://cdn.example/start.mp4") {
        return response(302, "", { location: "/v2/start.mp4" });
      }
      return response(206);
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/start.mp4",
      fetchImpl,
      timeoutMs: 100,
    });

    expect(urls).toEqual(["https://cdn.example/start.mp4", "https://cdn.example/v2/start.mp4"]);
    expect(probe).toEqual({ status: "reachable" });
  });

  test("an HLS playlist cannot name a private absolute variant or segment URI", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return response(
        200,
        ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000", "http://169.254.169.254/steal.m3u8"].join(
          "\n",
        ),
      );
    };

    const probe = await probeStreamReachability({
      url: "https://cdn.example/master.m3u8",
      fetchImpl,
      timeoutMs: 100,
    });

    expect(urls).toEqual(["https://cdn.example/master.m3u8"]);
    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("blocked stream target");
      expect(probe.definitive).toBe(true);
    }
  });
});

describe("isGuardedPlatformFetch", () => {
  test("a distinct stub is not the platform fetch, even when assigned to globalThis.fetch", () => {
    const originalFetch = globalThis.fetch;
    // SAFETY: the stub is only invoked as `(url, init) => Response`; fetch's branded preconnect member is unused.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    const stub: typeof fetch = (async () => new Response("ok")) as unknown as typeof fetch;
    try {
      expect(isGuardedPlatformFetch(stub)).toBe(false);
      globalThis.fetch = stub;
      expect(isGuardedPlatformFetch(fetch)).toBe(false);
      expect(isGuardedPlatformFetch(originalFetch)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchGuardedStreamTarget uses a stubbed global fetch without DNS-checking the host", async () => {
    // Regression for KIT-76: `fetchImpl === fetch` was true after tests stubbed
    // globalThis.fetch, so documentation hosts (example.com → 192.0.2.1) and
    // DNS sinkholes reported blocked-target and never called the stub.
    const originalFetch = globalThis.fetch;
    // SAFETY: the stub is only invoked as `(url, init) => Response`; fetch's branded preconnect member is unused.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- fetch's branded preconnect member forces the unknown hop
    const stub: typeof fetch = (async () =>
      new Response("ok", { status: 200 })) as unknown as typeof fetch;
    globalThis.fetch = stub;
    try {
      const outcome = await fetchGuardedStreamTarget({
        fetchImpl: fetch,
        url: "https://example.com/master.m3u8",
        init: {},
      });
      expect(outcome.kind).toBe("response");
      if (outcome.kind === "response") {
        expect(outcome.response.status).toBe(200);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
