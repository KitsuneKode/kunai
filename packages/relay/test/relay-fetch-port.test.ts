import { expect, test } from "bun:test";

import { createRelayFetchPort } from "../src/create-relay-fetch-port";
import { handleRpcRequest, relayError } from "../src/handler";
import { normalizeRelayBaseUrl } from "../src/normalize-relay-base-url";
import { buildProviderRelayRegistry } from "../src/registry";
import {
  RELAY_ERROR_CODE_HEADER,
  RELAY_RESULT_HEADER,
  RELAY_RESULT_UPSTREAM,
  type RelayErrorCode,
} from "../src/types";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relaySafe: true,
      relayProfile: {
        upstreamHosts: ["api.allanime.day"],
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

test("createRelayFetchPort routes allowlisted provider requests through RPC", async () => {
  let rpcEnvelope: unknown;
  const port = createRelayFetchPort({
    relayConfig: {
      baseUrl: "https://relay.example/",
      token: "secret",
    },
    registry,
    async fetch(input, init) {
      expect(String(input)).toBe("https://relay.example/rpc/allanime");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
      rpcEnvelope = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"query":"x"}',
  });

  expect(await response.json()).toEqual({ ok: true });
  expect(rpcEnvelope).toMatchObject({
    method: "POST",
    upstreamUrl: "https://api.allanime.day/api",
    body: '{"query":"x"}',
  });
});

test("createRelayFetchPort keeps a relay base URL's sub-path", async () => {
  // `new URL("/rpc/x", base)` read the leading slash as absolute and dropped
  // `/prod`, so a self-hosted relay behind a path prefix 404ed and every request
  // fell back to direct — silently, and for as long as the relay stayed configured.
  let called = "";
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example/prod" },
    registry,
    async fetch(input) {
      called = String(input);
      return Response.json({ ok: true });
    },
  });

  await port.fetch("https://api.allanime.day/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"query":"x"}',
  });

  expect(called).toBe("https://relay.example/prod/rpc/allanime");
});

test("createRelayFetchPort uses direct fetch when relay is not configured", async () => {
  let direct = false;
  const port = createRelayFetchPort({
    relayConfig: {},
    registry,
    async fetch(input) {
      direct = String(input) === "https://api.allanime.day/api";
      return Response.json({ direct: true });
    },
  });

  await port.fetch("https://api.allanime.day/api");
  expect(direct).toBe(true);
});

test("createRelayFetchPort falls back to direct when relay network fails", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example" },
    registry,
    async fetch(input) {
      calls.push(String(input));
      // `startsWith` would also match https://relay.example.evil.test — compare origins.
      if (new URL(String(input)).origin === "https://relay.example") {
        throw new Error("relay down");
      }
      return Response.json({ direct: true });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");
  expect(await response.json()).toEqual({ direct: true });
  expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
});

test.each([
  ["relay-not-configured", 503],
  ["unauthorized", 401],
] as const)(
  "createRelayFetchPort falls back to direct for relay authorization failure %s",
  async (code, status) => {
    const calls: string[] = [];
    const port = createRelayFetchPort({
      relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
      registry,
      async fetch(input) {
        calls.push(String(input));
        if (new URL(String(input)).origin === "https://relay.example") {
          return relayError(
            code satisfies RelayErrorCode,
            "allanime",
            "Relay authorization failed",
            status,
          );
        }
        return Response.json({ direct: true });
      },
    });

    const response = await port.fetch("https://api.allanime.day/api");

    expect(await response.json()).toEqual({ direct: true });
    expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
  },
);

