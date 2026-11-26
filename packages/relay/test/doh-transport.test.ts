import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import type { DohAddress, DohResolver } from "@kunai/core";

import { createRelayFetchPort } from "../src/create-relay-fetch-port";
import { createDohFetch } from "../src/doh-transport";
import { buildProviderRelayRegistry } from "../src/registry";
import type { RelayTransport } from "../src/types";

const PUBLIC: readonly DohAddress[] = [{ address: "93.184.216.34", family: 4 }];

function resolverOf(
  answer: (host: string) => readonly DohAddress[] | null,
): DohResolver & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolve: async (host) => {
      asked.push(host);
      return answer(host);
    },
    stats: () => ({ mode: "doh", answered: 0, systemFallbacks: 0 }),
  };
}

type FakeReply = {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer;
};

type Dial = {
  readonly answers: readonly DohAddress[];
  readonly url: string;
  readonly headers: Headers;
};

/** Stands in for the pinned transport: records what was dialled, replies per URL. */
function transport(reply: (url: URL) => FakeReply) {
  const dialled: Dial[] = [];
  const createTransport =
    (answers: readonly DohAddress[]): RelayTransport =>
    async (input, init) => {
      const url = new URL(String(input));
      dialled.push({ answers, url: url.href, headers: new Headers(init?.headers) });
      const { status = 200, headers = {}, body = "ok" } = reply(url);
      const payload = Buffer.isBuffer(body) ? Uint8Array.from(body).buffer : body;
      return new Response(status >= 300 && status < 400 ? null : payload, { status, headers });
    };
  return { dialled, createTransport };
}

function nativeSpy() {
  const calls: string[] = [];
  const fetch = async (input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response("native");
  };
  return { calls, fetch };
}

function dohWith(net: ReturnType<typeof transport>, resolver = resolverOf(() => PUBLIC)) {
  return createDohFetch({ resolver, createTransport: net.createTransport, env: {} });
}

describe("createDohFetch", () => {
  test("dials the DoH answer for the request's own URL", async () => {
    const net = transport(() => ({ body: "metadata" }));
    const response = await dohWith(net)("https://api.example.com/v1/x?y=1");
    expect(await response.text()).toBe("metadata");
    expect(net.dialled[0]).toMatchObject({
      answers: PUBLIC,
      url: "https://api.example.com/v1/x?y=1",
    });
    expect(response.url).toBe("https://api.example.com/v1/x?y=1");
  });

  test("local names, literals and proxied requests never touch the resolver", async () => {
    const resolver = resolverOf(() => PUBLIC);
    const native = nativeSpy();
    const doh = createDohFetch({ resolver, baseFetch: native.fetch, env: {} });
    await doh("http://127.0.0.1:7000/manifest.json");
    await doh("http://nas.lan/addon/manifest.json");
    const proxied = createDohFetch({
      resolver,
      baseFetch: native.fetch,
      env: { HTTPS_PROXY: "http://proxy:3128" },
    });
    await proxied("https://api.example.com/x");
    expect(resolver.asked).toEqual([]);
    expect(native.calls).toHaveLength(3);
  });

  test("no DoH answer means system DNS, exactly as before", async () => {
    const native = nativeSpy();
    const doh = createDohFetch({
      resolver: resolverOf(() => null),
      baseFetch: native.fetch,
      env: {},
    });
    expect(await (await doh("https://api.example.com/x")).text()).toBe("native");
  });

  test("the default transport refuses a private answer, which falls back to system DNS", async () => {
    // No transport seam: this exercises the real pinned transport's address check.
    const native = nativeSpy();
    const doh = createDohFetch({
      resolver: resolverOf(() => [{ address: "10.0.0.8", family: 4 }]),
      baseFetch: native.fetch,
      env: {},
    });
    expect(await (await doh("https://split.example.com/x")).text()).toBe("native");
  });

  test("follows redirects hop by hop, re-resolving each host, and reports the final url", async () => {
    const resolver = resolverOf(() => PUBLIC);
    const net = transport((url) =>
      url.pathname === "/start"
        ? { status: 302, headers: { location: "https://cdn.example.net/final" } }
        : { body: "landed" },
    );
    const response = await dohWith(net, resolver)("https://api.example.com/start", {
      headers: { authorization: "Bearer secret", cookie: "a=b" },
    });
    expect(await response.text()).toBe("landed");
    expect(response.url).toBe("https://cdn.example.net/final");
    expect(response.redirected).toBe(true);
    expect(resolver.asked).toEqual(["api.example.com", "cdn.example.net"]);
    // Credentials do not follow a cross-origin redirect.
    expect(net.dialled[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(net.dialled[1]?.headers.get("authorization")).toBeNull();
    expect(net.dialled[1]?.headers.get("cookie")).toBeNull();
  });

  test('redirect: "manual" returns the 3xx untouched', async () => {
    const net = transport(() => ({ status: 301, headers: { location: "/elsewhere" } }));
    const response = await dohWith(net)("https://api.example.com/x", { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/elsewhere");
    expect(net.dialled).toHaveLength(1);
  });

  test('redirect: "error" rejects instead of following', async () => {
    const net = transport(() => ({ status: 302, headers: { location: "/elsewhere" } }));
    await expect(dohWith(net)("https://api.example.com/x", { redirect: "error" })).rejects.toThrow(
      "Redirect",
    );
  });

  test("a redirect that names an encoding over no body is still followed", async () => {
    const net = transport((url) =>
      url.pathname === "/x"
        ? { status: 302, headers: { location: "/y", "content-encoding": "gzip" } }
        : { body: "landed" },
    );
    const response = await dohWith(net)("https://api.example.com/x");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("landed");
  });

  test("a redirect off the web (file:, data:) is refused, never handed to fetch", async () => {
    for (const location of ["file:///etc/passwd", "data:text/plain,hi"]) {
      const net = transport(() => ({ status: 302, headers: { location } }));
      await expect(dohWith(net)("https://api.example.com/x")).rejects.toThrow("Redirect to a");
    }
  });

  test("decodes gzip the way fetch would", async () => {
    const net = transport(() => ({
      headers: { "content-encoding": "gzip" },
      body: gzipSync(Buffer.from('{"ok":true}')),
    }));
    const response = await dohWith(net)("https://api.example.com/x");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("relay fetch port DNS split", () => {
  const registry = buildProviderRelayRegistry([]);

  test("without a resolver the port uses system DNS for everything", async () => {
    const native = nativeSpy();
    const port = createRelayFetchPort({ relayConfig: undefined, registry, fetch: native.fetch });
    await port.fetch("https://api.example.com/x");
    await port.probeFetch?.("https://cdn.example.net/seg.ts");
    expect(native.calls).toEqual(["https://api.example.com/x", "https://cdn.example.net/seg.ts"]);
  });

  test("metadata uses DoH while probes resolve the way the player does", async () => {
    const resolver = resolverOf(() => null);
    const native = nativeSpy();
    const port = createRelayFetchPort({
      relayConfig: undefined,
      registry,
      fetch: native.fetch,
      dohResolver: resolver,
    });
    await port.fetch("https://api.example.com/x");
    await port.probeFetch?.("https://cdn.example.net/seg.ts");
    expect(resolver.asked).toEqual(["api.example.com"]);
  });
});
