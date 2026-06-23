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
const RELAY_RESPONSE_HEADERS = ["content-type", "content-length", "cache-control"] as const;

export async function handleRpcRequest(
  request: Request,
  options: RelayHandlerOptions,
): Promise<Response> {
  if (request.method === "OPTIONS") return corsPreflightResponse();
  if (request.method !== "POST") {
    return relayError("method-not-allowed", options.providerId, "RPC route requires POST", 405);
  }

  if (options.token && !isAuthorized(request, options.token)) {
    return relayError("unauthorized", options.providerId, "Relay token is required", 401);
  }

  const provider = options.registry.get(options.providerId);
  if (!provider) {
    return relayError("unknown-provider", options.providerId, "Unknown provider", 404);
  }
  if (!provider.profile) {
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
  return authorization === `Bearer ${token}`;
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "0.0.0.0") return true;
  if (normalized.includes(":")) {
    return normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc");
  }

  const octets = normalized.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  return (
    a === 10 ||
    a === 127 ||
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
