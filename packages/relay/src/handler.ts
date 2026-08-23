import { timingSafeEqual } from "node:crypto";

import { filterForwardHeaders, mergeRelayHeaders, RelayValidationError } from "./forward-headers";
import { parseHttpUrl } from "./registry";
import {
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  DEFAULT_RELAY_TIMEOUT_MS,
  type RelayFetch,
  type RelayErrorCode,
  type RelayHandlerOptions,
  type RelayRpcErrorBody,
  type RelayRpcRequest,
  type RelayMethod,
} from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RELAY_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "x-obfuscated",
] as const;

export async function handleRpcRequest(
  request: Request,
  options: RelayHandlerOptions,
): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflightResponse();
  if (request.method !== "POST") {
    return relayError("method-not-allowed", options.providerId, "RPC route requires POST", 405);
  }

  if (options.authorization.mode === "bearer") {
    const token = options.authorization.token.trim();
    if (!token) {
      return relayError(
        "relay-not-configured",
        options.providerId,
        "Relay authorization is not configured",
        503,
      );
    }
    if (!isAuthorized(request, token)) {
      return relayError("unauthorized", options.providerId, "Relay token is required", 401);
    }
  }

  const provider = options.registry.get(options.providerId);
  if (!provider) {
    return relayError("unknown-provider", options.providerId, "Unknown provider", 404);
  }
  if (!provider.profile || provider.manifest.relaySafe !== true) {
    return relayError(
      "provider-not-relayable",
      options.providerId,
      "Provider is not relayable",
      403,
    );
  }

  let rpc: RelayRpcRequest;
  try {
    rpc = await readRpcRequest(request);
  } catch (error) {
    return relayError(
      error instanceof RelayValidationError ? error.code : "bad-request",
      options.providerId,
      error instanceof Error ? error.message : "Invalid relay request",
      error instanceof RelayValidationError ? error.status : 400,
    );
  }

  const upstreamUrl = parseHttpUrl(rpc.upstreamUrl);
  if (!upstreamUrl) {
    return relayError(
      "protocol-not-allowed",
      options.providerId,
      "Only HTTP(S) upstream URLs are allowed",
      400,
    );
  }
  if (isUnsafeHostname(upstreamUrl.hostname)) {
    return relayError("host-not-allowed", options.providerId, "Unsafe host rejected", 403);
  }
  if (!options.registry.isHostAllowed(options.providerId, upstreamUrl, "metadata")) {
    return relayError(
      "host-not-allowed",
      options.providerId,
      "Target host is not allowed for provider",
      403,
    );
  }

  const allowedMethods = provider.profile.allowedMethods ?? ["GET", "POST", "HEAD"];
  if (!allowedMethods.includes(rpc.method)) {
    return relayError("method-not-allowed", options.providerId, "Method is not allowed", 405);
  }

  const maxBodyBytes = provider.profile.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  if (rpc.body && byteLength(rpc.body) > maxBodyBytes) {
    return relayError("body-too-large", options.providerId, "Relay request body is too large", 413);
  }

  let headers: Record<string, string>;
  try {
    headers = mergeRelayHeaders(
      provider.profile.defaultHeaders,
      filterForwardHeaders(rpc.headers, "metadata"),
    );
  } catch (error) {
    return relayError(
      error instanceof RelayValidationError ? error.code : "headers-rejected",
      options.providerId,
      error instanceof Error ? error.message : "Headers rejected",
      error instanceof RelayValidationError ? error.status : 400,
    );
  }

  try {
    const upstream = await fetchWithValidatedRedirects({
      fetchImpl: options.fetch ?? fetch,
      providerId: options.providerId,
      registry: options.registry,
      url: upstreamUrl,
      init: {
        method: rpc.method,
        headers,
        body: rpc.method === "GET" || rpc.method === "HEAD" ? undefined : rpc.body,
      },
      timeoutMs: options.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS,
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    });

    return await relayUpstreamResponse(
      upstream,
      provider.profile.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES,
      options.providerId,
      rpc.method,
    );
  } catch (error) {
    if (error instanceof RelayValidationError) {
      return relayError(error.code, options.providerId, error.message, error.status);
    }
    if (isAbortLike(error)) {
      return relayError("upstream-timeout", options.providerId, "Upstream request timed out", 504);
    }
    return relayError(
      "upstream-error",
      options.providerId,
      error instanceof Error ? error.message : "Upstream request failed",
      502,
    );
  }
}

async function readRpcRequest(request: Request): Promise<RelayRpcRequest> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > DEFAULT_MAX_REQUEST_BODY_BYTES) {
    throw new RelayValidationError("body-too-large", "Relay envelope is too large", 413);
  }
  const text = await request.text();
  if (byteLength(text) > DEFAULT_MAX_REQUEST_BODY_BYTES) {
    throw new RelayValidationError("body-too-large", "Relay envelope is too large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RelayValidationError("bad-request", "Relay request body must be JSON", 400);
  }
  if (!isRelayRpcRequest(parsed)) {
    throw new RelayValidationError("bad-request", "Relay request body is invalid", 400);
  }
  return parsed;
}

