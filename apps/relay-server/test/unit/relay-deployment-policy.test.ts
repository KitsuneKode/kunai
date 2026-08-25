import { expect, test } from "bun:test";

import {
  buildProviderRelayRegistry,
  type ProviderRelayRegistry,
  type RelayTransport,
} from "@kunai/relay";

import handler, { createRelayRpcHandler } from "../../api/rpc/[providerId]";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relaySafe: true,
      relayProfile: { upstreamHosts: ["api.allanime.day"] },
    },
  },
] as never);

test("deployment rejects an unset token before reading the request body", async () => {
  const previousToken = process.env.RELAY_TOKEN;
  delete process.env.RELAY_TOKEN;

  const request = {
    method: "POST",
    headers: {},
    query: { providerId: "allanime" },
    on() {
      throw new Error("request body was accessed");
    },
  } as unknown as Parameters<typeof handler>[0];
  let responseBody: Uint8Array | undefined;
  const response = {
    statusCode: 0,
    setHeader() {},
    end(body?: Uint8Array) {
      responseBody = body;
    },
  } as unknown as Parameters<typeof handler>[1];

  try {
    await handler(request, response);
  } finally {
    if (previousToken === undefined) delete process.env.RELAY_TOKEN;
    else process.env.RELAY_TOKEN = previousToken;
  }

  expect(response.statusCode).toBe(503);
  expect(JSON.parse(Buffer.from(responseBody ?? []).toString("utf8"))).toMatchObject({
    error: { code: "relay-not-configured" },
  });
});

test.each([undefined, "", "   "])(
  "deployment rejects unusable token %s before route or body work",
  async (token) => {
    const calls = {
      body: 0,
      registry: 0,
      request: 0,
      shared: 0,
      token: 0,
      upstream: 0,
    };
    let written: Response | undefined;
    const guardedRegistry = {
      providers: [],
      get() {
        calls.registry++;
        return undefined;
      },
      findByUpstreamUrl() {
        calls.registry++;
        return undefined;
      },
      isHostAllowed() {
        calls.registry++;
        return false;
      },
    } satisfies ProviderRelayRegistry;
    const rpcHandler = createRelayRpcHandler({
      readToken() {
        calls.token++;
        return token;
      },
      registry: guardedRegistry,
      async readBody() {
        calls.body++;
        throw new Error("body reader was called");
      },
      createWebRequest() {
        calls.request++;
        throw new Error("request adapter was called");
      },
      async handleRequest() {
        calls.shared++;
        throw new Error("shared handler was called");
      },
      async transport() {
        calls.upstream++;
        throw new Error("upstream fetch was called");
      },
      async writeResponse(_response, result) {
        written = result;
      },
    });
    const request = {
      method: "POST",
      headers: {},
      get query(): never {
        throw new Error("route was inspected");
      },
      on() {
        throw new Error("request body was accessed");
      },
    } as unknown as Parameters<typeof rpcHandler>[0];

    await rpcHandler(request, {} as Parameters<typeof rpcHandler>[1]);

    expect(written?.status).toBe(503);
    expect(await written?.json()).toMatchObject({ error: { code: "relay-not-configured" } });
    expect(calls).toEqual({
      body: 0,
      registry: 0,
      request: 0,
      shared: 0,
      token: 1,
      upstream: 0,
    });
  },
);

test.each([
  ["missing", undefined],
  ["wrong", "Bearer secres"],
])("deployment returns 401 for %s request bearer without upstream fetch", async (_label, auth) => {
  let upstreamCalls = 0;
  const result = await invokeFactory({
    configuredToken: "secret",
    authorization: auth,
    body: JSON.stringify({ method: "GET", upstreamUrl: "https://api.allanime.day/api" }),
    async transport() {
      upstreamCalls++;
      return Response.json({ ok: true });
    },
  });

  expect(result.status).toBe(401);
  expect(upstreamCalls).toBe(0);
  expect(await result.clone().text()).not.toContain("secret");
});

