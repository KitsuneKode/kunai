import { expect, test } from "bun:test";

import { handleRpcRequest } from "../src/handler";
import { buildProviderRelayRegistry } from "../src/registry";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
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
      relayProfile: {
        upstreamHosts: ["miruro.bz"],
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
