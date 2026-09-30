import { describe, expect, test } from "bun:test";

import { HLS_SEGMENT_PROBE_MIN_BYTES } from "../src/shared/hls-manifest";
import {
  blockedLiteralAddressReason,
  fetchGuardedStreamTarget,
  isStreamReachableForPlaybackPreflight,
  isStreamReachableForResolve,
  probeLookupForPort,
  probeStreamReachability,
  shouldAbortPlaybackForPreflight,
  systemDnsLookup,
  type StreamReachabilityLookup,
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

type PinnedInit = RequestInit & {
  readonly tls?: { readonly serverName?: string };
  readonly proxy?: boolean;
};

describe("stream reachability DNS pinning", () => {
  test("pins a hostname fetch to the validated answer and keeps its authority", async () => {
    const seen: { url: string; init: PinnedInit }[] = [];
    const lookedUp: string[] = [];

    const probe = await probeStreamReachability({
      url: "https://cdn.example:8443/v/start.mp4?token=x",
      fetchImpl: async (url, init) => {
        // SAFETY: RequestInit does not declare Bun's `tls`/`proxy` fields; the
        // assertion only exposes what the pin wrote onto the live init.
        seen.push({ url, init: init as PinnedInit });
        return response(200);
      },
      lookupImpl: async (host) => {
        lookedUp.push(host);
        return ["93.184.216.34"];
      },
      timeoutMs: 100,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(lookedUp).toEqual(["cdn.example"]);
    // The socket addresses the validated IP; Host + SNI keep the real name.
    expect(seen[0]?.url).toBe("https://93.184.216.34:8443/v/start.mp4?token=x");
    expect(new Headers(seen[0]?.init.headers).get("host")).toBe("cdn.example:8443");
    expect(seen[0]?.init.tls).toEqual({ serverName: "cdn.example" });
    expect(seen[0]?.init.proxy).toBe(false);
  });

  test("http targets pin without a TLS override", async () => {
    const seen: { url: string; init: PinnedInit }[] = [];

    const probe = await probeStreamReachability({
      url: "http://cdn.example/v.mp4",
      fetchImpl: async (url, init) => {
        // SAFETY: RequestInit does not declare Bun's `tls`/`proxy` fields; the
        // assertion only exposes what the pin wrote onto the live init.
        seen.push({ url, init: init as PinnedInit });
        return response(200);
      },
      lookupImpl: async () => ["93.184.216.34"],
      timeoutMs: 100,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(seen[0]?.url).toBe("http://93.184.216.34/v.mp4");
    expect(new Headers(seen[0]?.init.headers).get("host")).toBe("cdn.example");
    expect(seen[0]?.init.tls).toBeUndefined();
    expect(seen[0]?.init.proxy).toBe(false);
  });

  test("a private DNS answer is refused before any fetch", async () => {
    let called = false;
    const probe = await probeStreamReachability({
      url: "https://cdn.example/v.mp4",
      fetchImpl: async () => {
        called = true;
        return response(200);
      },
      lookupImpl: async () => ["10.0.0.5"],
      timeoutMs: 100,
    });

    expect(probe.status).toBe("unreachable");
    if (probe.status === "unreachable") {
      expect(probe.reason).toContain("blocked stream target");
      expect(probe.definitive).toBe(true);
    }
    expect(called).toBe(false);
  });

  test("one private address in a mixed answer refuses the whole name", async () => {
    let called = false;
    const probe = await probeStreamReachability({
      url: "https://cdn.example/v.mp4",
      fetchImpl: async () => {
        called = true;
        return response(200);
      },
      lookupImpl: async () => ["93.184.216.34", "169.254.169.254"],
      timeoutMs: 100,
    });

    expect(probe.status).toBe("unreachable");
    expect(called).toBe(false);
  });

  test("empty and failed lookups fail closed instead of resolving again", async () => {
    for (const lookupImpl of [
      async () => [],
      async () => {
        throw new Error("ENOTFOUND");
      },
    ] satisfies StreamReachabilityLookup[]) {
      let called = false;
      const probe = await probeStreamReachability({
        url: "https://cdn.example/v.mp4",
        fetchImpl: async () => {
          called = true;
          return response(200);
        },
        lookupImpl,
        timeoutMs: 100,
      });

      expect(probe.status).toBe("unreachable");
      if (probe.status === "unreachable") {
        expect(probe.reason).toContain("blocked stream target");
      }
      expect(called).toBe(false);
    }
  });

  test("a resolver slower than the probe deadline reports timeout", async () => {
    let called = false;
    const probe = await probeStreamReachability({
      url: "https://cdn.example/v.mp4",
      fetchImpl: async () => {
        called = true;
        return response(200);
      },
      lookupImpl: () => new Promise(() => {}),
      timeoutMs: 50,
    });

    expect(probe).toEqual({ status: "timeout" });
    expect(called).toBe(false);
  });

  test("parent abort during the lookup reports timeout", async () => {
    const controller = new AbortController();
    const probe = await probeStreamReachability({
      url: "https://cdn.example/v.mp4",
      fetchImpl: async () => response(200),
      lookupImpl: () => {
        controller.abort();
        return new Promise(() => {});
      },
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    expect(probe).toEqual({ status: "timeout" });
  });

  test("each redirect hop resolves and pins its own hostname", async () => {
    const seen: { url: string; host: string | null }[] = [];
    const lookedUp: string[] = [];
    const answers = new Map([
      ["one.example", "93.184.216.34"],
      ["two.example", "1.1.1.1"],
    ]);

    const probe = await probeStreamReachability({
      url: "https://one.example/a.mp4",
      fetchImpl: async (url, init) => {
        seen.push({ url, host: new Headers(init?.headers).get("host") });
        if (seen.length === 1) {
          return response(302, "", { location: "https://two.example/b.mp4" });
        }
        return response(200);
      },
      lookupImpl: async (host) => {
        lookedUp.push(host);
        return [answers.get(host) ?? "93.184.216.34"];
      },
      timeoutMs: 200,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(lookedUp).toEqual(["one.example", "two.example"]);
    expect(seen.map((s) => s.url)).toEqual([
      "https://93.184.216.34/a.mp4",
      "https://1.1.1.1/b.mp4",
    ]);
    expect(seen.map((s) => s.host)).toEqual(["one.example", "two.example"]);
  });

  test("an injected fetch without lookupImpl keeps its URLs untouched", async () => {
    const seen: string[] = [];
    const probe = await probeStreamReachability({
      url: "https://cdn.example/v.mp4",
      fetchImpl: async (url) => {
        seen.push(url);
        return response(200);
      },
      timeoutMs: 100,
    });

    expect(probe).toEqual({ status: "reachable" });
    expect(seen).toEqual(["https://cdn.example/v.mp4"]);
  });
});

describe("guarded stream fetches", () => {
  test("a real resolver delay still reaches the pinned fetch", async () => {
    const seen: { url: string; init: PinnedInit }[] = [];

    // `dns.lookup` sits on a threadpool and never answers in ~1ms — a lookup
    // with real latency must not lose the deadline race to a stub budget.
    const outcome = await fetchGuardedStreamTarget({
      fetchImpl: async (url, init) => {
        // SAFETY: RequestInit does not declare Bun's `tls`/`proxy` fields; the
        // assertion only exposes what the pin wrote onto the live init.
        seen.push({ url, init: init as PinnedInit });
        return response(200, "#EXTM3U\n");
      },
      url: "https://cdn.example/master.m3u8",
      init: {},
      timeoutMs: 5_000,
      lookupImpl: async () => {
        await Bun.sleep(50);
        return ["93.184.216.34"];
      },
    });

    expect(outcome.kind).toBe("response");
    expect(seen[0]?.url).toBe("https://93.184.216.34/master.m3u8");
    expect(new Headers(seen[0]?.init.headers).get("host")).toBe("cdn.example");
  });

  test("the shared budget still bounds a hung resolver", async () => {
    const outcome = await fetchGuardedStreamTarget({
      fetchImpl: async () => response(200),
      url: "https://cdn.example/master.m3u8",
      init: {},
      timeoutMs: 40,
      lookupImpl: async () => {
        await Bun.sleep(5_000);
        return ["93.184.216.34"];
      },
    });

    expect(outcome.kind).toBe("timeout");
  });
});

describe("probeLookupForPort", () => {
  test("undefined means the global fetch, which resolves locally", () => {
    expect(probeLookupForPort(undefined)).toBe(systemDnsLookup);
  });

  test("a port that resolves locally gets the system lookup", () => {
    expect(probeLookupForPort({ resolvesLocally: true })).toBe(systemDnsLookup);
  });

  test("ports that do not resolve locally get no local pinning", () => {
    expect(probeLookupForPort({ resolvesLocally: false })).toBeUndefined();
    expect(probeLookupForPort({})).toBeUndefined();
  });
});

describe("blocked literal addresses", () => {
  test("6to4 and teredo unwrap to the embedded private IPv4", () => {
    expect(blockedLiteralAddressReason("2002:a9fe:a9fe::")).toContain("private");
    expect(blockedLiteralAddressReason("2001:0::5601:5601")).toContain("private");
    expect(blockedLiteralAddressReason("::ffff:169.254.169.254")).toContain("private");
    expect(blockedLiteralAddressReason("1.1.1.1")).toBeNull();
  });
});
