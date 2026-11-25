import { describe, expect, test } from "bun:test";

import { ProviderHttpError, type LooseJsonValue, type ProviderRuntimeContext } from "@kunai/types";

import { fetchRemoteSubtitle } from "../src/shared/remote-subtitle";
import { parseStremioAddonUrl } from "../src/stremio-addon/addon-url";
import { fetchStremioManifest, fetchStremioStreams } from "../src/stremio-addon/client";
import { STREMIO_ADDON_LIMITS } from "../src/stremio-addon/protocol";

const TOKEN = "SECRETTOKEN";

function addonRef() {
  const result = parseStremioAddonUrl(`https://addon.example.com/${TOKEN}/manifest.json`);
  if (!result.ok) throw new Error(result.reason);
  return result.addon;
}

function contextWith(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  extra: Partial<ProviderRuntimeContext> = {},
): ProviderRuntimeContext & { readonly requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    now: () => new Date().toISOString(),
    fetch: {
      runtime: "direct-http",
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        requested.push(url);
        return respond(url, init ?? {});
      },
    },
    ...extra,
  };
}

const json = (body: LooseJsonValue, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });

const VALID_MANIFEST = {
  id: "org.example",
  name: "Example",
  version: "1.0.0",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
};

async function failure(run: Promise<unknown>): Promise<ProviderHttpError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ProviderHttpError) return error;
    throw error;
  }
  throw new Error("expected the request to be refused");
}

