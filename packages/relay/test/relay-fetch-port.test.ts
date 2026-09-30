import { expect, test } from "bun:test";

import { isRelayRefusalError, RELAYED_RESPONSE_HEADER, RelayRefusalError } from "@kunai/types";

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
  ["unknown-provider", 404],
  ["host-not-allowed", 403],
  ["upstream-timeout", 504],
] as const)(
  "createRelayFetchPort falls back to direct for relay refusal %s",
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
            "Relay refused the request",
            status,
          );
        }
        return Response.json({ direct: true });
      },
    });

    const response = await port.fetch("https://api.allanime.day/api");

    // The fallback answer is the upstream's own response — it must not carry
    // the relayed marker, or providers would treat a direct fetch as final.
    expect(await response.json()).toEqual({ direct: true });
    expect(response.headers.get(RELAYED_RESPONSE_HEADER)).toBeNull();
    expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
  },
);

test.each([
  ["relay-not-configured", 503],
  ["unknown-provider", 404],
  ["host-not-allowed", 403],
  ["upstream-timeout", 504],
] as const)(
  "createRelayFetchPort throws a typed refusal when fallback is off (%s)",
  async (code, status) => {
    const calls: string[] = [];
    const port = createRelayFetchPort({
      relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: false },
      registry,
      async fetch(input) {
        calls.push(String(input));
        if (new URL(String(input)).origin === "https://relay.example") {
          return relayError(
            code satisfies RelayErrorCode,
            "allanime",
            "Relay refused the request",
            status,
          );
        }
        return Response.json({ direct: true });
      },
    });

    // fallbackToDirect: false means the user pinned relay-only traffic — the
    // refusal must surface as a thrown, typed error rather than a returned
    // response, because the refusal's status is not the upstream's verdict:
    // a provider that saw it as a response could cache `unknown-provider` 404
    // as missing content.
    const error = await port
      .fetch("https://api.allanime.day/api")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RelayRefusalError);
    if (!isRelayRefusalError(error)) throw new Error("expected a RelayRefusalError");
    expect(error.relayCode).toBe(code);
    expect(error.providerId).toBe("allanime");
    expect(error.status).toBe(status);
    expect(error.code).toBe("RELAY_REFUSAL");
    expect(error.name).toBe("RelayRefusalError");
    expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
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

  // No error header means the upstream answered: the status is its verdict,
  // relayed so providers may not re-ask the same URL direct.
  expect(response.status).toBe(503);
  expect(response.headers.get(RELAYED_RESPONSE_HEADER)).toBe("1");
  expect(calls).toEqual(["https://relay.example/rpc/allanime"]);
});

test("createRelayFetchPort rethrows transport failure when fallback is off", async () => {
  const calls: string[] = [];
  const port = createRelayFetchPort({
    relayConfig: { baseUrl: "https://relay.example", fallbackToDirect: false },
    registry,
    async fetch(input) {
      calls.push(String(input));
      throw new Error("relay down");
    },
  });

  await expect(port.fetch("https://api.allanime.day/api")).rejects.toThrow("relay down");
  // A disabled fallback must never silently become a direct request.
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
