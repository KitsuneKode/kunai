import { expect, test } from "bun:test";

import { handleRpcRequest } from "../src/handler";
import { buildProviderRelayRegistry } from "../src/registry";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relaySafe: true,
      relayProfile: {
        upstreamHosts: ["api.allanime.day"],
        maxRequestBodyBytes: 128,
        maxResponseBodyBytes: 256,
      },
    },
  },
  {
    providerId: "miruro",
    manifest: {
      relaySafe: true,
      relayProfile: {
        upstreamHosts: ["miruro.bz"],
      },
    },
  },
  {
    providerId: "videasy",
    manifest: {
      relaySafe: false,
      relayProfile: {
        upstreamHosts: ["api.videasy.to"],
      },
    },
  },
] as never);

test("handleRpcRequest forwards allowed metadata requests", async () => {
  let upstreamAuth: string | null = null;
  const response = await handleRpcRequest(
    rpcRequest({
      method: "POST",
      upstreamUrl: "https://api.allanime.day/api?x=1",
      headers: {
        Authorization: "Bearer should-not-forward",
        "Content-Type": "application/json",
        Referer: "https://youtu-chan.com",
      },
      body: '{"ok":true}',
    }),
    {
      providerId: "allanime",
      registry,
      token: "secret",
      async fetch(_url, init) {
        upstreamAuth = new Headers(init?.headers).get("authorization");
        return Response.json({ ok: true }, { status: 201 });
      },
    },
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true });
  expect(upstreamAuth).toBeNull();
});

test("handleRpcRequest rejects provider confusion", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://miruro.bz/api",
    }),
    {
      providerId: "allanime",
      registry,
      async fetch() {
        throw new Error("should not fetch");
      },
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
});

test("handleRpcRequest validates redirects before following them", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry,
      async fetch() {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://miruro.bz/api" },
        });
      },
    },
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: "redirect-not-allowed" } });
});

test("handleRpcRequest rejects oversized upstream request bodies", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "POST",
      upstreamUrl: "https://api.allanime.day/api",
      body: "x".repeat(129),
    }),
    { providerId: "allanime", registry },
  );

  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ error: { code: "body-too-large" } });
});

test("handleRpcRequest rejects unsafe upstream hosts before fetch", async () => {
  const unsafeRegistry = buildProviderRelayRegistry([
    {
      providerId: "unsafe",
      manifest: {
        relaySafe: true,
        relayProfile: {
          upstreamHosts: ["127.0.0.1"],
        },
      },
    },
  ] as never);

  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "http://127.0.0.1/api",
    }),
    {
      providerId: "unsafe",
      registry: unsafeRegistry,
      async fetch() {
        throw new Error("should not fetch");
      },
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
});

/**
 * `::ffff:169.254.169.254` is the cloud metadata endpoint wearing an IPv6 coat.
 * WHATWG normalizes it to the hex form `[::ffff:a9fe:a9fe]`, which matched none
 * of the literal IPv6 prefixes, so the private-host guard waved it through.
 *
 * The allowlist stops it in production — an IPv6 literal never matches a
 * provider host — but this guard is the backstop *to* the allowlist, so it has
 * to hold on its own. Each host below is deliberately allowlisted, which is
 * what proves the guard runs first.
 */