test("an unmarked non-2xx falls back to direct — the body cannot decide either way", async () => {
  /* A platform crash (dead function, SSO wall, missing route) and an old
   * relay's proxied upstream error look identical: non-2xx with no relay
   * markers. Falling back resolves the ambiguity — a real upstream error
   * reproduces direct — and a crafted error-shaped body never influences the
   * decision because only the header markers count. */
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    async fetch(input) {
      calls.push(String(input));
      if (new URL(String(input)).origin !== "https://relay.example") {
        return Response.json({ direct: true });
      }
      return Response.json(
        {
          error: {
            code: "relay-not-configured",
            message: "Untrusted body must not control fallback",
          },
        },
        { status: 503 },
      );
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(await response.json()).toEqual({ direct: true });
  expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
});

test.each([
  ["upstream-error", 502],
  ["upstream-timeout", 504],
  ["unknown-provider", 404],
  ["host-not-allowed", 403],
  ["response-too-large", 502],
] as const)(
  "createRelayFetchPort falls back to direct for relay error %s",
  async (code, status) => {
    /* Every relay error code means the provider's upstream answer was never
     * delivered — auth failures and refusals alike — so fallbackToDirect
     * applies to all of them, not just the authorization pair. */
    const calls: string[] = [];
    const port = createRelayFetchPort({
      relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
      registry,
      async fetch(input) {
        calls.push(String(input));
        if (new URL(String(input)).origin === "https://relay.example") {
          return relayError(
            code satisfies RelayErrorCode,
            "allanime",
            "Relay could not deliver",
            status,
          );
        }
        return Response.json({ direct: true });
      },
    });

    const response = await port.fetch("https://api.allanime.day/api");

    expect(await response.json()).toEqual({ direct: true });
    expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
  },
);

test("a proxied upstream error carrying the result marker stays final", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    async fetch(input) {
      calls.push(String(input));
      return new Response("upstream unavailable", {
        status: 503,
        headers: { [RELAY_RESULT_HEADER]: RELAY_RESULT_UPSTREAM },
      });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(response.status).toBe(503);
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
});

test("an unmarked non-2xx stays final when fallbackToDirect is off", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: false },
    registry,
    async fetch(input) {
      calls.push(String(input));
      return new Response("platform crash", { status: 500 });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(response.status).toBe(500);
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
});

test("an unmarked 2xx stays final — it is a proxied success, not a platform failure", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    async fetch(input) {
      calls.push(String(input));
      return Response.json({ upstream: "ok" });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(await response.json()).toEqual({ upstream: "ok" });
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
});

test("a platform redirect on the RPC route falls back instead of being followed", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    async fetch(input) {
      calls.push(String(input));
      if (new URL(String(input)).origin !== "https://relay.example") {
        return Response.json({ direct: true });
      }
      return new Response(null, {
        status: 302,
        headers: { location: "https://auth.example/login" },
      });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(await response.json()).toEqual({ direct: true });
  expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
});

test("an upstream relay-error marker is stripped before client fallback policy sees it", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    providerId: "allanime",
    async fetch(input, init) {
      calls.push(String(input));
      if (new URL(String(input)).origin !== "https://relay.example") {
        return Response.json({ direct: true });
      }

      return handleRpcRequest(new Request(String(input), init), {
        providerId: "allanime",
        registry,
        authorization: { mode: "local-loopback" },
        async transport() {
          return new Response("upstream unavailable", {
            status: 503,
            headers: { [RELAY_ERROR_CODE_HEADER]: "relay-not-configured" },
          });
        },
      });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(response.status).toBe(503);
  expect(response.headers.get(RELAY_ERROR_CODE_HEADER)).toBeNull();
  expect(await response.text()).toBe("upstream unavailable");
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
});

test("createRelayFetchPort stays on direct fetch when the manifest is not relay-safe", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example" },
    registry,
    providerId: "videasy",
    async fetch(input) {
      calls.push(String(input));
      return Response.json({ direct: true });
    },
  });

  const response = await port.fetch("https://api.videasy.to/api");
  expect(await response.json()).toEqual({ direct: true });
  expect(calls).toEqual(["https://api.videasy.to/api"]);
});

test("normalizeRelayBaseUrl accepts HTTPS and local HTTP only", () => {
  expect(normalizeRelayBaseUrl("https://relay.example/")).toBe("https://relay.example");
  expect(normalizeRelayBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  expect(normalizeRelayBaseUrl("http://relay.example")).toBeUndefined();
});
