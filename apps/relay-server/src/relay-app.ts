import {
  handleRpcRequest,
  relayError,
  renderWebCompanionHtml,
  type RelayAuthorizationPolicy,
  type RelayTransport,
} from "@kunai/relay";

import { relayRegistry } from "./provider-registry";

export interface RelayAppEnv {
  readonly authorization: RelayAuthorizationPolicy;
  readonly transport?: RelayTransport;
  readonly corsAllowedOrigins?: readonly string[];
}

const PWA_MANIFEST = JSON.stringify({
  name: "Kunai Web Companion",
  short_name: "Kunai",
  start_url: "/",
  display: "standalone",
  background_color: "#181419",
  theme_color: "#181419",
  description: "Watch anime, movies, TV series and YouTube from your phone.",
});

export async function handleRelayRequest(request: Request, env: RelayAppEnv): Promise<Response> {
  const url = new URL(request.url);

  // Web Companion UI
  if (url.pathname === "/" || url.pathname === "/app") {
    return new Response(renderWebCompanionHtml(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  // PWA manifest
  if (url.pathname === "/manifest.json") {
    return new Response(PWA_MANIFEST, {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Health endpoint
  if (url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "kunai-relay",
      providers: relayRegistry.providers.length,
    });
  }

  // Provider status API
  if (url.pathname === "/api/status") {
    return Response.json({
      ok: true,
      providers: relayRegistry.providers.map((p) => ({
        id: p.providerId,
        name: p.manifest.displayName,
        lane: p.manifest.mediaKinds.join(", "),
        status: "operational",
      })),
    });
  }

  const rpcMatch = /^\/rpc\/([^/]+)$/.exec(url.pathname);
  if (rpcMatch?.[1]) {
    let providerId: string;
    try {
      providerId = decodeURIComponent(rpcMatch[1]);
    } catch {
      return relayError("bad-request", undefined, "Malformed provider id encoding", 400);
    }
    return handleRpcRequest(request, {
      providerId,
      registry: relayRegistry,
      authorization: env.authorization,
      transport: env.transport,
      corsAllowedOrigins: env.corsAllowedOrigins,
    });
  }

  return relayError("bad-request", undefined, "Unknown relay route", 404);
}
