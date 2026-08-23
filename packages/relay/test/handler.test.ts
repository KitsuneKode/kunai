import { expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";

import type { CoreProviderManifest } from "@kunai/core";

import { handleRpcRequest } from "../src/handler";
import { createPinnedRelayTransport, type RelayNodeRequest } from "../src/pinned-transport";
import { buildProviderRelayRegistry } from "../src/registry";
import type { RelayAuthorizationPolicy } from "../src/types";

const localLoopbackAuthorization = {
  mode: "local-loopback",
} satisfies RelayAuthorizationPolicy;

const providerRegistry = buildProviderRelayRegistry([
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

const redirectProbeManifest = {
  id: "redirect-probe",
  displayName: "Redirect probe",
  description: "Exercises relay redirect semantics",
  domain: "redirect.example",
  recommended: false,
  mediaKinds: ["movie"],
  capabilities: [],
  runtimePorts: [],
  cachePolicy: {
    ttlClass: "provider-metadata",
    scope: "memory",
    keyParts: ["redirect-probe"],
  },
  browserSafe: false,
  relaySafe: true,
  relayProfile: {
    upstreamHosts: ["redirect.example"],
    defaultHeaders: {
      "Content-Encoding": "identity",
      "Content-Language": "en",
      "Content-Length": "11",
      "Content-Location": "/payload",
      "Content-Type": "application/json",
    },
  },
  status: "experimental",
} satisfies CoreProviderManifest;

const redirectRegistry = buildProviderRelayRegistry([
  { providerId: redirectProbeManifest.id, manifest: redirectProbeManifest },
]);

test("handleRpcRequest forwards allowed metadata requests", async () => {
  let upstreamAuth: string | null = null;
  const response = await handleRpcRequest(
    rpcRequest(
      {
        method: "POST",
        upstreamUrl: "https://api.allanime.day/api?x=1",
        headers: {
          Authorization: "Bearer should-not-forward",
          "Content-Type": "application/json",
          Referer: "https://youtu-chan.com",
        },
        body: '{"ok":true}',
      },
      null,
    ),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
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
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
    },
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
      authorization: localLoopbackAuthorization,
      async transport() {
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
    authorization: localLoopbackAuthorization,
    async transport() {
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
  ["public IPv6", "[2606:4700::1111]", "http://[2606:4700::1111]/rpc"],
  ["just below CGNAT", "100.63.255.255", "http://100.63.255.255/rpc"],
  ["just above CGNAT", "100.128.0.1", "http://100.128.0.1/rpc"],
  ["just outside 172.16/12", "172.32.0.1", "http://172.32.0.1/rpc"],
  ["ipv4-mapped public", "[::ffff:808:808]", "http://[::ffff:8.8.8.8]/rpc"],
])("handleRpcRequest still reaches %s", async (_label, host, upstreamUrl) => {
  const publicRegistry = buildProviderRelayRegistry([
    {
      providerId: "public",
      manifest: { relaySafe: true, relayProfile: { upstreamHosts: [host] } },
    },
  ] as never);

  let fetched = false;
  const response = await handleRpcRequest(rpcRequest({ method: "GET", upstreamUrl }), {
    providerId: "public",
    registry: publicRegistry,
    authorization: localLoopbackAuthorization,
    async transport() {
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
      authorization: localLoopbackAuthorization,
      async transport() {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
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

test.each([
  ["missing", null],
  ["wrong equal-length", "secres"],
])("handleRpcRequest rejects a %s bearer token", async (_label, token) => {
  const response = await handleRpcRequest(
    rpcRequest(
      {
        method: "GET",
        upstreamUrl: "https://api.allanime.day/api",
      },
      token,
    ),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: { mode: "bearer", token: "secret" },
      async transport() {
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(401);
});

test("handleRpcRequest accepts the exact bearer token", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: { mode: "bearer", token: "secret" },
      async transport() {
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test.each(["", "   "])("handleRpcRequest rejects a blank bearer token", async (token) => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/api",
    }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: { mode: "bearer", token },
      async transport() {
        throw new Error("should not fetch");
      },
    },
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "relay-not-configured" } });
});

test("handleRpcRequest refuses a provider whose manifest is not relay-safe", async () => {
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.videasy.to/api",
    }),
    {
      providerId: "videasy",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
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
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
    },
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-methods")).toContain("POST");
});

test("handleRpcRequest authenticates before pinned transport resolves DNS", async () => {
  let resolutions = 0;
  const response = await handleRpcRequest(
    rpcRequest(
      {
        method: "GET",
        upstreamUrl: "https://api.allanime.day/api",
      },
      null,
    ),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: { mode: "bearer", token: "secret" },
      transport: createPinnedRelayTransport({
        resolveAddresses: async () => {
          resolutions++;
          return [{ address: "93.184.216.34", family: 4 }];
        },
        request() {
          throw new Error("unauthorized request reached the socket");
        },
        maxRequestBodyBytes: 128,
        maxResponseBodyBytes: 256,
      }),
    },
  );

  expect(response.status).toBe(401);
  expect(resolutions).toBe(0);
});

test("handleRpcRequest re-resolves and re-pins every allowed redirect target", async () => {
  const resolvedHosts: string[] = [];
  const dialedAddresses: string[] = [];
  const responses: NodeResponseFixture[] = [
    {
      status: 302,
      headers: { location: "https://cdn.api.allanime.day/next" },
      body: "",
    },
    { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' },
  ];
  const request: RelayNodeRequest = (options, onResponse) => {
    dialedAddresses.push(String(options.hostname));
    const response = responses.shift();
    if (!response) throw new Error("unexpected outbound request");
    return nodeResponse(response, onResponse);
  };
  const transport = createPinnedRelayTransport({
    resolveAddresses: async (hostname) => {
      resolvedHosts.push(hostname);
      return [
        {
          address: hostname.startsWith("cdn.") ? "93.184.216.35" : "93.184.216.34",
          family: 4,
        },
      ];
    },
    request,
    maxRequestBodyBytes: 128,
    maxResponseBodyBytes: 256,
  });

  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      transport,
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(resolvedHosts).toEqual(["api.allanime.day", "cdn.api.allanime.day"]);
  expect(dialedAddresses).toEqual(["93.184.216.34", "93.184.216.35"]);
});

test("handleRpcRequest rejects a redirect whose fresh DNS set contains a private answer", async () => {
  const resolvedHosts: string[] = [];
  const responses: NodeResponseFixture[] = [
    {
      status: 302,
      headers: { location: "https://cdn.api.allanime.day/next" },
      body: "",
    },
  ];
  const transport = createPinnedRelayTransport({
    resolveAddresses: async (hostname) => {
      resolvedHosts.push(hostname);
      return hostname.startsWith("cdn.")
        ? [
            { address: "93.184.216.35", family: 4 },
            { address: "10.0.0.4", family: 4 },
          ]
        : [{ address: "93.184.216.34", family: 4 }];
    },
    request(_options, onResponse) {
      const response = responses.shift();
      if (!response) throw new Error("unsafe redirect reached the socket");
      return nodeResponse(response, onResponse);
    },
    maxRequestBodyBytes: 128,
    maxResponseBodyBytes: 256,
  });

  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      transport,
    },
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
  expect(resolvedHosts).toEqual(["api.allanime.day", "cdn.api.allanime.day"]);
});

test("handleRpcRequest strips provider credentials from a cross-origin redirect", async () => {
  const seenHeaders: Headers[] = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/start",
      headers: {
        "x-aa-boot": "boot-secret",
        "x-build-id": "119",
        "x-session-token": "session-secret",
      },
    }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        seenHeaders.push(new Headers(init?.headers));
        if (attempt++ === 0) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://cdn.api.allanime.day/next" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(seenHeaders).toHaveLength(2);
  expect(seenHeaders[0]?.get("x-aa-boot")).toBe("boot-secret");
  expect(seenHeaders[0]?.get("x-session-token")).toBe("session-secret");
  expect(seenHeaders[1]?.get("x-aa-boot")).toBeNull();
  expect(seenHeaders[1]?.get("x-session-token")).toBeNull();
  expect(seenHeaders[1]?.get("x-build-id")).toBe("119");
});

test("handleRpcRequest retains provider credentials on a same-origin redirect", async () => {
  const seenTokens: Array<string | null> = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({
      method: "GET",
      upstreamUrl: "https://api.allanime.day/start",
      headers: { "x-session-token": "session-secret" },
    }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        seenTokens.push(new Headers(init?.headers).get("x-session-token"));
        if (attempt++ === 0) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://api.allanime.day/next" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(seenTokens).toEqual(["session-secret", "session-secret"]);
});

test.each([301, 302])(
  "handleRpcRequest rewrites same-origin POST %s redirects to bodyless GET",
  async (status) => {
    const seen: Array<{
      body: BodyInit | null | undefined;
      contentType: string | null;
      method: string | undefined;
    }> = [];
    let attempt = 0;
    const response = await handleRpcRequest(
      rpcRequest({
        method: "POST",
        upstreamUrl: "https://api.allanime.day/start",
        headers: { "Content-Type": "application/json" },
        body: "secret-body",
      }),
      {
        providerId: "allanime",
        registry: providerRegistry,
        authorization: localLoopbackAuthorization,
        async transport(_url, init) {
          seen.push({
            body: init?.body,
            contentType: new Headers(init?.headers).get("content-type"),
            method: init?.method,
          });
          if (attempt++ === 0) {
            return new Response(null, {
              status,
              headers: { location: "https://api.allanime.day/next" },
            });
          }
          return Response.json({ ok: true });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { body: "secret-body", contentType: "application/json", method: "POST" },
      { body: undefined, contentType: null, method: "GET" },
    ]);
  },
);

test("handleRpcRequest does not forward a POST body or credentials across a 302 origin change", async () => {
  const seen: Array<{
    body: BodyInit | null | undefined;
    contentType: string | null;
    method: string | undefined;
    sessionToken: string | null;
  }> = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({
      method: "POST",
      upstreamUrl: "https://api.allanime.day/start",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": "header-secret",
      },
      body: "body-secret",
    }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        const headers = new Headers(init?.headers);
        seen.push({
          body: init?.body,
          contentType: headers.get("content-type"),
          method: init?.method,
          sessionToken: headers.get("x-session-token"),
        });
        if (attempt++ === 0) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://cdn.api.allanime.day/next" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(seen).toEqual([
    {
      body: "body-secret",
      contentType: "application/json",
      method: "POST",
      sessionToken: "header-secret",
    },
    { body: undefined, contentType: null, method: "GET", sessionToken: null },
  ]);
});

test("handleRpcRequest strips every body header when a 303 rewrites POST to GET", async () => {
  const seen: Array<{ body: BodyInit | null | undefined; headers: Headers; method?: string }> = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({
      method: "POST",
      upstreamUrl: "https://redirect.example/start",
      body: "secret-body",
    }),
    {
      providerId: "redirect-probe",
      registry: redirectRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        seen.push({ body: init?.body, headers: new Headers(init?.headers), method: init?.method });
        if (attempt++ === 0) {
          return new Response(null, {
            status: 303,
            headers: { location: "https://redirect.example/next" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(seen[1]?.method).toBe("GET");
  expect(seen[1]?.body).toBeUndefined();
  for (const header of [
    "content-encoding",
    "content-language",
    "content-length",
    "content-location",
    "content-type",
  ]) {
    expect(seen[1]?.headers.get(header)).toBeNull();
  }
});

test("handleRpcRequest preserves HEAD across a 303 redirect", async () => {
  const methods: Array<string | undefined> = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({ method: "HEAD", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        methods.push(init?.method);
        if (attempt++ === 0) {
          return new Response(null, {
            status: 303,
            headers: { location: "https://api.allanime.day/next" },
          });
        }
        return new Response(null, { status: 204 });
      },
    },
  );

  expect(response.status).toBe(204);
  expect(methods).toEqual(["HEAD", "HEAD"]);
});

test.each([307, 308])(
  "handleRpcRequest preserves POST body and headers across a %s redirect",
  async (status) => {
    const seen: Array<{
      body: BodyInit | null | undefined;
      contentType: string | null;
      method: string | undefined;
    }> = [];
    let attempt = 0;
    const response = await handleRpcRequest(
      rpcRequest({
        method: "POST",
        upstreamUrl: "https://api.allanime.day/start",
        headers: { "Content-Type": "application/json" },
        body: "request-body",
      }),
      {
        providerId: "allanime",
        registry: providerRegistry,
        authorization: localLoopbackAuthorization,
        async transport(_url, init) {
          seen.push({
            body: init?.body,
            contentType: new Headers(init?.headers).get("content-type"),
            method: init?.method,
          });
          if (attempt++ === 0) {
            return new Response(null, {
              status,
              headers: { location: "https://api.allanime.day/next" },
            });
          }
          return Response.json({ ok: true });
        },
      },
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { body: "request-body", contentType: "application/json", method: "POST" },
      { body: "request-body", contentType: "application/json", method: "POST" },
    ]);
  },
);

test("handleRpcRequest strips standard credentials injected by defaults on origin change", async () => {
  const credentialRegistry = buildProviderRelayRegistry([
    {
      providerId: "credential-probe",
      manifest: {
        relaySafe: true,
        relayProfile: {
          upstreamHosts: ["a.example", "b.example"],
          defaultHeaders: {
            Authorization: "Bearer provider-secret",
            Cookie: "session=cookie-secret",
            "Proxy-Authorization": "Basic proxy-secret",
          },
        },
      },
    },
  ] as never);
  const seenHeaders: Headers[] = [];
  let attempt = 0;
  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://a.example/start" }),
    {
      providerId: "credential-probe",
      registry: credentialRegistry,
      authorization: localLoopbackAuthorization,
      async transport(_url, init) {
        seenHeaders.push(new Headers(init?.headers));
        if (attempt++ === 0) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://b.example/next" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(seenHeaders[0]?.get("authorization")).toBe("Bearer provider-secret");
  expect(seenHeaders[0]?.get("cookie")).toBe("session=cookie-secret");
  expect(seenHeaders[0]?.get("proxy-authorization")).toBe("Basic proxy-secret");
  expect(seenHeaders[1]?.get("authorization")).toBeNull();
  expect(seenHeaders[1]?.get("cookie")).toBeNull();
  expect(seenHeaders[1]?.get("proxy-authorization")).toBeNull();
});

test("handleRpcRequest rejects an HTTPS to HTTP redirect before another request", async () => {
  let attempts = 0;
  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      async transport() {
        attempts++;
        return new Response(null, {
          status: 302,
          headers: { location: "http://api.allanime.day/next" },
        });
      },
    },
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: "redirect-not-allowed" } });
  expect(attempts).toBe(1);
});

test("handleRpcRequest maps Bun node:http AbortError to an upstream timeout", async () => {
  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      timeoutMs: 1,
      async transport(_url, init) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                Object.assign(new Error("The operation was aborted"), {
                  name: "AbortError",
                  code: "ABORT_ERR",
                }),
              );
            },
            { once: true },
          );
        });
      },
    },
  );

  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ error: { code: "upstream-timeout" } });
});