function isRelayRpcRequest(value: unknown): value is RelayRpcRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayRpcRequest>;
  return (
    isRelayMethod(candidate.method) &&
    typeof candidate.upstreamUrl === "string" &&
    (candidate.headers === undefined || isStringRecord(candidate.headers)) &&
    (candidate.body === undefined || typeof candidate.body === "string")
  );
}

function isRelayMethod(value: unknown): value is RelayMethod {
  return value === "GET" || value === "POST" || value === "HEAD";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

async function fetchWithValidatedRedirects(input: {
  readonly fetchImpl: RelayFetch;
  readonly providerId: string;
  readonly registry: RelayHandlerOptions["registry"];
  readonly url: URL;
  readonly init: RequestInit;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
}): Promise<Response> {
  let currentUrl = input.url;
  let method = input.init.method ?? "GET";
  let body = input.init.body;

  for (let redirectCount = 0; redirectCount <= input.maxRedirects; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("relay upstream timeout"), input.timeoutMs);
    try {
      const response = await input.fetchImpl(currentUrl, {
        ...input.init,
        method,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get("location");
      if (!location || redirectCount >= input.maxRedirects) {
        throw new RelayValidationError(
          "redirect-not-allowed",
          "Upstream redirect is not allowed",
          502,
        );
      }
      currentUrl = new URL(location, currentUrl);
      if (!input.registry.isHostAllowed(input.providerId, currentUrl, "metadata")) {
        throw new RelayValidationError(
          "redirect-not-allowed",
          "Upstream redirect target is not allowed",
          502,
        );
      }
      if (response.status === 303) {
        method = "GET";
        body = undefined;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new RelayValidationError("redirect-not-allowed", "Too many upstream redirects", 502);
}

async function relayUpstreamResponse(
  upstream: Response,
  maxResponseBytes: number,
  providerId: string,
  method: RelayMethod,
): Promise<Response> {
  const headers = filteredResponseHeaders(upstream.headers);
  headers.set("Access-Control-Allow-Origin", "*");

  if (method === "HEAD" || !upstream.body) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxResponseBytes) {
    return relayError(
      "response-too-large",
      providerId,
      "Upstream metadata response is too large",
      502,
    );
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > maxResponseBytes) {
    return relayError(
      "response-too-large",
      providerId,
      "Upstream metadata response is too large",
      502,
    );
  }
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function filteredResponseHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of RELAY_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value && name !== "content-length") headers.set(name, value);
  }
  return headers;
}

export function relayError(
  code: RelayErrorCode,
  providerId: string | undefined,
  message: string,
  status: number,
): Response {
  const body: RelayRpcErrorBody = {
    error: {
      code,
      providerId,
      message,
    },
  };
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "600",
    },
  });
}

function isAuthorized(request: Request, token: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  const expected = `Bearer ${token}`;
  const given = Buffer.from(authorization, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  // Lengths can only be equal or different; the constant-time compare runs on
  // equal-length buffers so header bytes never decide the branch order.
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * The dotted-quad an IPv6 literal embeds, or null when it embeds none.
 *
 * Covers both spellings of the `::ffff:` mapping — the dotted tail the user
 * types and the two hex groups WHATWG normalizes it into — plus the deprecated
 * IPv4-compatible `::a.b.c.d` form, which normalizes the same way.
 */
function embeddedIpv4(ipv6: string): string | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ipv6);
  if (dotted?.[1]) return dotted[1];

  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ipv6);
  if (!hex?.[1] || !hex[2]) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  // `::1` and `::` are loopback/unspecified, not IPv4 — leave them to the
  // literal checks so their meaning is not silently reinterpreted.
  if (high === 0) return null;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "0.0.0.0") return true;
  if (normalized.includes(":")) {
    // WHATWG URL keeps brackets on IPv6 literals ("[::1]"); strip them so
    // loopback, unspecified, link-local, and unique-local all match.
    const ipv6 =
      normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
    // An IPv4-mapped address is an IPv4 address, and the prefix checks below
    // cannot see it: WHATWG rewrites `::ffff:169.254.169.254` — the cloud
    // metadata endpoint — to the hex form `::ffff:a9fe:a9fe`, which matches
    // none of them. Judge the address it embeds.
    const mapped = embeddedIpv4(ipv6);
    if (mapped) return isUnsafeHostname(mapped);
    // Link-local is fe80::/10, not fe80::/16 — `fe90::`, `fea0::` and `feb0::`
    // are link-local too and a `fe80:` prefix test misses all three.
    return (
      ipv6 === "::1" ||
      ipv6 === "::" ||
      /^fe[89ab][0-9a-f]?:/.test(ipv6) ||
      ipv6.startsWith("fc") ||
      ipv6.startsWith("fd")
    );
  }

  const octets = normalized.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  return (
    a === 0 || // 0.0.0.0/8 — "this network"; 0.0.0.0 alone is not the whole range.
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT, routable inside carrier networks.
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    String(error).toLowerCase().includes("timeout")
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
