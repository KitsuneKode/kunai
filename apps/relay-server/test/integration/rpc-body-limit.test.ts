/**
 * The Node adapter must stop reading at the ceiling, over a real socket.
 *
 * `packages/relay` already refuses an oversized envelope — but only once it
 * holds a `Request`, and this adapter built that `Request` by buffering the
 * entire upload first. A limit enforced after the memory is spent bounds
 * nothing: the deployed path survives only because Vercel caps request size,
 * and a self-hosted `bun run dev:relay` has no such backstop.
 *
 * Driven through `node:http` on an ephemeral port because the defect lives in
 * the socket handling, which a synthetic request object does not have.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";

import { DEFAULT_MAX_REQUEST_BODY_BYTES } from "@kunai/relay";

import { createRelayRpcHandler } from "../../api/rpc/[providerId]";

let server: Server;
let base: string;
let upstreamCalls = 0;

const RELAY_TOKEN = "integration-secret";

beforeAll(async () => {
  const handler = createRelayRpcHandler({
    readToken: () => RELAY_TOKEN,
    async transport() {
      upstreamCalls++;
      throw new Error("unexpected upstream fetch");
    },
  });
  server = createServer((req, res) => {
    // Mirrors the platform's file-based route parameter.
    void handler(Object.assign(req, { query: { providerId: "allanime" } }), res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
});

function post(body: string, authorization: string | null = `Bearer ${RELAY_TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  return fetch(`${base}/rpc/allanime`, {
    method: "POST",
    headers,
    body,
  });
}

describe("relay rpc body limit", () => {
  test("an envelope over the ceiling is refused with 413", async () => {
    const response = await post("x".repeat(DEFAULT_MAX_REQUEST_BODY_BYTES + 1024));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "body-too-large" },
    });
  });

  test("a multi-megabyte upload never reports success", async () => {
    const response = await post("x".repeat(4 * 1024 * 1024));

    // The failure this guards: buffering it all, then answering as if the
    // limit had applied.
    expect(response.status).toBe(413);
    expect(response.ok).toBe(false);
  });

  test("the refusal arrives without waiting for the rest of the upload", async () => {
    // The discriminating case. Status alone proves nothing: the shared handler
    // answered 413 before this fix too — after buffering the whole body, which
    // is the part that mattered. So announce a huge Content-Length, send just
    // past the ceiling, and then stop without finishing or closing.
    //
    // Buffering until `end` cannot answer a request that never ends, so the
    // unbounded version times out here. A bounded read replies as soon as the
    // ceiling is crossed.
    const { connect } = await import("node:net");
    const { port } = server.address() as { port: number };

    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "POST /rpc/allanime HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            `Authorization: Bearer ${RELAY_TOKEN}\r\n` +
            "Content-Type: application/json\r\n" +
            "Content-Length: 10000000\r\n\r\n",
        );
        // Past the ceiling, but far short of what we promised.
        socket.write("x".repeat(DEFAULT_MAX_REQUEST_BODY_BYTES + 4096));
      });

      socket.on("data", (chunk) => {
        resolve(chunk.toString("utf8").split("\r\n")[0] ?? "");
        socket.destroy();
      });
      socket.on("error", reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("no response: the server was still waiting for the full body"));
      });
    });

    expect(status).toContain("413");
  }, 20000);

  test.each([
    ["missing", null],
    ["wrong", "Bearer wrong-token"],
  ])("%s bearer receives 401 without upstream work", async (_label, authorization) => {
    upstreamCalls = 0;
    const response = await post(
      JSON.stringify({ method: "GET", upstreamUrl: "https://api.allanime.day/api" }),
      authorization,
    );

    expect(response.status).toBe(401);
    expect(upstreamCalls).toBe(0);
  });

  test("missing bearer is rejected from headers without waiting for its body", async () => {
    const { port } = server.address() as { port: number };
    const status = await readStatusFromIncompleteRequest(
      port,
      "POST /rpc/allanime HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: 10000000\r\n\r\n",
    );

    expect(status).toContain("401");
  }, 20000);

  test("duplicate bearer headers are rejected without waiting for the body", async () => {
    const { port } = server.address() as { port: number };
    const status = await readStatusFromIncompleteRequest(
      port,
      "POST /rpc/allanime HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        `Authorization: Bearer ${RELAY_TOKEN}\r\n` +
        "Authorization: Bearer attacker\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: 10000000\r\n\r\n",
    );

    expect(status).toContain("401");
  }, 20000);

  test("an exact bearer under the ceiling reaches normal envelope validation", async () => {
    // Malformed on purpose: the point is that it is judged on its contents
    // rather than rejected for its size, so the fix did not simply refuse
    // everything.
    const response = await post(JSON.stringify({ not: "a relay envelope" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "bad-request" } });
  });
});

async function readStatusFromIncompleteRequest(port: number, requestHead: string): Promise<string> {
  const { connect } = await import("node:net");
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(requestHead));
    socket.on("data", (chunk) => {
      resolve(chunk.toString("utf8").split("\r\n")[0] ?? "");
      socket.destroy();
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("no response before the unfinished request body"));
    });
  });
}
