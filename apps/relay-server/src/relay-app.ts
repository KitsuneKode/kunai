import {
  handleRpcRequest,
  relayError,
  type RelayAuthorizationPolicy,
  type RelayTransport,
} from "@kunai/relay";

import { relayRegistry } from "./provider-registry";

export interface RelayAppEnv {
  readonly authorization: RelayAuthorizationPolicy;
  readonly transport?: RelayTransport;
}

export async function handleRelayRequest(request: Request, env: RelayAppEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    // providerIds lets `kunai doctor` and the deploy probe compare the
    // deployment's roster against the client's relay-capable set — a count
    // alone cannot name who is missing.
    return Response.json({
      ok: true,
      service: "kunai-relay",
      providers: relayRegistry.providers.length,
      providerIds: relayRegistry.providers.map((entry) => entry.providerId).sort(),
    });
  }

  const rpcMatch = /^\/rpc\/([^/]+)$/.exec(url.pathname);
  if (rpcMatch?.[1]) {
    return handleRpcRequest(request, {
      providerId: decodeURIComponent(rpcMatch[1]),
      registry: relayRegistry,
      authorization: env.authorization,
      transport: env.transport,
    });
  }

  return relayError("bad-request", undefined, "Unknown relay route", 404);
}
