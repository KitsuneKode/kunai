import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";

import type { StreamInfo } from "@/domain/types";

import { castContentTypeForUrl } from "./cast-compatibility";

const MAX_RESOURCES = 8_192;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;
const BLOCKED_UPSTREAM_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);

export type SessionMediaGatewayHandle = {
  readonly mediaUrl: string;
  readonly contentType: string;
  close(): void;
};

export type SessionMediaGatewayStartInput = {
  readonly stream: StreamInfo;
  readonly receiverHost: string;
};

export interface SessionMediaGatewayFactory {
  start(input: SessionMediaGatewayStartInput): Promise<SessionMediaGatewayHandle>;
}

type GatewayResourceRegistry = {
  readonly token: string;
  readonly initialId: string;
  register(value: string, base?: string): string | null;
  resolve(id: string): string | null;
};

export type GatewayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SessionMediaGatewayRequestEvent = {
  readonly resource: "initial" | "nested";
  readonly method: "GET" | "HEAD";
  readonly status: number;
  readonly contentType?: string;
};

export function createGatewayResourceRegistry(
  initialUrl: string,
  token = randomBytes(32).toString("base64url"),
): GatewayResourceRegistry {
  const resources = new Map<string, string>();
  const ids = new Map<string, string>();
  let nextId = 0;
  const register = (value: string, base = initialUrl): string | null => {
    let url: URL;
    try {
      url = new URL(value, base);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const normalized = url.href;
    const existing = ids.get(normalized);
    if (existing) return existing;
    if (resources.size >= MAX_RESOURCES) return null;
    const id = (++nextId).toString(36);
    resources.set(id, normalized);
    ids.set(normalized, id);
    return id;
  };
  const initialId = register(initialUrl);
  if (!initialId) throw new Error("Cast media gateway requires an HTTP(S) upstream URL");
  return {
    token,
    initialId,
    register,
    resolve: (id) => resources.get(id) ?? null,
  };
}

function gatewayPath(origin: string, registry: GatewayResourceRegistry, id: string): string {
  return `${origin}/cast/${registry.token}/${id}`;
}

function registerGatewayUrl(
  value: string,
  base: string,
  origin: string,
  registry: GatewayResourceRegistry,
): string {
  const id = registry.register(value, base);
  return id ? gatewayPath(origin, registry, id) : value;
}

export function rewriteHlsManifestForGateway(
  manifest: string,
  upstreamUrl: string,
  gatewayOrigin: string,
  registry: GatewayResourceRegistry,
): string {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith("#")) {
        return line.replace(/URI=("|')([^"']+)\1/g, (_match, quote: string, uri: string) => {
          const rewritten = registerGatewayUrl(uri, upstreamUrl, gatewayOrigin, registry);
          return `URI=${quote}${rewritten}${quote}`;
        });
      }
      return registerGatewayUrl(line.trim(), upstreamUrl, gatewayOrigin, registry);
    })
    .join("\n");
}

export function rewriteDashManifestForGateway(
  manifest: string,
  upstreamUrl: string,
  gatewayOrigin: string,
  registry: GatewayResourceRegistry,
): string {
  const rewrite = (value: string) =>
    registerGatewayUrl(value, upstreamUrl, gatewayOrigin, registry);
  return manifest
    .replace(/<(BaseURL|Location)>([^<]+)<\/\1>/gi, (_match, tag: string, value: string) => {
      return `<${tag}>${rewrite(value.trim())}</${tag}>`;
    })
    .replace(
      /\b(media|initialization|sourceURL|href)=("|')([^"']+)\2/gi,
      (_match, attribute: string, quote: string, value: string) =>
        `${attribute}=${quote}${rewrite(value)}${quote}`,
    );
}

function upstreamHeaders(
  streamHeaders: Readonly<Record<string, string>>,
  request: Request,
): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(streamHeaders)) {
    const normalizedName = name.trim().toLocaleLowerCase();
    const value = rawValue.replace(/[\r\n]+/g, " ").trim();
    if (!normalizedName || !value || BLOCKED_UPSTREAM_HEADERS.has(normalizedName)) continue;
    headers.set(normalizedName, value);
  }
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  return headers;
}

function gatewayResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges",
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function looksLikeHls(contentType: string, url: string, body: string): boolean {
  return (
    contentType.includes("mpegurl") ||
    URL.parse(url)?.pathname.toLowerCase().endsWith(".m3u8") === true ||
    body.trimStart().startsWith("#EXTM3U")
  );
}

function looksLikeDash(contentType: string, url: string, body: string): boolean {
  return (
    contentType.includes("dash+xml") ||
    URL.parse(url)?.pathname.toLowerCase().endsWith(".mpd") === true ||
    /^\s*<\?xml[^>]*>\s*<MPD\b|^\s*<MPD\b/i.test(body)
  );
}

