import { expect, test } from "bun:test";

import { createRelayFetchPort } from "../src/create-relay-fetch-port";
import { normalizeRelayBaseUrl } from "../src/normalize-relay-base-url";
import { buildProviderRelayRegistry } from "../src/registry";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relayProfile: {
        upstreamHosts: ["api.allanime.day"],
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
      if (String(input).startsWith("https://relay.example")) throw new Error("relay down");
      return Response.json({ direct: true });
    },
  });

  const response = await port.fetch("https://api.allanime.day/api");
  expect(await response.json()).toEqual({ direct: true });
  expect(calls).toEqual(["https://relay.example/rpc/allanime", "https://api.allanime.day/api"]);
});

test("normalizeRelayBaseUrl accepts HTTPS and local HTTP only", () => {
  expect(normalizeRelayBaseUrl("https://relay.example/")).toBe("https://relay.example");
  expect(normalizeRelayBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  expect(normalizeRelayBaseUrl("http://relay.example")).toBeUndefined();
});
