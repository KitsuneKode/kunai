import { describe, expect, test } from "bun:test";

import { ProviderHttpError, type LooseJsonValue, type ProviderRuntimeContext } from "@kunai/types";

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

    expect(manifest.name).toBe("Example");
    expect(context.requested).toEqual([`https://addon.example.com/${TOKEN}/manifest.json`]);
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
      url.startsWith("https://addon.example.com")
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

  test("a transport error keeps its cause but not the URL", async () => {
    const context = contextWith(() => {
      throw new Error(`connect ECONNRESET https://addon.example.com/${TOKEN}/manifest.json`);
    });

    const error = await failure(fetchStremioManifest(addonRef(), { context }));

    expect(error.code).toBe("network-error");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("ECONNRESET");
    expect(error.message).not.toContain(TOKEN);
  });

  test("a caller's cancellation is rethrown as theirs, not reported as an addon fault", async () => {
    const controller = new AbortController();
    const context = contextWith((_url, init) => {
      controller.abort();
      init.signal?.throwIfAborted();
      return json(VALID_MANIFEST);
    });

    let thrown: unknown;
    try {
      await fetchStremioManifest(addonRef(), { context, signal: controller.signal });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown).not.toBeInstanceOf(ProviderHttpError);
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