test.each([
  ["missing", undefined],
  ["wrong", "Bearer secres"],
])(
  "deployment rejects a %s request bearer before reading its body",
  async (_label, authorization) => {
    let bodyReads = 0;
    let written: Response | undefined;
    const rpcHandler = createRelayRpcHandler({
      readToken: () => "secret",
      registry,
      async readBody() {
        bodyReads++;
        return new TextEncoder().encode(
          JSON.stringify({ method: "GET", upstreamUrl: "https://api.allanime.day/api" }),
        );
      },
      async writeResponse(_response, result) {
        written = result;
      },
    });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;

    await rpcHandler(
      {
        method: "POST",
        headers,
        query: { providerId: "allanime" },
      } as unknown as Parameters<typeof rpcHandler>[0],
      {} as Parameters<typeof rpcHandler>[1],
    );

    expect(written?.status).toBe(401);
    expect(bodyReads).toBe(0);
  },
);

test.each([
  [
    "headersDistinct",
    {
      headers: { authorization: "Bearer secret" },
      headersDistinct: { authorization: ["Bearer secret", "Bearer wrong"] },
    },
  ],
  [
    "rawHeaders",
    {
      headers: { authorization: "Bearer secret" },
      rawHeaders: ["Authorization", "Bearer secret", "Authorization", "Bearer wrong"],
    },
  ],
])("deployment rejects duplicate Authorization preserved by %s", async (_label, rawRequest) => {
  let bodyReads = 0;
  let written: Response | undefined;
  const rpcHandler = createRelayRpcHandler({
    readToken: () => "secret",
    registry,
    async readBody() {
      bodyReads++;
      return new Uint8Array();
    },
    async writeResponse(_response, result) {
      written = result;
    },
  });

  await rpcHandler(
    {
      method: "POST",
      ...rawRequest,
      query: { providerId: "allanime" },
    } as unknown as Parameters<typeof rpcHandler>[0],
    {} as Parameters<typeof rpcHandler>[1],
  );

  expect(written?.status).toBe(401);
  expect(bodyReads).toBe(0);
});

test("deployment exact bearer reaches the shared relay handler", async () => {
  let upstreamCalls = 0;
  const result = await invokeFactory({
    configuredToken: " secret ",
    authorization: "Bearer secret",
    body: JSON.stringify({ method: "GET", upstreamUrl: "https://api.allanime.day/api" }),
    async transport() {
      upstreamCalls++;
      return Response.json({ ok: true });
    },
  });

  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ ok: true });
  expect(upstreamCalls).toBe(1);
});

test("deployment OPTIONS remains a body-free CORS preflight", async () => {
  let bodyReads = 0;
  let written: Response | undefined;
  const rpcHandler = createRelayRpcHandler({
    readToken: () => "secret",
    registry,
    async readBody() {
      bodyReads++;
      throw new Error("OPTIONS body was read");
    },
    async writeResponse(_response, result) {
      written = result;
    },
  });
  const request = {
    method: "OPTIONS",
    headers: {},
    query: { providerId: "allanime" },
  } as unknown as Parameters<typeof rpcHandler>[0];

  await rpcHandler(request, {} as Parameters<typeof rpcHandler>[1]);

  expect(bodyReads).toBe(0);
  expect(written?.status).toBe(204);
  expect(written?.headers.get("access-control-allow-methods")).toContain("POST");
  expect(await written?.text()).toBe("");
});

async function invokeFactory(input: {
  readonly configuredToken: string;
  readonly authorization?: string;
  readonly body: string;
  readonly transport: RelayTransport;
}): Promise<Response> {
  let written: Response | undefined;
  const rpcHandler = createRelayRpcHandler({
    readToken: () => input.configuredToken,
    registry,
    readBody: async () => new TextEncoder().encode(input.body),
    transport: input.transport,
    async writeResponse(_response, result) {
      written = result;
    },
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.authorization) headers.authorization = input.authorization;
  const request = {
    method: "POST",
    headers,
    query: { providerId: "allanime" },
  } as unknown as Parameters<typeof rpcHandler>[0];

  await rpcHandler(request, {} as Parameters<typeof rpcHandler>[1]);
  if (!written) throw new Error("handler did not write a response");
  return written;
}
