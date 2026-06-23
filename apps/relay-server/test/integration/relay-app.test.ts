import { expect, test } from "bun:test";

import { handleRelayRequest } from "../../src/relay-app";

test("relay app health route reports configured providers", async () => {
  const response = await handleRelayRequest(new Request("https://relay.test/health"));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ ok: true, service: "kunai-relay" });
  expect(body.providers).toBeGreaterThan(0);
});

test("relay app forwards allowlisted provider RPC requests", async () => {
  const response = await handleRelayRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({
        method: "POST",
        upstreamUrl: "https://api.allanime.day/api",
        headers: { "Content-Type": "application/json" },
        body: '{"query":"x"}',
      }),
    }),
    {
      relayToken: "secret",
      async fetch() {
        return Response.json({ data: { ok: true } });
      },
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { ok: true } });
});

test("relay app rejects disallowed provider host", async () => {
  const response = await handleRelayRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "POST",
      body: JSON.stringify({
        method: "GET",
        upstreamUrl: "https://miruro.bz/api",
      }),
    }),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "host-not-allowed" } });
});

test("relay app enforces token when configured", async () => {
  const response = await handleRelayRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "POST",
      body: JSON.stringify({
        method: "GET",
        upstreamUrl: "https://api.allanime.day/api",
      }),
    }),
    { relayToken: "secret" },
  );

  expect(response.status).toBe(401);
});
