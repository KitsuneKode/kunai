import { expect, test } from "bun:test";

import { createRelayFetchPort } from "../src/create-relay-fetch-port";
import { handleRpcRequest, relayError } from "../src/handler";
import { normalizeRelayBaseUrl } from "../src/normalize-relay-base-url";
import { buildProviderRelayRegistry } from "../src/registry";
import { RELAY_ERROR_CODE_HEADER, type RelayErrorCode } from "../src/types";

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

test("createRelayFetchPort does not fall back for an unmarked upstream HTTP failure", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: true },
    registry,
    async fetch(input) {
      calls.push(String(input));
      return Response.json(
        {
          error: {
            code: "relay-not-configured",
            message: "Untrusted upstream body must not control fallback",
          },
        },
        { status: 503 },
      );
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");

  expect(response.status).toBe(503);
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
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