test("handleRpcRequest applies one deadline to the complete redirect chain", async () => {
  let attempts = 0;
  const response = await handleRpcRequest(
    rpcRequest({ method: "GET", upstreamUrl: "https://api.allanime.day/start" }),
    {
      providerId: "allanime",
      registry: providerRegistry,
      authorization: localLoopbackAuthorization,
      timeoutMs: 60,
      async transport(_url, init) {
        attempts++;
        if (attempts === 1) {
          await Bun.sleep(40);
          return new Response(null, {
            status: 302,
            headers: { location: "https://api.allanime.day/next" },
          });
        }

        return new Promise((_resolve, reject) => {
          const timer = setTimeout(() => _resolve(Response.json({ ok: true })), 40);
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(
                Object.assign(new Error("The operation was aborted"), {
                  name: "AbortError",
                  code: "ABORT_ERR",
                }),
              );
            },
            { once: true },
          );
        });
      },
    },
  );

  expect(response.status).toBe(504);
  expect(attempts).toBe(2);
  expect(await response.json()).toMatchObject({ error: { code: "upstream-timeout" } });
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

interface NodeResponseFixture {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function nodeResponse(
  response: NodeResponseFixture,
  onResponse: (response: import("node:http").IncomingMessage) => void,
): import("node:http").ClientRequest {
  const incoming = Readable.from([
    Buffer.from(response.body),
  ]) as unknown as import("node:http").IncomingMessage;
  incoming.statusCode = response.status;
  incoming.headers = { ...response.headers };
  queueMicrotask(() => onResponse(incoming));
  const outgoing = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as unknown as import("node:http").ClientRequest;
  return outgoing;
}