export function createSessionMediaGatewayHandler(input: {
  readonly stream: StreamInfo;
  readonly origin: () => string;
  readonly registry: GatewayResourceRegistry;
  readonly fetchUpstream?: GatewayFetch;
  readonly isClosed?: () => boolean;
  readonly onRequest?: (event: SessionMediaGatewayRequestEvent) => void;
}): (request: Request) => Promise<Response> {
  const fetchUpstream = input.fetchUpstream ?? fetch;
  return async (request) => {
    if (input.isClosed?.()) return new Response("not found", { status: 404 });
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "cast" || parts[1] !== input.registry.token) {
      return new Response("not found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "Range",
        },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const upstreamUrl = input.registry.resolve(parts[2] ?? "");
    if (!upstreamUrl) return new Response("not found", { status: 404 });
    try {
      const upstream = await fetchUpstream(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders(input.stream.headers, request),
        redirect: "follow",
      });
      input.onRequest?.({
        resource: parts[2] === input.registry.initialId ? "initial" : "nested",
        method: request.method,
        status: upstream.status,
        contentType: upstream.headers.get("content-type") ?? undefined,
      });
      const headers = gatewayResponseHeaders(upstream);
      if (request.method === "HEAD" || !upstream.body || !upstream.ok) {
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          headers,
        });
      }
      const contentLength = Number(upstream.headers.get("content-length"));
      const contentType = upstream.headers.get("content-type")?.toLocaleLowerCase() ?? "";
      const responseUrl = upstream.url || upstreamUrl;
      const urlLooksLikeManifest =
        contentType.includes("mpegurl") ||
        contentType.includes("dash+xml") ||
        /\.(m3u8|mpd)$/i.test(URL.parse(responseUrl)?.pathname ?? "");
      if (!urlLooksLikeManifest) {
        return new Response(upstream.body, { status: upstream.status, headers });
      }
      if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
        return new Response("upstream manifest too large", { status: 502 });
      }
      const body = await upstream.text();
      if (new TextEncoder().encode(body).byteLength > MAX_MANIFEST_BYTES) {
        return new Response("upstream manifest too large", { status: 502 });
      }
      const effectiveUrl = responseUrl;
      if (looksLikeHls(contentType, effectiveUrl, body)) {
        headers.set("content-type", "application/vnd.apple.mpegurl");
        return new Response(
          rewriteHlsManifestForGateway(body, effectiveUrl, input.origin(), input.registry),
          { status: upstream.status, headers },
        );
      }
      if (looksLikeDash(contentType, effectiveUrl, body)) {
        headers.set("content-type", "application/dash+xml");
        return new Response(
          rewriteDashManifestForGateway(body, effectiveUrl, input.origin(), input.registry),
          { status: upstream.status, headers },
        );
      }
      return new Response(body, { status: upstream.status, headers });
    } catch {
      input.onRequest?.({
        resource: parts[2] === input.registry.initialId ? "initial" : "nested",
        method: request.method as "GET" | "HEAD",
        status: 502,
      });
      return new Response("upstream fetch failed", { status: 502 });
    }
  };
}

export async function receiverFacingAddress(receiverHost: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Could not determine the LAN address for Google Cast"));
    }, 1_500);
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.connect(8009, receiverHost, () => {
      clearTimeout(timer);
      const address = socket.address();
      socket.close();
      if (typeof address === "string" || address.address === "0.0.0.0") {
        reject(new Error("Could not determine the LAN address for Google Cast"));
      } else resolve(address.address);
    });
  });
}

export class SessionMediaGateway implements SessionMediaGatewayFactory {
  constructor(
    private readonly options: {
      readonly onRequest?: (event: SessionMediaGatewayRequestEvent) => void;
    } = {},
  ) {}

  async start(input: SessionMediaGatewayStartInput): Promise<SessionMediaGatewayHandle> {
    const hostname = await receiverFacingAddress(input.receiverHost);
    const registry = createGatewayResourceRegistry(input.stream.url);
    let closed = false;
    let origin = "";
    const handler = createSessionMediaGatewayHandler({
      stream: input.stream,
      registry,
      origin: () => origin,
      isClosed: () => closed,
      onRequest: this.options.onRequest,
    });
    const server = Bun.serve({ hostname, port: 0, fetch: handler });
    origin = `http://${hostname}:${server.port}`;
    return {
      mediaUrl: gatewayPath(origin, registry, registry.initialId),
      contentType: castContentTypeForUrl(input.stream.url),
      close: () => {
        if (closed) return;
        closed = true;
        server.stop(true);
      },
    };
  }
}
