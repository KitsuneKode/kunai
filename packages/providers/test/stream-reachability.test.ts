import { describe, expect, test } from "bun:test";

import { HLS_SEGMENT_PROBE_MIN_BYTES } from "../src/shared/hls-manifest";
import {
  createGuardedFetch,
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeStreamReachability,
  PROVIDER_API_SENSITIVE_HEADERS,
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

describe("stream reachability", () => {
  test("HLS media playlists probe first media segment after playlist fetch", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith("stream.m3u8")) {
        return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.jpg\n");
      }
      expect(init.headers).toMatchObject({
        Range: `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`,
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

  test("Range-ignoring 200 segment body is read to the probe prefix, then cancelled", async () => {
    // A CDN that answers `bytes=0-1023` with a full 200 segment used to be
    // buffered whole into memory — per candidate, per probe. The reader must
    // stop once the minimum byte proof arrives and cancel the rest.
    let cancelled = false;
    const endlessSegment = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8192).fill(0xab));
      },
      cancel() {
        cancelled = true;
      },
    });

    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/seg-1.ts\n");
        }
        return new Response(endlessSegment, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      },
      timeoutMs: 500,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(cancelled).toBe(true);
  });

  test("an oversized playlist body is unreachable instead of buffered whole", async () => {
    // A chunked playlist body is bounded only by the request timeout without
    // the cap — 3MB of `#` comments is not a playlist, it is a memory leak.
    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async () => response(200, `#EXTM3U\n${"#".repeat(3 * 1024 * 1024)}\n`),
      timeoutMs: 500,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("playlist body");
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

  test("a declared-HTML segment that is actually MPEG-TS is reachable", async () => {
    // Upstreams disguise real segments as HTML documents to defeat
    // content-type filters — vidrock's obsidiancircuit lane serves valid TS
    // as `page-N.html`. The declared type is a claim; the bytes decide.
    const tsSegment = new Uint8Array(HLS_SEGMENT_PROBE_MIN_BYTES);
    tsSegment[0] = 0x47;
    tsSegment[188] = 0x47;
    tsSegment[376] = 0x47;

    const probe = await probeStreamReachability({
      url: "https://cdn.example/stream.m3u8",
      fetchImpl: async (url: string) => {
        if (url.endsWith("stream.m3u8")) {
          return response(200, "#EXTM3U\n#EXTINF:3,\n/page-0.html\n");
        }
        return response(200, tsSegment, { "content-type": "text/html; charset=utf-8" });
      },
      timeoutMs: 200,
    });

    expect(probe).toEqual({ status: "reachable" });
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
      "http://192.168.1.10/jellyfin",
      "http://[::1]/loopback",
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

describe("guarded provider fetch", () => {
  const guarded = (fetchImpl: (url: string, init: RequestInit) => Promise<Response>) =>
    createGuardedFetch({
      fetchImpl,
      extraSensitiveHeaders: PROVIDER_API_SENSITIVE_HEADERS,
    });

  test("cross-origin redirects strip credentials and provider-secret headers", async () => {
    const seenHeaders: Headers[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seenHeaders.push(new Headers(init.headers));
      if (url === "https://api.example/search") {
        return response(302, "", { location: "https://evil.example/read" });
      }
      return response(200, "ok");
    };

    const res = await guarded(fetchImpl)("https://api.example/search", {
      headers: {
        authorization: "Bearer x",
        cookie: "s=1",
        "x-aa-boot": "boot",
        "x-session-token": "tok",
        referer: "https://api.example/",
        origin: "https://api.example",
        "content-type": "application/json",
      },
    });

    expect(res.status).toBe(200);
    const second = seenHeaders[1];
    expect(second).toBeDefined();
    if (!second) return;
    for (const name of [
      "authorization",
      "cookie",
      "x-aa-boot",
      "x-session-token",
      "referer",
      "origin",
    ]) {
      expect(second.get(name)).toBeNull();
    }
    // Non-sensitive headers still travel with the redirect.
    expect(second.get("content-type")).toBe("application/json");
  });

  test("same-origin redirects keep every header", async () => {
    const seenHeaders: Headers[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seenHeaders.push(new Headers(init.headers));
      if (url === "https://api.example/a") {
        return response(301, "", { location: "https://api.example/b" });
      }
      return response(200);
    };

    await guarded(fetchImpl)("https://api.example/a", {
      headers: { "x-session-token": "tok", authorization: "Bearer x" },
    });

    const second = seenHeaders[1];
    expect(second?.get("x-session-token")).toBe("tok");
    expect(second?.get("authorization")).toBe("Bearer x");
  });

  test("a redirect into a private literal never reaches the fetch impl", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url === "https://api.example/search") {
        return response(302, "", { location: "http://169.254.169.254/meta" });
      }
      return response(200);
    };

    await expect(guarded(fetchImpl)("https://api.example/search")).rejects.toThrow(
      "Blocked unsafe fetch target",
    );
    expect(urls).toEqual(["https://api.example/search"]);
  });

  test("an https downgrade redirect is refused", async () => {
    const fetchImpl = async (url: string) =>
      url === "https://api.example/a"
        ? response(302, "", { location: "http://api.example/b" })
        : response(200);

    await expect(guarded(fetchImpl)("https://api.example/a")).rejects.toThrow(
      "Blocked unsafe fetch target",
    );
  });

  test("a Request input keeps method, headers, and body across a redirect", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (init.body) bodies.push(await new Response(init.body).text());
      if (url === "https://api.example/a") {
        return response(307, "", { location: "https://api.example/b" });
      }
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("x-custom")).toBe("1");
      return response(200);
    };

    const request = new Request("https://api.example/a", {
      method: "POST",
      headers: { "x-custom": "1" },
      body: "payload",
    });
    const res = await guarded(fetchImpl)(request);

    expect(res.status).toBe(200);
    expect(bodies).toEqual(["payload", "payload"]);
  });

  test("allowInitialPrivateTarget exempts hop 0 but not redirect hops", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return response(200, "ok");
    };
    const lenient = createGuardedFetch({ fetchImpl, allowInitialPrivateTarget: true });

    // A user-configured self-hosted endpoint (Invidious/Piped) is legitimate.
    const res = await lenient("http://127.0.0.1:3000/api/v1/search?q=x");
    expect(res.status).toBe(200);

    // But a redirect from that endpoint into a private target is still refused.
    const redirecting = async (url: string) => {
      urls.push(`r:${url}`);
      return url === "http://127.0.0.1:3000/x"
        ? response(302, "", { location: "http://169.254.169.254/meta" })
        : response(200);
    };
    await expect(
      createGuardedFetch({ fetchImpl: redirecting, allowInitialPrivateTarget: true })(
        "http://127.0.0.1:3000/x",
      ),
    ).rejects.toThrow("Blocked unsafe fetch target");
  });

  test("URL inputs follow the same guard", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return response(200);
    };
    await expect(guarded(fetchImpl)(new URL("http://10.0.0.1/admin"))).rejects.toThrow(
      "Blocked unsafe fetch target",
    );
    expect(called).toBe(false);
  });
});
