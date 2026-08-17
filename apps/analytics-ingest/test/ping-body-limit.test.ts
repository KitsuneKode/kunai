/**
 * The body cap must actually refuse, over a real socket.
 *
 * This is the endpoint's primary abuse control, and it was silently broken in
 * a way no unit test could see. `readJsonBodyLimited` used `for await` and
 * returned early once the body exceeded the cap; breaking out of that loop
 * calls the async iterator's `return()`, which destroys the request and its
 * socket while the handler is still a microtask away from writing the reply.
 * The reply never landed, and the client saw Node's default empty `200` — the
 * guard reported success for exactly the bodies it existed to reject.
 *
 * Nothing short of a real HTTP round trip catches that: a mocked request
 * object has no socket to tear down. So these run against `node:http` on an
 * ephemeral port.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";

import handler from "../api/ping";

let server: Server;
let base: string;

beforeAll(async () => {
  // A syntactically valid connection string is enough: every case here is
  // refused before any query runs.
  process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/db";
  process.env.ANALYTICS_HASH_SECRET ||= "test-secret";

  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

function post(body: string) {
  return fetch(`${base}/api/ping`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function validBody(pad = 0): string {
  const payload = {
    installId: crypto.randomUUID(),
    version: "0.3.0",
    os: "linux",
    arch: "x64",
    ts: Date.now(),
  };
  return JSON.stringify(payload) + " ".repeat(pad);
}

describe("ping body limit", () => {
  test("a body over the cap is refused with 400, not an empty 200", async () => {
    const response = await post(validBody(600));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "body_too_large" });
  });

  test("a large non-JSON flood is refused rather than accepted", async () => {
    const response = await post("x".repeat(5000));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "body_too_large" });
  });

  test("a megabyte upload cannot pass as success", async () => {
    const response = await post("x".repeat(1024 * 1024));

    // The exact code matters less than never answering 2xx: the CLI treats any
    // non-5xx as delivered and would record the ping as sent.
    expect(response.status).toBe(400);
    expect(response.ok).toBe(false);
  });

  test("a small malformed body still reports invalid_payload", async () => {
    const response = await post("{}");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_payload" });
  });

  test("a body just under the cap is still read and validated", async () => {
    // Proves the fix did not simply reject everything: this one gets far
    // enough to be judged on its contents.
    const response = await post(validBody(0));

    expect(response.status).not.toBe(400);
  });

  test("GET is refused before any body handling", async () => {
    const response = await fetch(`${base}/api/ping`);

    expect(response.status).toBe(405);
  });
});