describe("addon manifest request", () => {
  test("fetches manifest.json and returns the validated manifest", async () => {
    const context = contextWith(() => json(VALID_MANIFEST));

    const manifest = await fetchStremioManifest(addonRef(), { context });

    expect(manifest.name).toBe("addon @ addon.example.com");
    expect(manifest.version).toBeUndefined();
    expect(context.requested).toEqual([`https://addon.example.com/${TOKEN}/manifest.json`]);
  });

  test("an unconfigured root manifest keeps its sanitized name and version", async () => {
    const context = contextWith(() => json(VALID_MANIFEST));
    const root = parseStremioAddonUrl("https://addon.example.com/manifest.json");
    if (!root.ok) throw new Error(root.reason);

    const manifest = await fetchStremioManifest(root.addon, { context });

    expect(manifest.name).toBe("Example");
    expect(manifest.version).toBe("1.0.0");
  });

  test("a manifest that fails the schema is refused, naming fields but not values", async () => {
    const context = contextWith(() => json({ id: "org.example", name: 7, resources: [] }));

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("parse-failed");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("name");
    expect(error.message).not.toContain(TOKEN);
  });

  test("a body that is not JSON is refused", async () => {
    const context = contextWith(() => new Response("<html>challenge</html>"));

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("parse-failed");
    expect(error.message).toBe("Addon at addon.example.com did not answer with JSON");
  });

  test("an HTTP error carries its status and never the addon's path", async () => {
    const context = contextWith(() => new Response("nope", { status: 429 }));

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.status).toBe(429);
    expect(error.code).toBe("rate-limited");
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain(TOKEN);
  });

  test("a declared length past the limit is refused before the body is read", async () => {
    const context = contextWith(
      () =>
        new Response("{}", {
          headers: { "content-length": String(STREMIO_ADDON_LIMITS.manifestBytes + 1) },
        }),
    );

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("parse-failed");
    expect(error.message).toContain("more than 512 KiB");
  });

  test("a body that runs past the limit without declaring it is refused", async () => {
    const oversized = JSON.stringify({
      ...VALID_MANIFEST,
      description: "x".repeat(STREMIO_ADDON_LIMITS.manifestBytes),
    });
    const context = contextWith(() => new Response(oversized));

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.message).toContain("more than 512 KiB");
  });

  test("a redirect to plain HTTP is refused before it is sent", async () => {
    const context = contextWith((url) =>
      new URL(url).origin === "https://addon.example.com"
        ? new Response(null, {
            status: 302,
            headers: { location: "http://other.example.com/manifest.json" },
          })
        : json(VALID_MANIFEST),
    );

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("blocked");
    expect(error.message).toContain("not HTTPS");
    expect(context.requested).toHaveLength(1);
  });

  test("a redirect to a private address is refused before it is sent", async () => {
    const context = contextWith(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        }),
    );

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("blocked");
    expect(error.message).toContain("local or private address");
    expect(context.requested).toHaveLength(1);
  });

  test("a host whose DNS answer is private is refused without a request", async () => {
    const context = contextWith(() => json(VALID_MANIFEST));
    const port = context.fetch;
    if (!port) throw new Error("fixture has no fetch port");
    const locallyResolved = { ...context, fetch: { ...port, resolvesLocally: () => true } };

    const error = await failure(
      fetchStremioManifest(addonRef(), {
        context: locallyResolved,
        resolveAddresses: async () => ["10.0.0.5"],
      }),
    );

    expect(error.code).toBe("blocked");
    expect(context.requested).toEqual([]);
  });

  test("a host that does not resolve is a network failure, not a refusal", async () => {
    const context = contextWith(() => json(VALID_MANIFEST));
    const port = context.fetch;
    if (!port) throw new Error("fixture has no fetch port");

    const error = await failure(
      fetchStremioManifest(addonRef(), {
        context: { ...context, fetch: { ...port, resolvesLocally: () => true } },
        resolveAddresses: async () => [],
      }),
    );

    expect(error.code).toBe("network-error");
    expect(error.message).toContain("ENOTFOUND");
  });

  test("a transport error keeps its code but never the URL or its path token", async () => {
    const context = contextWith(() => {
      throw new Error(`connect ECONNRESET https://addon.example.com/${TOKEN}/manifest.json`);
    });

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("network-error");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("addon.example.com");
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain("/manifest.json");
    expect(error.cause).toBeUndefined();
  });

  test("a thrown error carrying the token in its own message is not relayed", async () => {
    const context = contextWith(() => {
      // Object.assign builds a Node-style errno Error without a cast.
      const error = Object.assign(
        new Error(`read ECONNRESET for https://other.example/${TOKEN}?sig=${TOKEN}`),
        { code: "ECONNRESET" },
      );
      throw error;
    });

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("network-error");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("addon.example.com");
    expect(error.message).not.toContain(TOKEN);
    expect(error.cause).toBeUndefined();
  });

  test("cancelling while the host name resolves still settles the request", async () => {
    const controller = new AbortController();
    const context = contextWith(() => json(VALID_MANIFEST));
    const port = context.fetch;
    if (!port) throw new Error("fixture has no fetch port");
    let resolverEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolverEntered = resolve;
    });

    const settled = fetchStremioManifest(addonRef(), {
      context: { ...context, fetch: { ...port, resolvesLocally: () => true } },
      signal: controller.signal,
      resolveAddresses: () => {
        resolverEntered();
        return new Promise<readonly string[]>(() => {});
      },
    }).then(
      () => "resolved" as const,
      (error: ProviderHttpError | Error) => error,
    );

    await entered;
    controller.abort();
    // The request must settle on its own within a bounded number of microtask
    // turns — a lookup that never answers cannot hold it open.
    const outcome = await Promise.race([
      settled,
      (async () => {
        for (let turn = 0; turn < 50; turn++) await Promise.resolve();
        return "pending" as const;
      })(),
    ]);

    expect(outcome).not.toBe("pending");
    // The caller's own abort reason surfaces — it is not an addon timeout.
    expect(outcome).toBe(controller.signal.reason);
    expect(context.requested).toEqual([]);
  });

  test("a DNS answer that lands after cancel is never dispatched", async () => {
    const controller = new AbortController();
    const context = contextWith(() => json(VALID_MANIFEST));
    const port = context.fetch;
    if (!port) throw new Error("fixture has no fetch port");
    let resolverEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      resolverEntered = resolve;
    });
    let answerLookup!: (addresses: readonly string[]) => void;

    const settled = fetchStremioManifest(addonRef(), {
      context: { ...context, fetch: { ...port, resolvesLocally: () => true } },
      signal: controller.signal,
      resolveAddresses: () => {
        resolverEntered();
        return new Promise<readonly string[]>((resolve) => {
          answerLookup = resolve;
        });
      },
    }).then(
      () => "resolved" as const,
      (error: ProviderHttpError | Error) => error,
    );

    await entered;
    controller.abort();
    answerLookup(["93.184.216.34"]);
    const outcome = await Promise.race([
      settled,
      (async () => {
        for (let turn = 0; turn < 50; turn++) await Promise.resolve();
        return "pending" as const;
      })(),
    ]);

    expect(outcome).not.toBe("pending");
    expect(context.requested).toEqual([]);
  });

  test("a caller's cancellation is rethrown as theirs, not reported as an addon fault", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const context = contextWith(() => {
      controller.abort(reason);
      throw new Error("transport cancellation");
    });

    await expect(
      fetchStremioManifest(addonRef(), { context, signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  test("a distinct context signal cancels the request too — caller and context compose", async () => {
    const contextController = new AbortController();
    const caller = new AbortController();
    const reason = new Error("context cancelled");
    const context = contextWith(
      (_url, init) => {
        contextController.abort(reason);
        init.signal?.throwIfAborted();
        return json(VALID_MANIFEST);
      },
      { signal: contextController.signal },
    );

    await expect(fetchStremioManifest(addonRef(), { context, signal: caller.signal })).rejects.toBe(
      reason,
    );
  });

  test("a declared-oversize streamed manifest body is cancelled without being pulled", async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled += 1;
          c.enqueue(new TextEncoder().encode(JSON.stringify(VALID_MANIFEST)));
          c.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const context = contextWith(
      () =>
        new Response(body, {
          headers: { "content-length": String(STREMIO_ADDON_LIMITS.manifestBytes + 1) },
        }),
    );

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.message).toContain("more than 512 KiB");
    expect(pulled).toBe(0);
    expect(cancelled).toBe(true);
  });
});

