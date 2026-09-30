import { expect, test } from "bun:test";

import { handleRpcRequest } from "../src/handler";
import { buildProviderRelayRegistry } from "../src/registry";
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from "../src/types";

const registry = buildProviderRelayRegistry([
  {
    providerId: "allanime",
    manifest: {
      relaySafe: true,
      relayProfile: { upstreamHosts: ["api.allanime.day"] },
    },
  },
] as never);

test("Bun.serve rejects a chunked upload over the cap before the handler fetches upstream", async () => {
  let upstream = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      return handleRpcRequest(request, {
        providerId: "allanime",
        registry,
        authorization: { mode: "local-loopback" },
        async transport() {
          upstream += 1;
          return new Response("no");
        },
      });
    },
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/rpc/allanime`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(DEFAULT_MAX_REQUEST_BODY_BYTES + 1024),
    });
    expect(response.status).toBe(413);
    expect(upstream).toBe(0);
  } finally {
    server.stop(true);
  }
});
