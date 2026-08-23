import {
  handleRpcRequest,
  relayError,
  type RelayAuthorizationPolicy,
  type RelayFetch,
} from "@kunai/relay";

import { relayRegistry } from "./provider-registry";

export interface RelayAppEnv {
  readonly authorization: RelayAuthorizationPolicy;
  readonly fetch?: RelayFetch;
}

export async function handleRelayRequest(request: Request, env: RelayAppEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "kunai-relay",
      providers: relayRegistry.providers.length,
    });
  }

  const rpcMatch = /^\/rpc\/([^/]+)$/.exec(url.pathname);
  if (rpcMatch?.[1]) {
    return handleRpcRequest(request, {
      providerId: decodeURIComponent(rpcMatch[1]),
      registry: relayRegistry,
      authorization: env.authorization,
      fetch: env.fetch,
    });
  }

  return relayError("bad-request", undefined, "Unknown relay route", 404);
}