describe("addon stream request", () => {
  test("asks the stream resource and hands back the raw entries", async () => {
    const context = contextWith(() =>
      json({ streams: [{ url: "https://cdn.example.com/a.mp4" }, { infoHash: "abc" }] }),
    );

    const listing = await fetchStremioStreams(addonRef(), "series", "tt0944947:1:2", { context });

    expect(context.requested).toEqual([
      `https://addon.example.com/${TOKEN}/stream/series/tt0944947%3A1%3A2.json`,
    ]);
    expect(listing.entries).toHaveLength(2);
    expect(listing.truncated).toBe(0);
  });

  test("entries past the per-response limit are counted, not read", async () => {
    const streams = Array.from(
      { length: STREMIO_ADDON_LIMITS.streamsPerResponse + 7 },
      (_, index) => ({ url: `https://cdn.example.com/${index}.mp4` }),
    );
    const context = contextWith(() => json({ streams }));

    const listing = await fetchStremioStreams(addonRef(), "movie", "tt1375666", { context });

    expect(listing.entries).toHaveLength(STREMIO_ADDON_LIMITS.streamsPerResponse);
    expect(listing.truncated).toBe(7);
  });

  test("an envelope without a streams array is refused", async () => {
    const context = contextWith(() => json({ error: "bad token" }));

    const error = await failure(fetchStremioStreams(addonRef(), "movie", "tt1375666", { context }));

    expect(error.code).toBe("parse-failed");
    expect(error.message).toContain("streams");
  });
});