test.each([
  ["ipv4-mapped metadata", "[::ffff:a9fe:a9fe]", "http://[::ffff:169.254.169.254]/latest/"],
  ["ipv4-mapped loopback", "[::ffff:7f00:1]", "http://[::ffff:127.0.0.1]/"],
  ["link-local fe90", "[fe90::1]", "http://[fe90::1]/"],
  ["link-local feb0", "[feb0::1]", "http://[feb0::1]/"],
  ["cgnat lower bound", "100.64.0.1", "http://100.64.0.1/"],
  ["cgnat upper bound", "100.127.255.254", "http://100.127.255.254/"],
  ["this-network 0.0.0.0/8", "0.1.2.3", "http://0.1.2.3/"],
])("handleRpcRequest rejects %s even when allowlisted", async (_label, host, upstreamUrl) => {
  const unsafeRegistry = buildProviderRelayRegistry([
    {
      providerId: "unsafe",
      manifest: { relaySafe: true, relayProfile: { upstreamHosts: [host] } },
    },
  ] as never);

  const response = await handleRpcRequest(rpcRequest({ method: "GET", upstreamUrl }), {
    providerId: "unsafe",
    registry: unsafeRegistry,
    async fetch() {
      throw new Error("should not fetch");
    },
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
});

/**
 * The other half of widening a denylist: the ranges just outside each new one
 * are ordinary public addresses, and a provider CDN that lands on one must
 * still work. Broadening `fe80:` to `fe[89ab]` and adding CGNAT and 0.0.0.0/8
 * are each one digit away from over-blocking.
 */
test.each([
  ["site-local fec0, outside fe80::/10", "[fec0::1]", "http://[fec0::1]/rpc"],
  ["public IPv6", "[2606:4700::1111]", "http://[2606:4700::1111]/rpc"],
  ["just below CGNAT", "100.63.255.255", "http://100.63.255.255/rpc"],
  ["just above CGNAT", "100.128.0.1", "http://100.128.0.1/rpc"],
  ["just outside 172.16/12", "172.32.0.1", "http://172.32.0.1/rpc"],
  ["ipv4-mapped public", "[::ffff:808:808]", "http://[::ffff:8.8.8.8]/rpc"],
])("handleRpcRequest still reaches %s", async (_label, host, upstreamUrl) => {
  const registry = buildProviderRelayRegistry([
    {
      providerId: "public",
      manifest: { relaySafe: true, relayProfile: { upstreamHosts: [host] } },
    },
  ] as never);

  let fetched = false;
  const response = await handleRpcRequest(rpcRequest({ method: "GET", upstreamUrl }), {
    providerId: "public",
    registry,
    async fetch() {
      fetched = true;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  expect(fetched).toBe(true);
  expect(response.status).toBe(200);
});

test("handleRpcRequest rejects IPv6 loopback and unique-local literals even when allowlisted", async () => {
  const unsafeRegistry = buildProviderRelayRegistry([
    {
      providerId: "unsafe6",
      manifest: {
        relaySafe: true,
        relayProfile: {
          // WHATWG URL keeps brackets on IPv6 hostnames, so a manifest author
          // copying a hostname would plausibly write the bracketed form.
          upstreamHosts: ["[::1]", "[fd00::1]"],
        },
      },
    },
  ] as never);

  for (const upstreamUrl of ["http://[::1]/api", "http://[fd00::1]/api"]) {
    const response = await handleRpcRequest(rpcRequest({ method: "GET", upstreamUrl }), {
      providerId: "unsafe6",
      registry: unsafeRegistry,
      async fetch() {
        throw new Error("should not fetch");
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
  }
});

test("handleRpcRequest rejects oversized upstream metadata responses", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry,
      async fetch() {
        return new Response("x".repeat(257), {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: "response-too-large" } });
});

test("handleRpcRequest does not read or return a body for HEAD responses", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "HEAD",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry,
      async fetch(_url, init) {
        expect(init?.method).toBe("HEAD");
        return new Response("should not be relayed", {
          status: 204,
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
  );

  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
});

test("handleRpcRequest strips upstream set-cookie from metadata responses", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry,
      async fetch() {
        return Response.json(
          { ok: true },
          {
            headers: {
              "Set-Cookie": "session=secret",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true });
});

test("handleRpcRequest enforces bearer token when configured", async () => {
  const response = await handleRpcRequest(
    rpcRequest(
      {
        method: "GET",
        upstreamUrl: "https://api.allanime.day/api",
      },
      null,
    ),
    { providerId: "allanime", registry, token: "secret" },
  );

  expect(response.status).toBe(401);
});

test("handleRpcRequest refuses a provider whose manifest is not relay-safe", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.videasy.to/api",
    }),
    {
      providerId: "videasy",
      registry,
      async fetch() {
        throw new Error("should not fetch");
      },
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "provider-not-relayable" } });
});

test("handleRpcRequest handles CORS preflight without upstream fetch", async () => {
  const response = await handleRpcRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "OPTIONS",
    }),
    {
      providerId: "allanime",
      registry,
    },
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-methods")).toContain("POST");
});

function rpcRequest(body: unknown, token: string | null = "secret"): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("https://relay.test/rpc/allanime", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
