import { expect, test } from "bun:test";

import type { RelayAuthorizationPolicy } from "@kunai/relay";

import { handleRelayRequest } from "../../src/relay-app";

const localLoopbackAuthorization = {
  mode: "local-loopback",
} satisfies RelayAuthorizationPolicy;

test("relay app health route reports configured providers", async () => {
  const response = await handleRelayRequest(new Request("https://relay.test/health"), {
    authorization: localLoopbackAuthorization,
  });
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
      authorization: { mode: "bearer", token: "secret" },
      async transport() {
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
    { authorization: localLoopbackAuthorization },
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
    { authorization: { mode: "bearer", token: "secret" } },
  );

  expect(response.status).toBe(401);
});

test("relay app echoes a listed Origin and strips CORS for others", async () => {
  const env = {
    authorization: { mode: "bearer", token: "secret" },
    corsAllowedOrigins: ["https://app.example"],
    async transport() {
      return Response.json({ ok: true });
    },
  } satisfies Parameters<typeof handleRelayRequest>[1];
  const body = JSON.stringify({
    method: "POST",
    upstreamUrl: "https://api.allanime.day/api",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const allowed = await handleRelayRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
        Origin: "https://app.example",
      },
      body,
    }),
    env,
  );
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
  expect(allowed.headers.get("Vary")).toContain("Origin");

  const denied = await handleRelayRequest(
    new Request("https://relay.test/rpc/allanime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
        Origin: "https://evil.example",
      },
      body,
    }),
    env,
  );
  expect(denied.status).toBe(200);
  expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

test("relay app answers malformed provider ids with 400 instead of throwing", async () => {
  const response = await handleRelayRequest(new Request("https://relay.test/rpc/%zz"), {
    authorization: localLoopbackAuthorization,
  });
  expect(response.status).toBe(400);
});

test("relay app serves web companion HTML and manifest", async () => {
  const htmlRes = await handleRelayRequest(new Request("https://relay.test/"), {
    authorization: localLoopbackAuthorization,
  });
  expect(htmlRes.status).toBe(200);
  expect(htmlRes.headers.get("Content-Type")).toContain("text/html");
  const html = await htmlRes.text();
  expect(html).toContain("Kunai");
  expect(html).toContain("Web");

  const manifestRes = await handleRelayRequest(new Request("https://relay.test/manifest.json"), {
    authorization: localLoopbackAuthorization,
  });
  expect(manifestRes.status).toBe(200);
  expect(manifestRes.headers.get("Content-Type")).toContain("application/manifest+json");
  const manifest = await manifestRes.json();
  expect(manifest.short_name).toBe("Kunai");

  const statusRes = await handleRelayRequest(new Request("https://relay.test/api/status"), {
    authorization: localLoopbackAuthorization,
  });
  expect(statusRes.status).toBe(200);
  const statusBody = await statusRes.json();
  expect(statusBody.ok).toBe(true);
  expect(Array.isArray(statusBody.providers)).toBe(true);
});

test("relay app proxy validates input and handles preflight", async () => {
  const preflight = await handleRelayRequest(
    new Request("https://relay.test/proxy", { method: "OPTIONS" }),
    { authorization: localLoopbackAuthorization },
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");

  const missingUrl = await handleRelayRequest(new Request("https://relay.test/proxy"), {
    authorization: localLoopbackAuthorization,
  });
  expect(missingUrl.status).toBe(400);

  const invalidUrl = await handleRelayRequest(
    new Request("https://relay.test/proxy?url=not-a-url"),
    { authorization: localLoopbackAuthorization },
  );
  expect(invalidUrl.status).toBe(400);
});