describe("fetchRemoteSubtitle (guarded download)", () => {
  const SRT = "1\n00:00:01,000 --> 00:00:02,000\nhello\n";
  const VTT = "WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n";

  function fetchLogging(respond: (url: string) => Response | Promise<Response>) {
    const requested: string[] = [];
    // StreamReachabilityFetch already hands the pinned URL string over.
    const impl = async (url: string) => {
      requested.push(url);
      return respond(url);
    };
    return { requested, impl };
  }

  test("private DNS answer blocks the request before fetch is called", async () => {
    const { requested, impl } = fetchLogging(() => new Response(SRT));
    const file = await fetchRemoteSubtitle("https://subs.example.com/en.srt", {
      fetchImpl: impl,
      resolveAddresses: async () => ["10.0.0.5"],
    });
    expect(file).toBeNull();
    expect(requested).toEqual([]);
  });

  test("redirect to a private target is re-checked per hop and refused", async () => {
    const { requested, impl } = fetchLogging((url) => {
      // The guard pins the host to the vetted address on the wire.
      if (url === "https://93.184.216.34/en.srt") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.com/x.srt" },
        });
      }
      return new Response(SRT);
    });
    const file = await fetchRemoteSubtitle("https://subs.example.com/en.srt", {
      fetchImpl: impl,
      resolveAddresses: async (host) =>
        host === "subs.example.com" ? ["93.184.216.34"] : ["10.0.0.5"],
    });
    expect(file).toBeNull();
    // The private redirect target is refused before a second request exists.
    expect(requested).toEqual(["https://93.184.216.34/en.srt"]);
  });

  test("oversized body is dropped", async () => {
    const { impl } = fetchLogging(() => new Response(SRT.repeat(200_000)));
    const file = await fetchRemoteSubtitle("https://subs.example.com/big.srt", {
      fetchImpl: impl,
      resolveAddresses: async () => ["93.184.216.34"],
    });
    expect(file).toBeNull();
  });

  test("non-subtitle body is dropped", async () => {
    const { impl } = fetchLogging(() => new Response("<html><body>404</body></html>"));
    const file = await fetchRemoteSubtitle("https://subs.example.com/nope", {
      fetchImpl: impl,
      resolveAddresses: async () => ["93.184.216.34"],
    });
    expect(file).toBeNull();
  });

  test("valid SRT yields srt; valid WebVTT yields vtt; extension comes from body", async () => {
    const srtFetch = fetchLogging(() => new Response(SRT));
    expect(
      await fetchRemoteSubtitle("https://subs.example.com/track.bin", {
        fetchImpl: srtFetch.impl,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).toEqual({ text: SRT, extension: "srt" });
    const vttFetch = fetchLogging(() => new Response(VTT));
    expect(
      await fetchRemoteSubtitle("https://subs.example.com/track", {
        fetchImpl: vttFetch.impl,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).toEqual({ text: VTT, extension: "vtt" });
  });

  test("a declared-oversize SRT is dropped unread; the same SRT undeclared passes", async () => {
    const declared = fetchLogging(
      () => new Response(SRT, { headers: { "content-length": String(513 * 1024) } }),
    );
    expect(
      await fetchRemoteSubtitle("https://subs.example.com/en.srt", {
        fetchImpl: declared.impl,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).toBeNull();

    const plain = fetchLogging(() => new Response(SRT));
    expect(
      await fetchRemoteSubtitle("https://subs.example.com/en.srt", {
        fetchImpl: plain.impl,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).toEqual({ text: SRT, extension: "srt" });
  });

  test("non-2xx is refused", async () => {
    const { impl } = fetchLogging(() => new Response("nope", { status: 404 }));
    expect(
      await fetchRemoteSubtitle("https://subs.example.com/en.srt", {
        fetchImpl: impl,
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).toBeNull();
  });
});

test("a declared Content-Length over the cap is refused", async () => {
  const impl = async (_url: string) =>
    new Response("x".repeat(1024), {
      headers: { "content-length": String(600 * 1024) },
    });
  expect(
    await fetchRemoteSubtitle("https://subs.example.com/big.srt", {
      fetchImpl: impl,
      resolveAddresses: async () => ["93.184.216.34"],
    }),
  ).toBeNull();
});

test("subtitle headers stay on their authorized origin through redirects", async () => {
  const requests: Array<{ host: string | null; origin: string | null; cookie: string | null }> = [];
  const options = {
    media: {
      url: "https://hls.krussdomi.com/master.m3u8",
      headers: { Origin: "https://player.example", Cookie: "media-only" },
    },
    resolveAddresses: async () => ["93.184.216.34"],
    fetchImpl: async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      requests.push({
        host: headers.get("host"),
        origin: headers.get("origin"),
        cookie: headers.get("cookie"),
      });
      if (url.endsWith("/en.vtt")) {
        return Response.redirect("https://subst.krussdomi.com/second.vtt");
      }
      if (url.endsWith("/second.vtt")) {
        return Response.redirect("https://cdn.example/final.vtt");
      }
      return new Response("WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n");
    },
  };
  expect(await fetchRemoteSubtitle("https://subst.krussdomi.com/en.vtt", options)).not.toBeNull();
  expect(requests).toEqual([
    { host: "subst.krussdomi.com", origin: "https://player.example", cookie: null },
    { host: "subst.krussdomi.com", origin: "https://player.example", cookie: null },
    { host: "cdn.example", origin: null, cookie: null },
  ]);
});

test("caller cancellation releases a pending subtitle body", async () => {
  const controller = new AbortController();
  const reading = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const result = fetchRemoteSubtitle("https://subs.example.com/en.vtt", {
    signal: controller.signal,
    resolveAddresses: async () => ["93.184.216.34"],
    fetchImpl: async () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull() {
              reading.resolve();
            },
            cancel() {
              cancelled.resolve();
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  });
  await reading.promise;
  controller.abort();
  expect(await result).toBeNull();
  await cancelled.promise;
});
